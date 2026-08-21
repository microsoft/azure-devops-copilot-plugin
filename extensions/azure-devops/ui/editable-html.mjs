// The document handed to the work item field editor, and taken back from it.
//
// This is deliberately not the read-side sanitizer. That one renders: it drops
// anything it cannot display, which is correct for a view and catastrophic for an
// edit, because saving what it produced would write the stripped version back over
// the original. Measured against representative Azure DevOps markup, the read-side
// sanitizer preserves 5 of 13 cases; a plain DOM round trip preserves 12. The DOM
// was never the lossy step.
//
// So the rule here is inverted. Rather than allowing the few elements we
// understand, this removes only what executes and keeps everything else byte for
// byte -- inline styles, font tags, tables, images, Word paste artifacts, and the
// `data-vss-mention` attribute that makes an @mention a real mention rather than a
// dead link.
//
// "Executes" means scripting: script and the other executable elements, event
// handler attributes, and URL attributes carrying a scheme that runs. It does not
// mean "cannot affect presentation" -- a `style` attribute is preserved, because
// preserving the formatting Azure DevOps stored is the entire point. What is
// written back is therefore no more dangerous than what was already there, but it
// is not sanitized in the display sense, and the read side still is.
//
// Losslessness here needs no Azure DevOps renderer to prove. A work item HTML
// field is read as HTML and written back as HTML, so there is no format conversion
// to lose anything in, and the round trip is a property of this file that its
// tests can check directly. (That is what separates this from the Markdown round
// trip that was removed: predicting what Markdown becomes *does* require Azure
// DevOps' renderer, which is why descriptions are edited as Markdown source.)

import { EXECUTABLE_TAGS, hasUnpreservableComment, hasUnsafeUrl, isEventAttribute, sanitizeHtmlSource, validateEditableHtml } from "./rich-text-policy.mjs";

function scrub(root) {
    let removed = false;
    for (const node of [...root.querySelectorAll("*")]) {
        if (EXECUTABLE_TAGS.has(node.tagName.toLowerCase())) {
            node.remove();
            removed = true;
            continue;
        }
        for (const attribute of [...node.attributes]) {
            const name = attribute.name.toLowerCase();
            if (isEventAttribute(name) || hasUnsafeUrl(name, attribute.value)) {
                node.removeAttribute(attribute.name);
                removed = true;
            }
        }
    }
    return removed;
}

// Markup reaches the parser only after the string-level strip has run, so what
// is parsed carries nothing to execute. The scrub below still runs on the result:
// a string scan and a browser do not always read the same bytes the same way, and
// the DOM is where that disagreement would show up.
function parse(sanitizedHtml) {
    return new DOMParser().parseFromString(sanitizedHtml, "text/html");
}

/**
 * Builds the fragment the editor is seeded with.
 *
 * @param {string} html stored field markup
 * @returns {DocumentFragment}
 */
export function toEditableFragment(html) {
    const parsed = parse(sanitizeHtmlSource(html));
    scrub(parsed.body);
    const fragment = document.createDocumentFragment();
    fragment.append(...parsed.body.childNodes);
    return fragment;
}

/**
 * Normalizes what the editor hands back. Runs the same scrub as the seed, so
 * anything a paste dragged in is held to the rule the stored value was.
 *
 * @param {string} html markup from the editing surface
 * @returns {string}
 */
export function fromEditableHtml(html) {
    const parsed = parse(sanitizeHtmlSource(html));
    scrub(parsed.body);
    return parsed.body.innerHTML;
}

/**
 * Whether a stored value can be edited without changing anything the user did not.
 *
 * Scrubbing a field that holds executable markup would remove it on save, which is
 * an edit the user never made. Rather than make that decision for them, the field
 * stays read-only and says so. In practice this is close to every real work item:
 * the check only fails on markup that runs.
 *
 * @param {string} html stored field markup
 * @returns {boolean}
 */
export function canEditStoredHtml(html) {
    const source = String(html ?? "");
    // Tested on the stored bytes, before the parse, because the parse is what
    // destroys the evidence: a stray "<!--" comes back terminated and a "--!>"
    // comes back "-->", so every check downstream of here sees a well-formed
    // comment and agrees the field is editable. Saving it would then write the
    // parser's repair over the stored value -- a change to markup the user never
    // touched, which is the whole reason this gate exists.
    if (hasUnpreservableComment(source)) {
        return false;
    }
    // Also on the stored bytes, and for the same reason: the strip runs ahead of
    // the parse now, so by the time there is a DOM to walk the executable markup
    // is already gone and the scrub below has nothing left to report. Comparing
    // the stripped bytes against the original is what still notices it was there.
    const sanitized = sanitizeHtmlSource(source);
    if (sanitized !== source) {
        return false;
    }
    const parsed = parse(sanitized);
    if (scrub(parsed.body)) {
        return false;
    }
    // The scrub walks the DOM and the server validates a string, and the two do
    // not always see the same document -- raw-text elements hold markup a DOM walk
    // has no children to visit. Asking the server's validator as well means the
    // gate can only ever open on a value the server will accept: otherwise a field
    // opens for editing and the save is refused for markup the user never touched.
    return validateEditableHtml(fromEditableHtml(source)).ok;
}
