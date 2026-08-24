// Run with: node --test rich-text.test.mjs
//
// The renderer is the vendored markdown-it, pinned to the version Azure DevOps
// ships, so these tests are really asserting that the canvas previews a
// description the way Azure DevOps will render it after the save.
//
// The line-break cases are the reason the vendored bundle exists. Azure DevOps
// never sets markdown-it's `breaks` option, so a bare newline is not a line break
// and two trailing spaces are. A renderer that assumes otherwise silently drops
// authored line breaks the moment the description is saved.
import assert from "node:assert/strict";
import test from "node:test";

import { BOT_MARKUP, COLLAPSIBLE_MARKUP, TYPE_PARAMETERS } from "./rich-text.corpus.mjs";

// These extensions ship without node_modules, so jsdom is not guaranteed to be
// present. Skip rather than fail when it is missing, and run with:
//   npm install jsdom && node --test rich-text.test.mjs
let JSDOM;
try {
    ({ JSDOM } = await import("jsdom"));
} catch {
    JSDOM = null;
}
const needsDom = { skip: JSDOM ? false : "jsdom is not installed" };

let renderRichText;
let markdownToHtml;
let looksLikeHtml;
if (JSDOM) {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.DOMParser = dom.window.DOMParser;
    globalThis.Node = dom.window.Node;
    ({ renderRichText, markdownToHtml, looksLikeHtml } = await import("./ui/rich-text.mjs"));
}

function render(markdown) {
    const host = document.createElement("div");
    renderRichText(host, markdown, { format: "markdown" });
    return host.innerHTML;
}

test("a bare newline is not a line break, the way Azure DevOps renders it", needsDom, () => {
    assert.doesNotMatch(markdownToHtml("line one\nline two"), /<br>/);
});

test("two trailing spaces are a line break, the way Azure DevOps renders it", needsDom, () => {
    assert.match(markdownToHtml("line one  \nline two"), /<br>/);
});

test("a blank line starts a new paragraph", needsDom, () => {
    const html = markdownToHtml("para one\n\npara two");
    assert.equal((html.match(/<p>/g) || []).length, 2);
});

test("tables render, because pull request descriptions support them", needsDom, () => {
    const html = render("| a | b |\n|---|---|\n| 1 | 2 |");
    assert.match(html, /<table>/);
    assert.match(html, /<th>a<\/th>/);
});

test("task lists render as checkboxes", needsDom, () => {
    const html = render("- [x] done\n- [ ] todo");
    assert.match(html, /type="checkbox"/);
    assert.match(html, /checked/);
});

test("strikethrough renders", needsDom, () => {
    assert.match(markdownToHtml("~~gone~~"), /<s>gone<\/s>/);
});

test("bare URLs are linkified", needsDom, () => {
    // The sanitizer adds target/rel on the way out, so match the href only.
    assert.match(render("see https://example.com now"), /<a href="https:\/\/example\.com"/);
});

test("a fenced block keeps its language hint", needsDom, () => {
    assert.match(render("```js\nconst a = 1;\n```"), /class="language-js"/);
});

