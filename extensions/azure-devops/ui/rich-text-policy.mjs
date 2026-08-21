// The write-side markup policies, shared by the browser editor and the canvas server.
//
// The read-side sanitizer in rich-text.mjs is deliberately permissive: it has to
// render whatever Azure DevOps already holds, so it allows ~50 tags and silently
// drops what it cannot show (style attributes, font tags, colors). That is fine
// for rendering and fatal for editing -- saving a sanitized render would write the
// stripped version back over the original.
//
// Two policies live here, because there are two different questions to ask.
//
//   1. validateWriteHtml -- "could this editor have produced this markup?" A small
//      allow-list, used for the agent-facing update_work_item action, where the
//      caller is authoring new markup rather than preserving existing markup. The
//      editor should never emit a violation, so the server rejects rather than
//      rewrites: a violation is a bug we want to hear about, not something to
//      paper over.
//   2. validateEditableHtml -- "is any of this executable?" Used for canvas edits,
//      where the content handed back is mostly content Azure DevOps already had
//      and this canvas never authored. Rewriting that content is the silent data
//      loss the read-only fallback existed to prevent, so the only thing refused
//      is markup that runs.
//
// Both are intentionally string-based and DOM-free so the same code runs in the
// browser and in node.

// Elements the editor can produce, and that Azure DevOps renders predictably.
// `div` is here because the Azure DevOps web editor wraps almost everything in
// one; excluding it would trip the fidelity gate on the majority of real fields.
export const WRITE_TAGS = new Set([
    "a", "blockquote", "br", "code", "div", "em", "h1", "h2", "h3", "h4",
    "li", "ol", "p", "pre", "s", "strong", "u", "ul",
]);

// Attributes allowed per tag. Everything else -- style, class, id, colors, event
// handlers, width/height -- is a violation rather than something to strip.
export const WRITE_ATTRIBUTES = {
    a: new Set(["href", "title"]),
};

// Tags the editor never emits but which browsers love to inject via contenteditable
// or a paste. Called out separately so the violation message can be specific.
const BROWSER_JUNK_TAGS = new Set(["font", "span", "b", "i", "strike", "center", "big", "small"]);

const SAFE_WRITE_URL = /^(?:https?:\/\/|mailto:|#|\/(?![/\\]))/i;

// Attributes that carry a URL, and so decide what a click or a load reaches.
// Checking only href and src leaves `action`, `formaction`, and the rest as ways
// to smuggle a javascript: scheme past both policies and into Azure DevOps, where
// their renderer is the one that would run it.
export const URL_ATTRIBUTES = new Set([
    "action", "background", "cite", "data", "formaction", "href", "longdesc",
    "ping", "poster", "src", "srcset", "xlink:href",
]);

/**
 * Whether a URL-bearing attribute holds a scheme that is not allowed.
 *
 * @param {string} name attribute name, lower-cased
 * @param {string} value attribute value
 * @returns {boolean}
 */
export function hasUnsafeUrl(name, value) {
    if (!URL_ATTRIBUTES.has(name)) {
        return false;
    }
    // srcset is a comma-separated candidate list, each entry a URL followed by an
    // optional descriptor, so the whole value is never a URL on its own.
    const candidates = name === "srcset"
        ? String(value ?? "").split(",").map((entry) => entry.trim().split(/\s+/)[0])
        : [value];
    return candidates.some((candidate) => !isSafeWriteUrl(candidate));
}

// Matches a tag and captures its name and raw attribute text. The tag name must
// follow "<" or "</" immediately, which is what an HTML parser requires: "< p>" is
// text, not a tag, so treating it as one would refuse prose for no reason.
//
// A bare "<" is allowed inside the attribute run because the tokenizer allows it:
// once a tag is open, "<" is an ordinary attribute-name character and does not
// start anything. Excluding it would end the match early and let the comment
// branch of COMMENT_OR_TAG claim text the browser reads as attributes, hiding a
// real handler from the scan:
//
//   <a <!-- onclick="alert(1)" --> href="#">
//
// which parses as <a <!--="" onclick="alert(1)" --=""> -- a live onclick.
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

const ATTRIBUTE = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;

// Elements that legitimately have no closing tag, so an unbalanced-tag check must
// not count them as unclosed.
const VOID_TAGS = new Set(["br"]);

// The full HTML void set, for the preserve policy below. WRITE_TAGS is small
// enough that `br` is the only one it can contain; the preserve policy admits any
// element Azure DevOps already stores, so it needs the rest too.
const ALL_VOID_TAGS = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
    "param", "source", "track", "wbr",
]);

