// Shared Azure DevOps canvas text utilities.
export function normalizeString(value) {
    return typeof value === "string" ? value.trim() : "";
}

// Azure DevOps' REST payloads have represented this enum as both names and
// numbers. Normalize both shapes at the boundary so every caller makes the same
// render/edit decision.
export function normalizeMultilineFieldFormat(value) {
    if (value === 0) return "markdown";
    if (value === 1) return "html";
    const format = normalizeString(value).toLowerCase();
    if (format === "markdown" || format === "0") return "markdown";
    if (format === "html" || format === "1") return "html";
    return "";
}

export function encodePathPart(value) {
    return encodeURIComponent(value);
}

function decodeHtmlEntities(value) {
    return String(value ?? "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
}

// Keeps Markdown and HTML markup intact for clients that render rich text,
// normalizing only line endings and surrounding whitespace.
export function normalizeRichText(value) {
    return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

// True when the markup carries text or an element the renderer will actually
// keep. Kept in step with the renderer's allow-list: other input types and
// images without a source are dropped, so they would render as empty blocks.
export function hasRenderableContent(value) {
    const markup = String(value ?? "");
    return Boolean(stripHtml(value)) ||
        /<hr\b/i.test(markup) ||
        /<input\b[^>]*\btype\s*=\s*["']?checkbox\b/i.test(markup) ||
        /<img\b[^>]*\bsrc\s*=\s*["']?[^"'\s>]/i.test(markup);
}

export function stripHtml(value) {
    const withoutLinks = String(value ?? "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    const withLineBreaks = withoutLinks
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/div>/gi, "\n")
        .replace(/<\/li>/gi, "\n");
    const text = withLineBreaks.replace(/<[^>]*>/g, " ");
    return decodeHtmlEntities(text)
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t\f\v]+/g, " ")
        .replace(/[ \t]*\n[ \t]*/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