test("a script tag in Markdown is visible source text, never an element", needsDom, () => {
    const html = render("<script>alert(1)</script>");
    assert.doesNotMatch(html, /<script/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("inline HTML an author wrote is rendered, the way Azure DevOps renders it", needsDom, () => {
    const html = render('feedback: <a href="https://example.com" title="Thumbs up"><strong>yes</strong></a>');
    assert.match(html, /<a href="https:\/\/example\.com"/);
    assert.match(html, /<strong>yes<\/strong>/);
    assert.doesNotMatch(html, /&lt;a /);
});

test("an HTML comment in Markdown does not show up as text", needsDom, () => {
    const html = render("visible\n\n<!-- Policy app identification -->");
    assert.match(html, /visible/);
    assert.doesNotMatch(html, /Policy app identification/);
});

test("emoji shortcodes render as emoji, the way Azure DevOps renders them", needsDom, () => {
    assert.match(render("nice work :thumbsup:"), /👍/);
});

test("a shortcode inside authored HTML still renders", needsDom, () => {
    // How PullRequestQuantifier labels its feedback links: a shortcode nested in
    // inline HTML, which only renders if both the HTML and the emoji pass work.
    const html = render('<a href="https://example.com" title="Thumbs up"><strong>:thumbsup:</strong></a>');
    assert.match(html, /<strong>👍<\/strong>/);
    assert.doesNotMatch(html, /:thumbsup:/);
});

test("an unusable link scheme never becomes a link", needsDom, () => {
    const html = render("[click](javascript:alert(1))");
    // markdown-it refuses the scheme outright, so the source stays literal text.
    // What matters is that no anchor carries it.
    assert.doesNotMatch(html, /href=/);
    assert.doesNotMatch(html, /<a\b/);
});

test("inline rendering does not wrap the result in a block", needsDom, () => {
    const host = document.createElement("div");
    renderRichText(host, "just **bold** text", { format: "markdown", inline: true });
    assert.doesNotMatch(host.innerHTML, /<p>/);
    assert.match(host.innerHTML, /<strong>bold<\/strong>/);
});

test("HTML values still render through the sanitizer", needsDom, () => {
    const host = document.createElement("div");
    renderRichText(host, '<p>kept</p><img src="x" onerror="alert(1)">', { format: "html" });
    assert.match(host.innerHTML, /kept/);
    assert.doesNotMatch(host.innerHTML, /onerror/);
});

// Mirrors ALLOWED_TAGS in rich-text.mjs. Duplicated on purpose: the list is not
// exported, and a change to it should break these tests loudly rather than be
// followed silently.
const ALLOWED_TAGS = [
    "a", "b", "blockquote", "br", "caption", "code", "col", "colgroup", "dd", "del", "div", "dl", "dt",
    "details", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "input", "ins", "kbd", "li",
    "ol", "p", "pre", "s", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th",
    "thead", "tr", "u", "ul",
];

const VOID_TAGS = new Set(["br", "col", "hr", "img", "input"]);
const DROPPED_TAGS = [
    "applet", "audio", "canvas", "embed", "form", "frame", "frameset", "iframe", "link", "meta",
    "noscript", "object", "script", "style", "svg", "template", "title", "video",
];

const escapeExpected = (value) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A pull request comment loses text whenever a "<...>" run reaches the sanitizer
// as markup: the element is dropped and its contents go with it. Every case here
// is text a reviewer typed and must still be able to read.

test("uppercase type parameters that spell a tag name are escaped, not parsed", needsDom, () => {
    for (const tag of ALLOWED_TAGS) {
        if (VOID_TAGS.has(tag)) {
            continue;
        }
        const parameter = tag.toUpperCase();
        const html = markdownToHtml(`Return Vec<${parameter}> from the handler`);
        assert.ok(
            html.includes(`Vec&lt;${parameter}&gt;`),
            `Vec<${parameter}> must survive as text, got: ${html}`,
        );
    }
});

// Void elements never carry a closing tag, so structure alone could not tell
// "<BR>" apart from a line break. Case can: an uppercase run is a type
// parameter, a lowercase one is markup.
test("case tells a void element apart from a type parameter named after one", needsDom, () => {
    assert.match(markdownToHtml("Return Vec<BR> here"), /Vec&lt;BR&gt;/);
    assert.match(markdownToHtml("line<br>break"), /line<br>break/);
});

test("type parameters that do not spell a tag name are escaped", needsDom, () => {
    const parameters = [
        "String", "T", "TKey", "TValue", "HttpResponseMessage", "IServiceProvider",
        "int", "u8", "i32", "usize", "TRequest",
    ];
    for (const parameter of parameters) {
        const html = markdownToHtml(`Return Vec<${parameter}> here`);
        assert.ok(
            html.includes(`Vec&lt;${parameter}&gt;`),
            `Vec<${parameter}> must survive as text, got: ${html}`,
        );
    }
});

test("closing-shaped type parameters are escaped", needsDom, () => {
    assert.match(markdownToHtml("compare </T> against </U>"), /&lt;\/T&gt;.*&lt;\/U&gt;/);
});

// Corpus driven. These assert the two invariants the survey established: text a
// reviewer typed is never deleted, and the markup the bots emit still renders.

test("corpus: type parameters and placeholders survive as text", needsDom, () => {
    for (const entry of TYPE_PARAMETERS) {
        const html = markdownToHtml(entry.source);
        for (const expected of entry.text) {
            assert.ok(
                html.includes(escapeExpected(expected)),
                `${entry.id}: lost "${expected}" -> ${html}`,
            );
        }
    }
});

test("corpus: bot markup is preserved as markup", needsDom, () => {
    for (const entry of BOT_MARKUP) {
        const html = markdownToHtml(entry.source);
        for (const tag of entry.markup) {
            assert.ok(html.includes(`<${tag}`), `${entry.id}: lost <${tag}> -> ${html}`);
        }
        for (const expected of entry.text ?? []) {
            assert.ok(html.includes(expected), `${entry.id}: lost "${expected}" -> ${html}`);
        }
    }
});

test("corpus: collapsible bot markup renders and keeps its text", needsDom, () => {
    for (const entry of COLLAPSIBLE_MARKUP) {
        const html = markdownToHtml(entry.source);
        assert.ok(!html.includes("&lt;details"), `${entry.id}: showed raw tags -> ${html}`);
        assert.ok(html.includes("<details"), `${entry.id}: lost details markup -> ${html}`);
        for (const expected of entry.text) {
            assert.ok(html.includes(expected), `${entry.id}: lost "${expected}" -> ${html}`);
        }
    }
});

// Underscores inside an identifier are treated as emphasis, which deletes them.
// Pre-existing and unrelated to tag handling, but it loses authored text in the
// same way, so it is recorded here rather than left to be rediscovered.
test("corpus: snake_case placeholders keep their underscores", { ...needsDom, todo: "intraword emphasis" }, () => {
    const html = markdownToHtml("Events are named service_<entrypoint>_<subject>_<action> by convention.");
    assert.ok(html.includes("service_&lt;entrypoint&gt;_&lt;subject&gt;_&lt;action&gt;"), html);
});

test("nested and multi-argument generics survive", needsDom, () => {
    const cases = [
        "Vec<Vec<String>>",
        "Dictionary<string, int>",
        "Handler<TRequest, TResponse>",
        "Vec<&str>",
        "Task<Result<T, E>>",
    ];
    for (const source of cases) {
        const html = markdownToHtml(`Use ${source} instead`);
        assert.ok(!/<(?!\/?(?:p|ol|ul|li|code|pre|em|strong)\b)[a-zA-Z]/.test(html),
            `${source} produced live markup: ${html}`);
    }
});

// The canvas renders pull request comments, and in this repository roughly three
// quarters of them are bot comments built from raw lowercase HTML. Escaping that
// would turn every one into visible tag soup, so it has to keep rendering.

test("lowercase markup is still passed through as markup", needsDom, () => {
    for (const tag of ALLOWED_TAGS) {
        const closed = VOID_TAGS.has(tag) ? `<${tag}>` : `<${tag}>x</${tag}>`;
        const html = markdownToHtml(`before ${closed} after`);
        assert.ok(html.includes(`<${tag}>`), `<${tag}> must stay markup, got: ${html}`);
    }
});

test("lowercase markup with attributes is passed through", needsDom, () => {
    const sources = [
        '<img src="https://www.contoso.com/badge.svg">',
        '<a href="https://www.contoso.com" title="t">link</a>',
        '<td colspan="2">cell</td>',
        "<br/>",
        "<p />",
    ];
    for (const source of sources) {
        const html = markdownToHtml(source);
        assert.ok(html.includes("<"), `${source} was escaped: ${html}`);
        assert.ok(!html.includes("&lt;"), `${source} was escaped: ${html}`);
    }
});

test("a bot comment keeps its markup", needsDom, () => {
    const comment = [
        '<img src="https://www.contoso.com/static/v1?label=Deployment&message=Valid&color=green">',
        "<p />",
        "**Below deployments will be triggered on merging this PR:**",
        '<table><tr><td>App</td><td><strong>SampleApp</strong></td></tr></table>',
        '<p align="right"><sub>Total execution time: 20.39 seconds</sub></p>',
    ].join("\n\n");
    const html = markdownToHtml(comment);
    for (const tag of ["img", "table", "tr", "td", "strong", "sub"]) {
        assert.ok(html.includes(`<${tag}`), `bot comment lost <${tag}>: ${html}`);
    }
});

test("allow-listed and unwrapped markup both reach the sanitizer", needsDom, () => {
    for (const tag of ["details", "summary", "font", "small"]) {
        const html = markdownToHtml(`text <${tag}>inner</${tag}> tail`);
        assert.ok(html.includes(`<${tag}>`), `<${tag}> should stay markup for the sanitizer: ${html}`);
    }
});

test("markup that spans several lines is still markup", needsDom, () => {
    // Bot comments put the opening tag, the body and the closing tag on their
    // own lines, so pairing a tag with its other half cannot be line scoped.
    for (const tag of ["p", "a", "strong", "table", "details"]) {
        const open = tag === "a" ? '<a href="https://www.contoso.com">' : `<${tag}>`;
        const html = markdownToHtml(`${open}\ninner text\n</${tag}>`);
        assert.ok(!html.includes(`&lt;${tag}`), `<${tag}> was shown literally: ${html}`);
        assert.ok(html.includes("inner text"), `<${tag}> lost its text: ${html}`);
    }
});

test("tag-shaped prose inside an HTML block stays visible", needsDom, () => {
    const source = "<div>\nReturns Vec<String>\n</div>";
    const html = markdownToHtml(source);
    assert.match(html, /<div>/);
    assert.match(html, /Vec&lt;String&gt;/);

    const rendered = document.createElement("div");
    renderRichText(rendered, source, { format: "markdown" });
    assert.equal(rendered.textContent.trim(), "Returns Vec<String>");
});

test("real markup after tag-shaped prose in an HTML block still renders", needsDom, () => {
    const html = markdownToHtml("<String>\n<b>bold</b>");
    assert.match(html, /&lt;String&gt;/);
    assert.match(html, /<b>bold<\/b>/);
});

test("a closing tag inside a code block does not turn a type parameter into markup", needsDom, () => {
    const html = markdownToHtml(["Use Vec<Config> in the handler.", "", "```xml", "<config>a</config>", "```"].join("\n"));
    assert.ok(html.includes("Vec&lt;Config&gt;"), html);
});

test("a tag name that is not an HTML element is escaped even when it pairs", needsDom, () => {
    // Pairing alone cannot decide: "Vec<Foo>bar</Foo>" is a type parameter, not
    // an element. Azure DevOps draws the line at the tag name too, escaping
    // <Foo> and <blink> while rendering <u> and <table>.
    for (const tag of ["Foo", "Config", "TEntity", "blink"]) {
        const html = markdownToHtml(`text <${tag}>inner</${tag}> tail`);
        assert.ok(html.includes(`&lt;${tag}&gt;`), `<${tag}> must be escaped, got: ${html}`);
        assert.ok(html.includes(`&lt;/${tag}&gt;`), `</${tag}> must be escaped, got: ${html}`);
        assert.ok(html.includes("inner"), `<${tag}> lost its text: ${html}`);
    }
});

test("an element elsewhere in the comment cannot vouch for a type parameter", needsDom, () => {
    // Deciding markup by whether a name appears anywhere in the document lets
    // unrelated markup stand in for the other half of a type parameter. A bot
    // comment that renders a table must not delete "List<Table>" from the prose
    // beside it, and a closing tag quoted in a comment or a link must not either.
    const cases = [
        ["Use List<Table> here.\n\n<table><tr><td>x</td></tr></table>", "List&lt;Table&gt;"],
        ["</span>\n\nCache<Span> charlie", "Cache&lt;Span&gt;"],
        ["<!-- </u> -->\n\nVec<U> bravo", "Vec&lt;U&gt;"],
        ["[a](http://www.contoso.com/</u>)\n\nVec<U> bravo", "Vec&lt;U&gt;"],
        ["**Deploys:**\n\n<table><tr><td>App</td></tr></table>\n\nCheck List<Table> too.", "List&lt;Table&gt;"],
    ];
    for (const [source, expected] of cases) {
        const html = markdownToHtml(source);
        assert.ok(html.includes(expected), `${source} -> ${html}`);
    }
    // The table in the first case still has to render as a table.
    assert.match(markdownToHtml("Use List<Table> here.\n\n<table><tr><td>x</td></tr></table>"), /<table>/);
});

test("lone tags outside the allow-list are escaped so their text stays visible", needsDom, () => {
    for (const tag of ["repo", "org", "skillname", "String", "SigningKeyProvider"]) {
        const html = markdownToHtml(`text <${tag}> tail`);
        assert.ok(html.includes(`&lt;${tag}&gt;`), `<${tag}> must be escaped, got: ${html}`);
        assert.ok(html.includes("tail"), `<${tag}> swallowed trailing text: ${html}`);
    }
});

test("dropped element names in Markdown are escaped so they cannot swallow prose", needsDom, () => {
    for (const tag of DROPPED_TAGS) {
        const source = `before <${tag}> after`;
        const html = markdownToHtml(source);
        assert.ok(html.includes(`&lt;${tag}&gt;`), `${source} became markup: ${html}`);
        assert.ok(html.includes("after"), `${source} swallowed trailing text: ${html}`);
    }
});

// The five lines posted to the manual repro pull request.

test("the manual repro lines all round-trip", needsDom, () => {
    const lines = [
        ["Vec<String> loses its type parameter", "Vec&lt;String&gt;"],
        ["Task<HttpResponseMessage> also loses it", "Task&lt;HttpResponseMessage&gt;"],
        ["Vec<U> loses it too", "Vec&lt;U&gt;"],
        ["Vec<&str> survives", "Vec&lt;&amp;str&gt;"],
    ];
    for (const [source, expected] of lines) {
        assert.ok(markdownToHtml(source).includes(expected), `${source} -> ${markdownToHtml(source)}`);
    }
    assert.match(markdownToHtml("`Vec<String>` survives"), /<code>Vec&lt;String&gt;<\/code>/);
});

test("code spans and fences win over tag detection", needsDom, () => {
    assert.match(markdownToHtml("use `Vec<String>` here"), /<code>Vec&lt;String&gt;<\/code>/);
    assert.match(markdownToHtml("use `<div>` here"), /<code>&lt;div&gt;<\/code>/);
    assert.match(markdownToHtml("```\nlet x: Vec<U>;\n```"), /<pre><code>let x: Vec&lt;U&gt;;\s*<\/code><\/pre>/);
});

// An entity is an encoding of a character, not text in its own right, and the
// renderer decodes it the way Azure DevOps does. What must not happen is the
// character being lost or double-escaped, so assert on what the reader sees
// rather than on the bytes, which differ between renderers.
test("character entities survive as their character", needsDom, () => {
    const characters = { "&amp;": "&", "&lt;": "<", "&#39;": "'", "&#x27;": "'", "&nbsp;": "\u00a0" };
    for (const [entity, character] of Object.entries(characters)) {
        const host = document.createElement("div");
        renderRichText(host, `a ${entity} b`, { format: "markdown" });
        assert.equal(host.textContent.trim(), `a ${character} b`, `${entity} was mangled`);
    }
    assert.match(markdownToHtml("Tom & Jerry"), /Tom &amp; Jerry/);
});

test("comparison operators are left alone", needsDom, () => {
    for (const source of ["a < b", "x <= y", "if (i < n)", "5 < 10 > 2"]) {
        assert.ok(markdownToHtml(source).includes("&lt;"), `${source} lost its operator`);
    }
});

test("markdown structure is unchanged", needsDom, () => {
    assert.match(markdownToHtml("# Title"), /<h1>Title<\/h1>/);
    assert.match(markdownToHtml("- one\n- two"), /<ul>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ul>/);
    assert.match(markdownToHtml("**bold**"), /<strong>bold<\/strong>/);
    assert.match(markdownToHtml("[text](https://www.contoso.com)"), /<a href="https:\/\/www\.contoso\.com"/);
    assert.match(markdownToHtml("> quoted"), /<blockquote>/);
});

test("looksLikeHtml only fires on real markup", needsDom, () => {
    assert.equal(looksLikeHtml("<div>x</div>"), true);
    assert.equal(looksLikeHtml("Vec<String>"), false);
    assert.equal(looksLikeHtml("a < b"), false);
    // Case matters: bots emit lowercase HTML, while an uppercase run of the same
    // shape is a type parameter. Treating it as HTML skips markdown escaping and
    // the sanitizer then unwraps the element, taking the text with it.
    assert.equal(looksLikeHtml("Vec<U>"), false);
    assert.equal(looksLikeHtml("List<Table>"), false);
    // Known limit of guessing: one real tag commits the whole value to the HTML
    // path, where an uppercase type parameter beside it is parsed and unwrapped.
    // Pull request text, whose format the caller knows, asks for markdown. Work
    // item comments and fields keep guessing, because guessing turns out to be
    // the lossless choice: of 294 comments read from one organisation, the 53
    // carrying real HTML route here and render identically to format "html",
    // while the rest are plain text that format "html" would damage.
    assert.equal(looksLikeHtml("Use List<Table> here.\n\n<table><tr><td>x</td></tr></table>"), true);
});

// Azure DevOps stores an unresolved mention as "@<guid>", which is shaped like a
// tag. It used to be passed through as markup, so the parser made it an element
// and the sanitizer unwrapped it away, losing the identity the comment names.
//
// A guid is never an element name, so the allow-list is what rejects it; case
// plays no part, which is why the lowercase form is covered too. Only guids
// starting with a letter were ever affected, because the tag pattern needs a
// letter first, and that is asserted below so a later edit cannot quietly leave
// this testing nothing. Digit-leading guids were always escaped. All synthetic.
test("an unresolved mention keeps its identity", needsDom, () => {
    const guids = [
        "AB12CD34-5E6F-7A89-BC01-DE23F4567890",
        "ab12cd34-5e6f-7a89-bc01-de23f4567890",
        "3F2504E0-4F89-11D3-9A0C-0305E82C3301",
    ];
    assert.match(guids[0], /^[a-zA-Z]/, "a digit-leading guid never reaches the tag pattern");
    for (const guid of guids) {
        const source = `@<${guid}> has a change coming soon`;
        assert.equal(looksLikeHtml(source), false);
        const html = markdownToHtml(source);
        assert.ok(html.includes(guid), `${guid} lost its identity: ${html}`);
        assert.ok(!html.includes(`<${guid}`), `${guid} was parsed as an element: ${html}`);
    }
});

test("adversarial input stays linear", needsDom, () => {
    for (const source of ["![a](".repeat(20000), "<".repeat(50000), "*".repeat(50000)]) {
        const started = Date.now();
        markdownToHtml(source);
        assert.ok(Date.now() - started < 10000, "rendering took too long");
    }
});

test("a backtick heavy comment does not scan the document quadratically", needsDom, () => {
    // Ambiguous backreference regexes run over the whole comment cost seconds on
    // input this size, which freezes the canvas while a comment renders.
    const started = Date.now();
    markdownToHtml("`".repeat(60000));
    assert.ok(Date.now() - started < 1000, `rendering took ${Date.now() - started}ms`);
});

test("sanitizer", needsDom, async (t) => {
    const render = (value, options) => {
        const node = document.createElement("div");
        renderRichText(node, value, options);
        return node;
    };

    await t.test("authored text is never deleted", () => {
        const sources = [
            "Return Vec<String> from the handler",
            "Return Vec<U> from the handler",
            "Await the Task<HttpResponseMessage> result",
            "Cast it to Foo<TD> before indexing",
            "The generic <T> parameter is unbound",
        ];
        for (const source of sources) {
            assert.equal(render(source, { format: "markdown" }).textContent.trim(), source);
        }
    });

    await t.test("authored text is never deleted when the format is auto-detected", () => {
        // The canvas renders with the default "auto" format. Forcing "markdown"
        // above skips looksLikeHtml entirely, so an uppercase type parameter that
        // spells a tag name would route to the raw HTML path untested.
        const sources = [
            "Return Vec<U> from the handler",
            "Pass Option<B> instead",
            "Cast it to List<Table> first",
            "Wrap it in Cache<Span> for reuse",
        ];
        for (const source of sources) {
            assert.equal(render(source).textContent.trim(), source);
        }
    });

    await t.test("uppercase HTML in auto format is preserved as literal text", () => {
        const source = "<P>Hello <B>world</B></P>";
        assert.equal(render(source).textContent.trim(), source);
    });

    await t.test("scripts and handlers never reach the DOM", () => {
        const payloads = [
            "<script>alert(1)</script>",
            "<img src=x onerror=alert(1)>",
            "<a href=\"javascript:alert(1)\">x</a>",
            "<a href=\"&#106;avascript:alert(1)\">x</a>",
            "<iframe srcdoc=\"<script>alert(1)</script>\"></iframe>",
            "<form><button formaction=\"javascript:alert(1)\">x</button></form>",
            "<svg><script>alert(1)</script></svg>",
            "<div style=\"background:url(javascript:alert(1))\">x</div>",
            "<template><script>alert(1)</script></template>",
            "<noscript><p title=\"</noscript><img src=x onerror=alert(1)>\">",
            "<a href=\"//evil.example\">x</a>",
            "<a href=\"/\\evil.example\">x</a>",
        ];
        for (const format of ["markdown", "html", "auto"]) {
            for (const payload of payloads) {
                const node = render(payload, { format });
                assert.equal(node.querySelectorAll("script, iframe, object, embed, form, style").length, 0,
                    `${payload} (${format}) left a dangerous element`);
                for (const element of node.querySelectorAll("*")) {
                    for (const attribute of element.attributes) {
                        assert.ok(!attribute.name.startsWith("on"),
                            `${payload} (${format}) kept ${attribute.name}`);
                        assert.ok(!/javascript:/i.test(attribute.value),
                            `${payload} (${format}) kept a javascript: url`);
                    }
                }
                for (const anchor of node.querySelectorAll("a[href]")) {
                    assert.ok(!/^(?:\/\/|\/\\)/.test(anchor.getAttribute("href")),
                        `${payload} (${format}) kept a protocol-relative url`);
                }
            }
        }
    });

    await t.test("links are forced to open safely", () => {
        const anchor = render("[x](https://www.contoso.com)", { format: "markdown" }).querySelector("a");
        assert.equal(anchor.getAttribute("target"), "_blank");
        assert.equal(anchor.getAttribute("rel"), "noopener noreferrer");
    });

    await t.test("only checkbox inputs survive", () => {
        assert.equal(render("<input>", { format: "html" }).querySelectorAll("input").length, 0);
        assert.equal(render("<input type=\"text\">", { format: "html" }).querySelectorAll("input").length, 0);
        assert.equal(render("<input type=\"checkbox\">", { format: "html" }).querySelectorAll("input").length, 1);
    });

    await t.test("corpus text is never deleted", () => {
        for (const entry of TYPE_PARAMETERS) {
            const text = render(entry.source, { format: "markdown" }).textContent;
            for (const expected of entry.text) {
                assert.ok(text.includes(expected), `${entry.id}: lost "${expected}" -> ${text}`);
            }
        }
        for (const entry of COLLAPSIBLE_MARKUP) {
            const text = render(entry.source, { format: "markdown" }).textContent;
            for (const expected of entry.text) {
                assert.ok(text.includes(expected), `${entry.id}: lost "${expected}" -> ${text}`);
            }
        }
    });

    await t.test("corpus markup renders as elements", () => {
        for (const entry of BOT_MARKUP) {
            const node = render(entry.source, { format: "markdown" });
            for (const tag of entry.markup) {
                assert.ok(node.querySelector(tag), `${entry.id}: lost <${tag}> -> ${node.innerHTML}`);
            }
        }
    });

    await t.test("no corpus entry can produce script or handlers", () => {
        for (const entry of [...TYPE_PARAMETERS, ...BOT_MARKUP, ...COLLAPSIBLE_MARKUP]) {
            const node = render(entry.source, { format: "markdown" });
            assert.equal(node.querySelectorAll("script, iframe, object, embed, form, style").length, 0, entry.id);
            for (const element of node.querySelectorAll("*")) {
                for (const attribute of element.attributes) {
                    assert.ok(!attribute.name.startsWith("on"), `${entry.id} kept ${attribute.name}`);
                }
            }
        }
    });

    await t.test("bot markup still renders as elements", () => {
        const node = render('<table><tr><td><strong>SampleApp</strong></td></tr></table>', { format: "markdown" });
        assert.equal(node.querySelectorAll("table td strong").length, 1);
    });
});