// Elements that execute, load, or restyle the page rather than describe content.
// These are what the preserve policy exists to keep out; everything else is
// presentation Azure DevOps is entitled to store and we are obliged to hand back
// unchanged.
//
// `svg` and `math` are here as the two foreign-content namespaces: both parse by
// their own rules, which is what makes them the usual lever for getting a payload
// past a scan that assumes HTML parsing. The raw-text elements are here for the
// opposite reason -- their content is *not* parsed as markup, so a DOM walk sees
// no children to scrub while a string scan sees tags. Excluding them keeps the
// browser-side scrub and this validator from disagreeing about the same value.
export const EXECUTABLE_TAGS = new Set([
    "applet", "base", "embed", "frame", "frameset", "iframe", "link", "math",
    "meta", "noembed", "noframes", "noscript", "object", "plaintext", "script",
    "style", "svg", "template", "xmp",
]);

// A comment the editor can hand back unchanged: opened with "<!--" and closed
// with "-->". This is the strip used by both policies, so what it removes is
// exactly what survives a save.
const COMMENT = /<!--[\s\S]*?-->/g;

// The tokenizer ends a comment in three more places: "<!-->" and "<!--->" are
// complete empty comments (the comment start states emit on ">"), and "--!>"
// closes one via the comment-end-bang state. None of the three round-trips --
// the serializer rewrites all of them to "<!---->" or "-->" -- so they are not
// in COMMENT and a field containing one stays read-only rather than being
// silently repaired on save. They are recognized only here, to keep them from
// being reported as the *unterminated* case, which they are not.
const COMMENT_END = /<!--(?:>|->|[\s\S]*?--!?>)/g;
const UNTERMINATED_COMMENT = /<!--/;

// Comments and tags have to be recognized in one pass, because "<!--" inside a
// quoted attribute value is text to the tokenizer and not a comment at all.
// Stripping comments first lets a lazy match open inside one attribute value and
// close inside another, deleting every real attribute in between -- an event
// handler included -- before any tag scan sees them:
//
//   <a title="x <!--" onclick="alert(1)" data-y="-->">
//
// A single alternation makes whichever construct starts first consume the text,
// which is what a browser does. TAG is second because at a shared start position
// only the comment branch can match: TAG requires a letter after "<".
const COMMENT_OR_TAG = new RegExp(`${COMMENT.source}|${TAG.source}`, "g");
const COMMENT_END_OR_TAG = new RegExp(`${COMMENT_END.source}|${TAG.source}`, "g");

/**
 * Removes comments without mistaking a quoted attribute value for one.
 *
 * @param {string} html markup to strip
 * @param {RegExp} pattern comment-or-tag alternation to scan with
 * @returns {string}
 */
function withoutComments(html, pattern = COMMENT_OR_TAG) {
    pattern.lastIndex = 0;
    return String(html ?? "").replace(pattern, (token) => (token.startsWith("<!--") ? "" : token));
}

/**
 * Whether markup holds a "<!--" that nothing closes.
 *
 * Exported because the callers that need it cannot ask the validator. A stray
 * opener is precisely the input a parser normalizes -- it terminates the comment
 * on the way out -- so anything validating a round-tripped value has already lost
 * the evidence and has to test the original bytes itself.
 *
 * Every terminator the tokenizer honours counts here, not just "-->": a value a
 * browser reads as a closed comment is not the unterminated case, whatever the
 * serializer later does with it. Refusing to round-trip it is the strip's
 * business, and it says so with its own violation.
 *
 * The test runs with tags removed as well as comments: "<" is not escaped in a
 * serialized attribute value, so `title="use <!-- here"` is markup Azure DevOps
 * can hand back and the round trip preserves, and reading it as an opener would
 * cost a field its editability for nothing.
 *
 * @param {string} html markup to check
 * @returns {boolean}
 */
