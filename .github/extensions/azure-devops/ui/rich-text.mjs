// Dependency-free rich text rendering for Azure DevOps content.
//
// Azure DevOps mixes two content formats: pull request descriptions and pull
// request comments are Markdown, while work item fields and work item comments
// are HTML. Markdown content may still carry inline HTML, which Azure DevOps
// renders. Both are untrusted, so every path funnels through the sanitizer
// below before it reaches the DOM.

import { MarkdownIt, taskLists, emoji } from "./vendor/markdown-it.mjs";

// Configured to match the renderer Azure DevOps runs, so a description previews
// here the way Azure DevOps will render it after the save. Azure DevOps builds
// its renderer in Vssf/Web/extensions/vss-features/vss-markdown/MarkdownRenderer.ts.
//
// `breaks` is deliberately left at its default of false. Azure DevOps never sets
// it, which means a single newline is *not* a line break there and two trailing
// spaces are required. Treating a bare newline as a break -- the GitHub comment
// behaviour -- is what silently destroys authored line breaks on save.
//
// `html` is true because Azure DevOps admits inline HTML in Markdown content, and
// service-authored comments rely on it -- PullRequestQuantifier, for one, posts its
// feedback links as raw anchors. Escaping that markup renders the tags as literal
// text instead of the comment the author wrote. This is not a hole in the sanitizer:
// every rendered result, Markdown or HTML, is funnelled through `sanitizeHtml` below
// before it reaches the DOM, so admitting markup here only routes it through the same
// allow-list that already governs work item HTML.
// `emoji` is loaded because Azure DevOps loads it too, and service-authored
// comments write shortcodes rather than literal emoji -- PullRequestQuantifier
// labels its feedback links `:thumbsup:` / `:ok_hand:` / `:thumbsdown:`. Without
// it those reach the reader as raw colon-delimited text.
const markdown = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
}).use(taskLists).use(emoji);

const ALLOWED_TAGS = new Set([
    "a", "b", "blockquote", "br", "caption", "code", "col", "colgroup", "dd", "del", "div", "dl", "dt",
    "details", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "input", "ins", "kbd", "li",
    "ol", "p", "pre", "s", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th",
    "thead", "tr", "u", "ul",
]);

const ALLOWED_ATTRIBUTES = {
    "*": new Set(["class"]),
    // `data-vss-mention` is what makes an @mention a real mention rather than text
    // that looks like one: Azure DevOps stores it as
    // `<a href="#" data-vss-mention="version:2.0,{userId}">@Name</a>`, and a value
    // that loses it stops notifying the person named.
    a: new Set(["href", "title", "data-vss-mention"]),
    details: new Set(["open"]),
    img: new Set(["src", "alt", "title", "width", "height"]),
    input: new Set(["type", "checked", "disabled"]),
    ol: new Set(["start"]),
    td: new Set(["colspan", "rowspan"]),
    th: new Set(["colspan", "rowspan", "scope"]),
};

