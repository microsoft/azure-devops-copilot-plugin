// Run with: node --test editable-html.test.mjs
//
// These tests are the losslessness argument for editing work item HTML fields.
// A field is read as HTML and written back as HTML, so there is no format
// conversion in the middle and the round trip is a property of this code rather
// than of Azure DevOps' renderer. That is what makes it checkable here, and it is
// the difference from the Markdown round trip that was removed: predicting what
// Markdown becomes does require Azure DevOps' renderer.
import assert from "node:assert/strict";
import test from "node:test";

let JSDOM;
try {
    ({ JSDOM } = await import("jsdom"));
} catch {
    JSDOM = null;
}
const needsDom = { skip: JSDOM ? false : "jsdom is not installed" };

let canEditStoredHtml;
let fromEditableHtml;
let toEditableFragment;
if (JSDOM) {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.Node = dom.window.Node;
    globalThis.DOMParser = dom.window.DOMParser;
    ({ canEditStoredHtml, fromEditableHtml, toEditableFragment } = await import("./ui/editable-html.mjs"));
}

// Markup Azure DevOps really stores. Every one of these must survive a field being
// opened for editing and saved again untouched.
const STORED = {
    "plain prose": "<div>Ship the thing.</div>",
    "editor bold": "<div>Ship <b>now</b>.</div>",
    "inline style": '<div><span style="color:#ff0000;font-size:14px">Critical</span></div>',
    "mention": '<div><a href="#" data-vss-mention="version:2.0,8a7b-guid">@John Doe</a> please review</div>',
    "attachment image": '<div><img src="https://dev.azure.com/org/_apis/wit/attachments/a5cedde4?fileName=x.png"></div>',
    "font tag": '<div><font color="red">legacy</font></div>',
    "word paste": '<p class="MsoNormal" style="mso-margin-top-alt:auto">Pasted</p>',
    "entities": "<div>2 &lt; 3 &amp;&amp; 4 &gt; 1&nbsp;done</div>",
    "nested lists": "<ul><li>one<ul><li>deep</li></ul></li></ul>",
    // "<" is not escaped in a serialized attribute value, so this round-trips
    // byte-for-byte. It is here because a validator that scans for "<!--" without
    // regard for tag boundaries would send this field read-only.
    "comment opener in an attribute": '<div><a title="use <!-- to open a comment">x</a></div>',
};

for (const [name, stored] of Object.entries(STORED)) {
    test(`${name} survives an untouched edit`, needsDom, () => {
        assert.equal(fromEditableHtml(stored), stored);
        assert.equal(canEditStoredHtml(stored), true);
    });
}

test("a table survives, allowing for the tbody the parser inserts", needsDom, () => {
    // Every HTML parser adds tbody, Azure DevOps' included, so this is the one
    // difference that is not a loss. The attributes are what matter.
    const saved = fromEditableHtml('<table border="1"><tr><td width="100">cell</td></tr></table>');
    assert.match(saved, /border="1"/);
    assert.match(saved, /width="100"/);
});

test("the seed keeps the markup rather than flattening it", needsDom, () => {
    const host = document.createElement("div");
    host.append(toEditableFragment(STORED.mention));
    assert.equal(host.querySelector("a").getAttribute("data-vss-mention"), "version:2.0,8a7b-guid");
});

test("script a paste dragged in is removed on the way out", needsDom, () => {
    assert.equal(fromEditableHtml("<div>hi<script>alert(1)</script></div>"), "<div>hi</div>");
});

test("an event handler a paste dragged in is removed on the way out", needsDom, () => {
    assert.equal(fromEditableHtml('<div onclick="steal()">click</div>'), "<div>click</div>");
});

test("an unusable link scheme is removed on the way out", needsDom, () => {
    assert.equal(fromEditableHtml('<a href="javascript:alert(1)">x</a>'), "<a>x</a>");
});

test("a field holding executable markup is not offered for editing", needsDom, () => {
    // Scrubbing it would drop the script on save, which is an edit the user never
    // made, so the field says so instead of quietly rewriting itself.
    assert.equal(canEditStoredHtml("<div>hi<script>alert(1)</script></div>"), false);
    assert.equal(canEditStoredHtml('<div onclick="steal()">click</div>'), false);
});

test("an ordinary field is offered for editing", needsDom, () => {
    assert.equal(canEditStoredHtml("<div>Just words.</div>"), true);
    assert.equal(canEditStoredHtml(""), true);
});

test("a field holding an unterminated comment is not offered for editing", needsDom, () => {
    // The parse terminates the comment, so every check downstream of it sees a
    // well-formed one and would call the field editable -- and the save would
    // write the parser's repair over the stored value:
    //
    //   fromEditableHtml('<div><!-- unclosed</div>')
    //   -> '<div><!-- unclosed</div>--></div>'
    //
    // That is a change to markup the user never touched, so the gate has to test
    // the stored bytes rather than the round-tripped ones.
    assert.notEqual(fromEditableHtml("<div><!-- unclosed</div>"), "<div><!-- unclosed</div>");
    assert.equal(canEditStoredHtml("<div><!-- unclosed</div>"), false);

    // The check is narrow on purpose. Stored markup leans on implied end tags all
    // the time, and running the whole preserve policy over the raw value would
    // call these broken nesting and cost them their editability.
    assert.equal(canEditStoredHtml("<p>one<p>two"), true);
    assert.equal(canEditStoredHtml("<ul><li>one<li>two</ul>"), true);
    assert.equal(canEditStoredHtml("<div><!-- terminated -->text</div>"), true);
});