export function hasUnterminatedComment(html) {
    TAG.lastIndex = 0;
    return UNTERMINATED_COMMENT.test(withoutComments(html, COMMENT_END_OR_TAG).replace(TAG, ""));
}

/**
 * Whether markup holds a comment the editor cannot hand back byte for byte.
 *
 * Two shapes qualify: an opener nothing closes, and one closed by a terminator
 * the serializer rewrites ("<!-->", "<!--->", "--!>" all come back as "<!---->"
 * or "-->"). Both end the same way if the field is opened for editing -- the
 * save writes the parser's repair over a value the user never touched -- so the
 * gate treats them alike and the field stays read-only.
 *
 * @param {string} html markup to check
 * @returns {boolean}
 */
export function hasUnpreservableComment(html) {
    TAG.lastIndex = 0;
    return UNTERMINATED_COMMENT.test(withoutComments(html).replace(TAG, ""));
}

// An empty list item renders as a visible bullet, but the read-side sanitizer
// prunes it before the editor ever sees it (li is in its EMPTY_PRUNABLE set), so
// a field containing one cannot round-trip. Every other element that sanitizer
// prunes renders as nothing, which makes its removal genuinely lossless.
const EMPTY_LIST_ITEM = /<li\s*>\s*<\/li\s*>/i;

export function isSafeWriteUrl(value) {
    const url = String(value ?? "")
        .trim()
        // Browsers strip control characters before parsing a URL and treat "\" as
        // "/", so they must be removed before the scheme test rather than after.
        .replace(/[\u0000-\u001F\u007F]/g, "");
    return SAFE_WRITE_URL.test(url) ? url : "";
}

function attributeNames(source) {
    const names = [];
    ATTRIBUTE.lastIndex = 0;
    for (let match = ATTRIBUTE.exec(source); match; match = ATTRIBUTE.exec(source)) {
        names.push({ name: match[1].toLowerCase(), value: match[2] ?? match[3] ?? match[4] ?? "" });
    }
    return names;
}

/**
 * Checks markup against the write policy.
 *
 * This validates; it never rewrites. A caller that gets `ok: false` should refuse
 * the edit and say why, not try to repair the markup.
 *
 * @param {string} html markup to check
 * @returns {{ ok: boolean, violations: string[] }}
 */
export function validateWriteHtml(html) {
    const raw = String(html ?? "");
    const violations = [];
    const stack = [];

    // Comments are removed before the tag scan for two reasons: markup inside one
    // is not real markup and would otherwise be reported as broken nesting, and
    // this editor authors markup rather than preserving it, so a comment it
    // cannot reproduce is a reason to refuse the write outright.
    //
    // The strip uses the wide terminator set, not the round-trippable one. This
    // policy refuses every comment either way, so the only thing a narrow strip
    // could do here is fail to notice one: "<!-->", "<!--->" and "--!>" would
    // survive it, leave source === raw, and pass -- and they would not be caught
    // by the leftover test either, since a browser does end a comment there.
    const source = withoutComments(raw, COMMENT_END_OR_TAG);
    if (source !== raw || hasUnterminatedComment(raw)) {
        violations.push("HTML comments cannot be preserved by this editor");
    }
    if (EMPTY_LIST_ITEM.test(source)) {
        violations.push("an empty list item cannot be preserved by this editor");
    }

    TAG.lastIndex = 0;
    for (let match = TAG.exec(source); match; match = TAG.exec(source)) {
        const [, closing, rawName, rawAttributes] = match;
        const name = rawName.toLowerCase();
        const isClosing = closing === "/";
        const selfClosing = /\/\s*$/.test(rawAttributes);

        if (!WRITE_TAGS.has(name)) {
            violations.push(BROWSER_JUNK_TAGS.has(name)
                ? `<${name}> is browser or editor formatting the canvas cannot store safely`
                : `<${name}> is outside the set of elements this editor can save`);
            continue;
        }

        if (isClosing) {
            // Only report the first structural break: a single stray close tag
            // cascades into a violation for every tag after it.
            if (stack.at(-1) === name) {
                stack.pop();
            } else if (!violations.some((entry) => entry.includes("nesting"))) {
                violations.push(`</${name}> closes an element that is not open (broken nesting)`);
            }
            continue;
        }

        for (const attribute of attributeNames(rawAttributes)) {
            if (!WRITE_ATTRIBUTES[name]?.has(attribute.name)) {
                violations.push(`<${name} ${attribute.name}> is not an attribute this editor can save`);
                continue;
            }
            if ((attribute.name === "href" || attribute.name === "src") && !isSafeWriteUrl(attribute.value)) {
                violations.push(`<${name} ${attribute.name}> uses a URL scheme that is not allowed`);
            }
        }

        if (!VOID_TAGS.has(name) && !selfClosing) {
            stack.push(name);
        }
    }

    if (stack.length && !violations.some((entry) => entry.includes("nesting"))) {
        violations.push(`<${stack.at(-1)}> is never closed (broken nesting)`);
    }

    // Duplicates are noise; the same disallowed tag usually appears many times.
    return { ok: violations.length === 0, violations: [...new Set(violations)] };
}