// Generated markup only ever uses these classes; anything else in untrusted
// HTML is dropped so remote content cannot borrow the canvas styles.
const ALLOWED_CLASS = /^(?:language-[\w+#.-]+|align-(?:left|center|right)|task-list-item)$/;

// Elements whose text content must be discarded along with the element itself.
const DROPPED_TAGS = new Set([
    "applet", "audio", "canvas", "embed", "form", "frame", "frameset", "iframe", "link", "meta",
    "noscript", "object", "script", "style", "svg", "template", "title", "video",
]);

// Real elements the sanitizer neither renders nor drops: it unwraps them and
// keeps their text. They still have to count as markup here, or unwrapping would
// never get the chance and the tag would show up as literal text instead. Kept
// deliberately short -- `small` is the only one the surveyed comments actually
// used, and `font` is already treated as an HTML signal below. Every addition is
// one more word that stops being readable when an author writes it as a type
// parameter or a placeholder.
const UNWRAPPED_TAGS = new Set(["font", "small"]);

// The names this renderer treats as markup. A run shaped like a tag whose name
// is outside this set is text the author typed, so "<TEntity>", "<repo>" and
// "<title>" stay visible instead of being parsed and discarded. Explicit HTML
// still reaches the sanitizer, which drops unsafe elements and their contents.
const MARKUP_TAGS = new Set([...ALLOWED_TAGS, ...UNWRAPPED_TAGS]);

// The bare "/" alternative is for same-origin paths only. Browsers resolve both
// "//host" and "/\host" as absolute cross-origin URLs, so neither may follow it.
const SAFE_URL = /^(?:https?:\/\/|mailto:|#|\/(?![/\\]))/i;

// An html_block token can contain several tags with prose between them. Match
// each tag-shaped run so one real wrapper cannot make a type parameter elsewhere
// in the block disappear, and tag-shaped prose cannot escape real markup beside it.
const HTML_TAG = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>]*?)?\/?>/g;

// A run shaped like a tag is markup when this renderer handles the name and the
// author wrote it in lowercase, which is how every generator of HTML in Azure
// DevOps emits it. Case is what separates markup from prose: "<td>" is a cell and
// "Cache<Span>" is a type parameter. Both halves are judged on their own, so no
// tag anywhere else in the comment can vouch for a name beside it.
//
// This is classification, not sanitization. Explicit HTML still goes through the
// sanitizer; in Markdown, an unsafe name is escaped into inert visible text.
function isMarkup(name) {
    return name === name.toLowerCase() && MARKUP_TAGS.has(name);
}

// `html: true` hands raw HTML straight through, so a run merely shaped like a tag
// reaches the DOM as an element. The sanitizer then unwraps that unknown element
// and the author's tag text goes with it, which is how "Returns Vec<String>"
// arrives as "Returns Vec". Escape each name this renderer does not recognise;
// real markup and non-tag constructs such as comments, CDATA and declarations
// pass through exactly as before.
function renderRawHtml(content) {
    return content.replace(HTML_TAG, (tag, name) =>
        isMarkup(name ?? "") ? tag : markdown.utils.escapeHtml(tag));
}

markdown.renderer.rules.html_inline = (tokens, index) => renderRawHtml(tokens[index].content);
markdown.renderer.rules.html_block = (tokens, index) => renderRawHtml(tokens[index].content);

// Case sensitive on purpose, and only consulted by format "auto". Bot comments
// emit lowercase HTML, while an uppercase run of the same shape ("Vec<U>",
// "List<Table>") is a type parameter. Matching it here would route the comment to
// the raw HTML path, which skips the escaping above, and the sanitizer would then
// unwrap the element and take the author's text with it.
//
// Uppercase HTML therefore reads as Markdown and shows its tags literally. That
// is the safe direction to be wrong in: formatting is lost, text is not. A caller
// holding a field it knows is HTML should say so with format "html" rather than
// rely on this guess.
const HTML_SOURCE = /<(?:\/?)(?:p|div|br|ul|ol|li|h[1-6]|table|tr|td|th|img|a|strong|em|b|i|u|code|pre|span|blockquote|hr|details|summary|font)\b[^>]*>/;

// U+0000 is reserved as the inline placeholder sentinel. Untrusted text carrying
// it could otherwise forge or misresolve a token, so it is dropped on the way in.
function stripSentinels(value) {
    return String(value ?? "").replace(/\u0000/g, "");
}

// Azure DevOps HTML can nest arbitrarily; past this depth the remaining subtree
// is flattened to text rather than recursed into.
const MAX_SANITIZE_DEPTH = 100;

function safeUrl(value) {
    // Browsers strip tabs and newlines from URLs before parsing and treat "\" as
    // "/", so "/\t/evil.example" would resolve off-origin. Remove control
    // characters before the scheme check, and hand back the normalized value.
    const url = String(value ?? "")
        .trim()
        .replace(/^<|>$/g, "")
        .replace(/[\u0000-\u001F\u007F]/g, "");
    return SAFE_URL.test(url) ? url : "";
}

export function markdownToHtml(source) {
    return markdown.render(stripSentinels(source));
}

/**
 * Renders Markdown without wrapping the result in a block element, for the
 * one-line contexts a detail view shows inline.
 *
 * @param {string} source Markdown
 * @returns {string} HTML, still to be sanitized before it reaches the DOM
 */
export function markdownToInlineHtml(source) {
    return markdown.renderInline(stripSentinels(source));
}

function sanitizeClassName(value) {
    return String(value ?? "")
        .split(/\s+/)
        .filter((name) => ALLOWED_CLASS.test(name))
        .join(" ");
}

function sanitizeElement(source, document_) {
    const tagName = source.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tagName)) {
        return null;
    }
    const node = document_.createElement(tagName);
    const allowed = ALLOWED_ATTRIBUTES[tagName];
    for (const attribute of [...source.attributes]) {
        const name = attribute.name.toLowerCase();
        if (!ALLOWED_ATTRIBUTES["*"].has(name) && !allowed?.has(name)) {
            continue;
        }
        if (name === "class") {
            const className = sanitizeClassName(attribute.value);
            if (className) {
                node.className = className;
            }
            continue;
        }
        if (name === "href" || name === "src") {
            const url = safeUrl(attribute.value);
            if (!url) {
                continue;
            }
            node.setAttribute(name, url);
            continue;
        }
        node.setAttribute(name, attribute.value);
    }
    // Read back after copying the allowed attributes so a missing type is rejected
    // too. HTML defaults a missing input type to "text"; only an explicit checkbox
    // belongs in rendered task-list markup.
    if (tagName === "input" && String(node.getAttribute("type") ?? "").toLowerCase() !== "checkbox") {
        return null;
    }
    if (tagName === "img" && !node.hasAttribute("src")) {
        return null;
    }
    // A same-page anchor is not a navigation, and an @mention is stored as one
    // (`href="#"`), so forcing a new tab on it would open a blank window on click.
    if (tagName === "a" && node.hasAttribute("href") && !node.getAttribute("href").startsWith("#")) {
        node.target = "_blank";
        node.rel = "noopener noreferrer";
    }
    if (tagName === "input") {
        node.disabled = true;
    }
    return node;
}