test("a field holding a comment the serializer rewrites is not offered for editing", needsDom, () => {
    // A browser reads all three of these as a closed comment, so none is the
    // unterminated case -- but the serializer normalizes every one of them, so
    // opening the field would save a value that differs from the stored bytes.
    // Asserting the round trip first means this fails for the right reason if the
    // serializer ever stops rewriting them.
    for (const stored of [
        "<div><!--> </div>",
        "<div><!---> x</div>",
        "<div><!-- ok --!>text</div>",
    ]) {
        assert.notEqual(fromEditableHtml(stored), stored, stored);
        assert.equal(canEditStoredHtml(stored), false, stored);
    }
});

// The gate and the enforcer are different implementations -- one walks the DOM,
// the other scans a string -- so the property that matters is that they agree.
// Where they do not, a field opens for editing and the save is refused for markup
// the user never touched, which loses their work.
test("anything the gate allows, the server validator also accepts", needsDom, async () => {
    const { validateEditableHtml } = await import("./ui/rich-text-policy.mjs");
    const cases = [
        ...Object.values(STORED),
        "<div>hi<script>alert(1)</script></div>",
        '<div onclick="steal()">click</div>',
        "<xmp><img src=x onerror=alert(1)></xmp>",
        "<noembed><img src=x onerror=alert(1)></noembed>",
        "<noframes><img src=x onerror=alert(1)></noframes>",
        '<form action="javascript:alert(1)"><button>go</button></form>',
        '<form><button formaction="javascript:alert(1)">go</button></form>',
        '<a xlink:href="javascript:alert(1)">x</a>',
        '<img srcset="javascript:alert(1)" src="https://ok.example/a.png">',
        '<svg><desc><img src=x onerror=alert(1)></desc></svg>',
        "<math><mtext>x</mtext></math>",
        '<div><a href="/org/_workitems/edit/42">WI 42</a></div>',
    ];
    for (const html of cases) {
        if (canEditStoredHtml(html)) {
            assert.equal(
                validateEditableHtml(fromEditableHtml(html)).ok,
                true,
                `the gate opened on markup the server refuses: ${html}`,
            );
        }
    }
});

test("a URL scheme that runs is removed from every attribute that carries one", needsDom, () => {
    // Checking only href and src left action, formaction, xlink:href, and srcset
    // as ways to smuggle a scheme into Azure DevOps, whose renderer would run it.
    for (const html of [
        '<form action="javascript:alert(1)"><button>go</button></form>',
        '<form><button formaction="javascript:alert(1)">go</button></form>',
        '<a xlink:href="javascript:alert(1)">x</a>',
        '<img srcset="javascript:alert(1)" src="https://ok.example/a.png">',
    ]) {
        assert.doesNotMatch(fromEditableHtml(html), /javascript:/i, html);
        assert.equal(canEditStoredHtml(html), false, html);
    }
});

test("raw-text elements are removed rather than walked past", needsDom, () => {
    // A DOM walk sees no children inside these, so their contents would otherwise
    // reach the save untouched while the server's string scan rejected them.
    for (const html of ["<xmp><img src=x onerror=alert(1)></xmp>", "<noembed><img src=x onerror=alert(1)></noembed>"]) {
        assert.doesNotMatch(fromEditableHtml(html), /onerror/i, html);
        assert.equal(canEditStoredHtml(html), false, html);
    }
});

test("foreign content is removed, both namespaces alike", needsDom, () => {
    assert.equal(canEditStoredHtml("<svg><circle r='1'/></svg>"), false);
    assert.equal(canEditStoredHtml("<math><mtext>x</mtext></math>"), false);
});

test("a root-relative URL is ordinary content, not a reason to lock the field", needsDom, () => {
    // Azure DevOps stores attachment and work item links this way, so refusing
    // them made everyday fields read-only for content that cannot execute.
    for (const html of [
        '<div><img src="/org/_apis/wit/attachments/abc?fileName=x.png"></div>',
        '<div><a href="/org/_workitems/edit/42">WI 42</a></div>',
    ]) {
        assert.equal(fromEditableHtml(html), html);
        assert.equal(canEditStoredHtml(html), true, html);
    }
    // A protocol-relative URL still leaves the origin, so it is not the same case.
    assert.equal(canEditStoredHtml('<div><a href="//evil.example/x">x</a></div>'), false);
});

test("an obfuscated scheme is refused the same as a plain one", needsDom, () => {
    for (const href of [
        "javascript:alert(1)",
        "  javascript:alert(1)",
        "java\tscript:alert(1)",
        "JaVaScRiPt:alert(1)",
    ]) {
        const html = `<a href="${href}">x</a>`;
        assert.doesNotMatch(fromEditableHtml(html).toLowerCase().replace(/[\s]/g, ""), /javascript:/, html);
    }
});