// Attributes that run script. Checked by prefix because the set of event names is
// open-ended and a new one must fail closed rather than pass unrecognized.
const EVENT_ATTRIBUTE = /^on/i;

/**
 * Whether an attribute name is an event handler.
 *
 * @param {string} name attribute name
 * @returns {boolean}
 */
export function isEventAttribute(name) {
    return EVENT_ATTRIBUTE.test(String(name ?? ""));
}

// Executable elements that never have content, so nothing needs skipping past
// them. Everything else in EXECUTABLE_TAGS wraps content that goes with it.
const EXECUTABLE_VOID_TAGS = new Set(["base", "embed", "frame", "link", "meta"]);

// Elements whose content is not parsed as markup. A nested open tag of the same
// name cannot occur inside one -- the parser ends the element at the first close
// tag -- so skipping past them must not try to balance nesting.
const RAW_TEXT_TAGS = new Set([
    "iframe", "noembed", "noframes", "plaintext", "script", "style", "xmp",
]);

/**
 * Removes the attributes that execute, leaving the rest of the tag byte for byte.
 *
 * Splices out only the offending spans rather than rebuilding the attribute run,
 * because rebuilding would normalize quoting and spacing on every tag it touched
 * and the round trip this module promises is a byte-level one.
 *
 * @param {string} rawAttributes attribute text captured from a tag
 * @returns {string}
 */
function withoutUnsafeAttributes(rawAttributes) {
    const removals = [];
    ATTRIBUTE.lastIndex = 0;
    for (let match = ATTRIBUTE.exec(rawAttributes); match; match = ATTRIBUTE.exec(rawAttributes)) {
        const name = match[1].toLowerCase();
        const value = match[2] ?? match[3] ?? match[4] ?? "";
        if (EVENT_ATTRIBUTE.test(name) || hasUnsafeUrl(name, value)) {
            removals.push([match.index, match.index + match[0].length]);
        }
    }
    if (!removals.length) {
        return rawAttributes;
    }
    let result = "";
    let cursor = 0;
    for (const [start, end] of removals) {
        result += rawAttributes.slice(cursor, start);
        cursor = end;
    }
    return result + rawAttributes.slice(cursor);
}

/**
 * Strips executable markup from an HTML string, before any parser sees it.
 *
 * The DOM scrub on the editor side removes the same things, but it can only run
 * on a document that has already been built, which means handing untrusted
 * markup to a parser first. This runs on the bytes instead, so the value reaching
 * the parser is one that carries nothing to execute. The two together are
 * deliberate: this pass has no DOM to disagree with, and the scrub after it
 * catches anything a string scan reads differently than a browser would.
 *
 * Markup with nothing to remove comes back byte for byte, so the round trip is
 * unaffected -- a caller can compare the result against its input to learn
 * whether anything executable was present at all.
 *
 * @param {string} html markup to strip
 * @returns {string}
 */