function sanitizeInto(target, source, document_, depth = 0) {
    if (depth >= MAX_SANITIZE_DEPTH) {
        target.append(document_.createTextNode(source.textContent || ""));
        return;
    }
    for (const child of source.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            target.append(document_.createTextNode(child.nodeValue));
            continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) {
            continue;
        }
        const node = sanitizeElement(child, document_);
        if (!node) {
            if (!DROPPED_TAGS.has(child.tagName.toLowerCase())) {
                // Drop the disallowed wrapper but keep any content it held.
                sanitizeInto(target, child, document_, depth + 1);
            }
            continue;
        }
        sanitizeInto(node, child, document_, depth + 1);
        target.append(node);
    }
}

const EMPTY_PRUNABLE = new Set(["p", "div", "span", "li", "strong", "em", "b", "i", "u", "s", "del", "ins", "code"]);

// Removes containers left behind after disallowed markup was stripped.
function pruneEmpty(root) {
    for (const node of [...root.querySelectorAll?.("*") ?? []].reverse()) {
        if (EMPTY_PRUNABLE.has(node.tagName.toLowerCase()) && !node.childNodes.length) {
            node.remove();
        }
    }
}

export function sanitizeHtml(html) {
    const fragment = document.createDocumentFragment();
    const parsed = new DOMParser().parseFromString(String(html ?? ""), "text/html");
    sanitizeInto(fragment, parsed.body, document);
    pruneEmpty(fragment);
    return fragment;
}

export function looksLikeHtml(value) {
    return HTML_SOURCE.test(String(value ?? ""));
}

/**
 * Renders Azure DevOps rich text into `node`, replacing its current content.
 *
 * @param {Element} node target element
 * @param {string} value markdown or HTML source
 * @param {{ inline?: boolean, format?: "auto" | "markdown" | "html" }} options
 * @returns {boolean} whether anything was rendered
 */
export function renderRichText(node, value, { inline = false, format = "auto" } = {}) {
    node.replaceChildren();
    const source = String(value ?? "").trim();
    if (!source) {
        return false;
    }
    const isHtml = format === "html" || (format === "auto" && looksLikeHtml(source));
    const html = isHtml ? source : inline ? markdownToInlineHtml(source) : markdownToHtml(source);
    // The same element may be re-rendered with a different mode.
    node.classList.remove("rich-text", "rich-text-inline");
    node.classList.add(inline ? "rich-text-inline" : "rich-text");
    node.append(sanitizeHtml(html));
    return Boolean(node.childNodes.length);
}

/**
 * Creates an element containing rendered rich text.
 *
 * @param {string} tagName element to create
 * @param {string} className class applied to the element
 * @param {string} value markdown or HTML source
 * @param {{ inline?: boolean, format?: "auto" | "markdown" | "html" }} options
 * @returns {Element}
 */
export function richTextElement(tagName, className, value, options) {
    const node = document.createElement(tagName);
    if (className) {
        node.className = className;
    }
    renderRichText(node, value, options);
    return node;
}