export function sanitizeHtmlSource(html) {
    const source = String(html ?? "");
    let result = "";
    let cursor = 0;
    let skipTag = null;
    let skipDepth = 0;
    COMMENT_OR_TAG.lastIndex = 0;
    for (let match = COMMENT_OR_TAG.exec(source); match; match = COMMENT_OR_TAG.exec(source)) {
        const token = match[0];
        const between = source.slice(cursor, match.index);
        cursor = match.index + token.length;
        if (!skipTag) {
            result += between;
        }
        // A comment describes content rather than running it, so it survives.
        if (token.startsWith("<!--")) {
            if (!skipTag) {
                result += token;
            }
            continue;
        }
        const isClosing = match[1] === "/";
        const name = match[2].toLowerCase();
        const rawAttributes = match[3] ?? "";
        const selfClosing = /\/\s*$/.test(rawAttributes);
        if (skipTag) {
            if (name === skipTag) {
                if (isClosing) {
                    skipDepth -= 1;
                    if (skipDepth <= 0) {
                        skipTag = null;
                    }
                } else if (!selfClosing && !RAW_TEXT_TAGS.has(name)) {
                    skipDepth += 1;
                }
            }
            continue;
        }
        if (EXECUTABLE_TAGS.has(name)) {
            if (!isClosing && !selfClosing && !EXECUTABLE_VOID_TAGS.has(name)) {
                skipTag = name;
                skipDepth = 1;
            }
            continue;
        }
        const safeAttributes = withoutUnsafeAttributes(rawAttributes);
        result += safeAttributes === rawAttributes
            ? token
            : `<${match[1]}${match[2]}${safeAttributes}>`;
    }
    if (!skipTag) {
        result += source.slice(cursor);
    }
    return result;
}

/**
 * Checks markup against the *preserve* policy.
 *
 * The write policy above asks "could this editor have produced it". This one asks
 * the only question that matters when the editor hands back content it did not
 * author: "is any of it executable". Everything else -- inline styles, font tags,
 * tables, images, Word paste artifacts, `data-vss-mention` on a mention -- is
 * markup Azure DevOps already stores, and rewriting it is exactly the silent data
 * loss going read-only was meant to avoid.
 *
 * @param {string} html markup to check
 * @returns {{ ok: boolean, violations: string[] }}
 */
export function validateEditableHtml(html) {
    const violations = [];
    const stack = [];

    // The write policy refuses any comment, because the editor cannot carry one
    // through a round trip. This policy hands back content Azure DevOps already
    // stored, and a comment is content it is entitled to store, so a well-formed
    // one passes. What does not is a comment this scan cannot read the same way a
    // browser does, or cannot return unchanged: a stray "<!--" is where the two
    // start disagreeing about where markup ends, and a terminator the serializer
    // rewrites ("<!-->", "<!--->", "--!>") turns a save into an edit of bytes the
    // user never touched.
    //
    // Note that a caller handing over a parsed and re-serialized value has
    // already had both shapes normalized for it, so this check cannot fire for
    // one -- canEditStoredHtml tests the stored bytes separately for that reason.
    const source = withoutComments(html);
    if (hasUnpreservableComment(html)) {
        violations.push(hasUnterminatedComment(html)
            ? "an unterminated HTML comment cannot be saved"
            : "this HTML comment cannot be preserved by this editor");
    }

    TAG.lastIndex = 0;
    for (let match = TAG.exec(source); match; match = TAG.exec(source)) {
        const [, closing, rawName, rawAttributes] = match;
        const name = rawName.toLowerCase();
        const isClosing = closing === "/";

        if (EXECUTABLE_TAGS.has(name)) {
            violations.push(`<${name}> can execute or restyle the page and cannot be saved`);
            continue;
        }
        if (isClosing) {
            if (stack.at(-1) === name) {
                stack.pop();
            } else if (!violations.some((entry) => entry.includes("nesting"))) {
                violations.push(`</${name}> closes an element that is not open (broken nesting)`);
            }
            continue;
        }

        for (const attribute of attributeNames(rawAttributes)) {
            if (EVENT_ATTRIBUTE.test(attribute.name)) {
                violations.push(`<${name} ${attribute.name}> is an event handler and cannot be saved`);
                continue;
            }
            if (hasUnsafeUrl(attribute.name, attribute.value)) {
                violations.push(`<${name} ${attribute.name}> uses a URL scheme that is not allowed`);
            }
        }

        if (!ALL_VOID_TAGS.has(name) && !/\/\s*$/.test(rawAttributes)) {
            stack.push(name);
        }
    }

    if (stack.length && !violations.some((entry) => entry.includes("nesting"))) {
        violations.push(`<${stack.at(-1)}> is never closed (broken nesting)`);
    }
    return { ok: violations.length === 0, violations: [...new Set(violations)] };
}
