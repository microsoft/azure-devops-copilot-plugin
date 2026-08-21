// Run with: node --test rich-text-policy.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { isSafeWriteUrl, sanitizeHtmlSource, validateEditableHtml, validateWriteHtml } from "./ui/rich-text-policy.mjs";

test("markup the editor produces is accepted", () => {
    const html = '<p>Plain <strong>bold</strong>, <em>italic</em>, <u>underline</u>, <s>struck</s>, <code>code</code>.</p>' +
        '<ul><li>one</li><li>two</li></ul><ol><li>first</li></ol>' +
        '<blockquote><p>quoted</p></blockquote><h2>Heading</h2><p>Line<br>break</p>' +
        '<p><a href="https://example.com" title="t">link</a></p>';
    assert.deepEqual(validateWriteHtml(html), { ok: true, violations: [] });
});

test("the div wrapper the Azure DevOps editor emits is accepted", () => {
    // Excluding div would trip the fidelity gate on most real work item fields.
    assert.equal(validateWriteHtml("<div>Written in the Azure DevOps UI.</div>").ok, true);
});

test("browser and editor formatting is rejected rather than stripped", () => {
    for (const html of [
        '<p><font color="red">red</font></p>',
        '<p><span style="font-weight:bold">bold</span></p>',
        "<p><b>bold</b></p>",
        "<center>centered</center>",
    ]) {
        assert.equal(validateWriteHtml(html).ok, false, html);
    }
    assert.match(
        validateWriteHtml('<p><font color="red">red</font></p>').violations[0],
        /browser or editor formatting/,
    );
});

test("attributes outside the policy are violations", () => {
    assert.match(validateWriteHtml('<p class="x">text</p>').violations[0], /not an attribute/);
    assert.match(validateWriteHtml('<p style="color:red">text</p>').violations[0], /not an attribute/);
    assert.equal(validateWriteHtml('<a href="https://example.com" target="_blank">x</a>').ok, false);
});

test("unsafe link schemes are violations", () => {
    assert.match(validateWriteHtml('<a href="javascript:alert(1)">x</a>').violations[0], /URL scheme/);
    assert.match(validateWriteHtml('<a href="data:text/html;base64,PHA+">x</a>').violations[0], /URL scheme/);
    assert.equal(validateWriteHtml('<a href="mailto:someone@example.com">x</a>').ok, true);
    assert.equal(validateWriteHtml('<a href="#anchor">x</a>').ok, true);
});

test("rich content Azure DevOps supports but the editor cannot round-trip is rejected", () => {
    // Tables and images render fine but are outside what the toolbar can produce,
    // so editing them would silently drop them on save.
    assert.equal(validateWriteHtml("<table><tr><td>cell</td></tr></table>").ok, false);
    assert.equal(validateWriteHtml('<p><img src="https://example.com/a.png"></p>').ok, false);
});

test("broken nesting is reported once rather than cascading", () => {
    const result = validateWriteHtml("<p>text</em></p>");
    assert.equal(result.ok, false);
    assert.equal(result.violations.filter((entry) => entry.includes("nesting")).length, 1);
});

test("an unclosed element is reported", () => {
    assert.match(validateWriteHtml("<p>text").violations[0], /never closed/);
});

test("void elements do not count as unclosed", () => {
    assert.equal(validateWriteHtml("<p>a<br>b</p>").ok, true);
});

test("escaped text is not mistaken for markup", () => {
    assert.equal(validateWriteHtml("<p>2 &lt; 3 &amp;&amp; 4 &gt; 1</p>").ok, true);
});

test("prose containing angle brackets is not mistaken for markup", () => {
    // Work item titles routinely contain these. Treating "< " as the start of a
    // tag would make an ordinary title unsaveable.
    for (const text of [
        "a < b",
        "a < b and c > d",
        "if (x < y && y > z)",
        "temp < 5 degrees",
        "< not a tag >",
    ]) {
        assert.deepEqual(validateWriteHtml(text), { ok: true, violations: [] }, text);
    }
});

test("real tags in prose are still seen", () => {
    // These are genuine markup as far as any HTML parser is concerned, so the
    // policy must still catch them when the field is an HTML one.
    assert.equal(validateWriteHtml("Support List<string> in the parser").ok, false);
    assert.equal(validateWriteHtml("Refactor <div> layout").ok, false);
});

test("an empty list item is a violation", () => {
    const result = validateWriteHtml("<ul><li></li><li>b</li></ul>");
    assert.equal(result.ok, false);
    assert.match(result.violations[0], /empty list item/i);
    assert.equal(validateWriteHtml("<ul><li>a</li><li>b</li></ul>").ok, true);
});

test("whitespace-only blocks are allowed", () => {
    assert.equal(validateWriteHtml("<div>a</div><div>&nbsp;</div><div>b</div>").ok, true);
});

test("HTML comments are rejected rather than silently dropped", () => {
    assert.equal(validateWriteHtml("<p>a</p><!-- x -->").ok, false);
    assert.equal(validateWriteHtml("<p>a</p><!-- unterminated").ok, false);
});

test("markup inside a comment is not reported as broken nesting", () => {
    // The comment body is not real markup, so it must not produce a violation
    // that misdescribes why the field was refused.
    const result = validateWriteHtml("<p>a</p><!-- <p>x -->");
    assert.equal(result.ok, false);
    assert.ok(result.violations.every((entry) => !entry.includes("nesting")), result.violations.join("; "));
});

test("an empty value has nothing to violate", () => {
    assert.equal(validateWriteHtml("").ok, true);
    assert.equal(validateWriteHtml("   ").ok, true);
    assert.equal(validateWriteHtml("<div><p>Fine</p></div>").ok, true);
});

test("a violation always carries a reason an agent can act on", () => {
    const result = validateWriteHtml('<p><font color="#ff0000">Important</font></p>');
    assert.equal(result.ok, false);
    assert.ok(result.violations[0].length > 0);
});

test("isSafeWriteUrl strips control characters before testing the scheme", () => {
    assert.equal(isSafeWriteUrl("https://example.com"), "https://example.com");
    assert.equal(isSafeWriteUrl("java\tscript:alert(1)"), "");
    assert.equal(isSafeWriteUrl("  https://example.com  "), "https://example.com");
    assert.equal(isSafeWriteUrl("ftp://example.com"), "");
});

test("the preserve policy accepts the markup Azure DevOps already stores", () => {
    for (const html of [
        '<div><span style="color:#ff0000">Critical</span></div>',
        '<div><a href="#" data-vss-mention="version:2.0,8a7b-guid">@John Doe</a></div>',
        '<table border="1"><tbody><tr><td width="100">cell</td></tr></tbody></table>',
        '<div><font color="red">legacy</font></div>',
        '<p class="MsoNormal" style="mso-margin-top-alt:auto">Pasted</p>',
        '<div><img src="https://dev.azure.com/org/_apis/wit/attachments/a5c?fileName=x.png"></div>',
    ]) {
        assert.deepEqual(validateEditableHtml(html), { ok: true, violations: [] }, html);
    }
});

test("the write policy rejects that same markup, which is why the two differ", () => {
    // The allow-list asks whether this editor could have authored the markup. For
    // content Azure DevOps already held, that is the wrong question.
    assert.equal(validateWriteHtml('<div><font color="red">legacy</font></div>').ok, false);
    assert.equal(validateEditableHtml('<div><font color="red">legacy</font></div>').ok, true);
});

test("the preserve policy still refuses markup that runs", () => {
    assert.match(validateEditableHtml("<div>hi<script>alert(1)</script></div>").violations[0], /execute/);
    assert.match(validateEditableHtml('<div onclick="steal()">x</div>').violations[0], /event handler/);
    assert.match(validateEditableHtml('<iframe src="https://example.com"></iframe>').violations[0], /execute/);
    assert.match(validateEditableHtml('<a href="javascript:alert(1)">x</a>').violations[0], /URL scheme/);
});

test("the preserve policy does not count a void element as unclosed", () => {
    // ALL_VOID_TAGS exists for this: the write policy only ever sees br, but the
    // preserve policy sees whatever Azure DevOps stored.
    assert.equal(validateEditableHtml('<div><img src="https://example.com/a.png"><hr><br></div>').ok, true);
});

test("the preserve policy keeps a well-formed comment editable", () => {
    // Unlike the write policy, this one hands back content Azure DevOps already
    // stored, and a comment is content it is entitled to store. Rejecting one
    // would make every field that contains it read-only for no gain.
    assert.deepEqual(
        validateEditableHtml("<div><!-- stored by some other tool -->text</div>"),
        { ok: true, violations: [] },
    );
});

test("the preserve policy does not read a quoted attribute value as markup", () => {
    // "<" is not escaped in a serialized attribute value, so this is markup Azure
    // DevOps can hand back and the round trip preserves. Testing the raw string
    // for "<!--" would call it an unterminated comment and send the field
    // read-only -- the silent loss of editability this policy exists to avoid.
    assert.deepEqual(
        validateEditableHtml('<div><a title="use <!-- to open a comment">x</a></div>'),
        { ok: true, violations: [] },
    );
    assert.deepEqual(
        validateEditableHtml("<div><a title='an <!-- opener'>x</a></div>"),
        { ok: true, violations: [] },
    );
});

test("the preserve policy refuses an unterminated comment", () => {
    // The strip cannot remove "<!--" with no terminator after it, which leaves the
    // tag scan reading markup a browser would treat as comment text. The two must
    // not be allowed to disagree about the same value.
    assert.match(validateEditableHtml("<div><!-- unclosed</div>").violations[0], /unterminated/);
    assert.match(
        validateEditableHtml("<div><!-- done --><!-- and then not</div>").violations[0],
        /unterminated/,
    );
    // A stray opener is still caught when the value also has a quoted "<!--",
    // which is what makes the tag-aware test above a narrowing and not a hole.
    assert.match(
        validateEditableHtml('<div><a title="<!--">x</a><!-- unclosed</div>').violations[0],
        /unterminated/,
    );
    assert.equal(validateEditableHtml("<div><!-- done --></div>").ok, true);
});

test("the preserve policy refuses a comment the serializer would rewrite", () => {
    // "-->" is not the only terminator a browser honours: "<!-->" and "<!--->"
    // are complete empty comments and "--!>" closes one. But the serializer
    // normalizes all three, so opening such a field for editing would save the
    // parser's rewrite over bytes the user never touched. Read-only is the lesser
    // of the two, and the message says preservation rather than termination
    // because a browser does read these as closed.
    for (const html of [
        "<div><!--> </div>",
        "<div><!---> x</div>",
        "<div><!-- ok --!>text</div>",
    ]) {
        assert.deepEqual(
            validateEditableHtml(html),
            { ok: false, violations: ["this HTML comment cannot be preserved by this editor"] },
            html,
        );
    }
});

test("an unterminated comment is named as unterminated, not just unpreservable", () => {
    // The two shapes both keep a field read-only, but only one is the tokenizer
    // never leaving comment state, so the messages have to stay distinguishable.
    assert.deepEqual(validateEditableHtml("<div><!-- unclosed</div>"), {
        ok: false,
        violations: ["an unterminated HTML comment cannot be saved"],
    });
});

test("an attribute name holding a comment opener does not hide the tag", () => {
    // "<" is an ordinary attribute-name character once a tag is open, so
    // "<a <!-- onclick=... -->" is a single tag with a live handler and no comment
    // at all. A tag pattern that stops at "<" would fail here and let the comment
    // branch delete the handler before the scan ever saw it.
    assert.match(
        validateEditableHtml('<div><a <!-- onclick="alert(1)" --> href="#">z</a></div>').violations[0],
        /event handler/,
    );
    assert.match(
        validateEditableHtml('<div><a <!-- href="javascript:alert(1)" -->z</a></div>').violations[0],
        /javascript:|URL|href/,
    );
});

test("a comment cannot open in one attribute value and close in another", () => {
    // "<!--" inside a quoted value is text to the tokenizer, so a comment strip
    // that ignores tag boundaries can span from one attribute value to another and
    // delete the real attributes in between. A browser parses both of these as an
    // <a> with a live handler, so the scan has to see them too.
    assert.match(
        validateEditableHtml('<div><a title="x <!--" onclick="alert(1)" data-y="-->">z</a></div>').violations[0],
        /event handler/,
    );
    assert.match(
        validateEditableHtml('<div><a title="q <!--" href="javascript:alert(1)" data-y="-->">z</a></div>').violations[0],
        /URL scheme/,
    );
});

test("the write policy still refuses every comment, terminated or not", () => {
    // The asymmetry with the preserve policy above is deliberate, not drift.
    assert.match(validateWriteHtml("<div><!-- note --></div>").violations[0], /comments/);
    assert.match(validateWriteHtml("<div><!-- unclosed</div>").violations[0], /comments/);

    // Including the terminators the preserve policy refuses for a different
    // reason. Those two policies part company over whether a comment round-trips;
    // this one never authors a comment at all, so every shape a browser reads as
    // one has to be refused here, or a narrower strip lets it through unnoticed.
    for (const html of [
        "<div><!--></div>",
        "<div><!---></div>",
        "<div><!-- ok --!></div>",
    ]) {
        assert.match(validateWriteHtml(html).violations[0] ?? "", /comments/, html);
    }
});

test("the string strip removes executable markup along with its content", () => {
    // The content goes with the tag: leaving it behind would hand the parser the
    // body of a script as if it were text the field had always held.
    assert.equal(sanitizeHtmlSource("<div>hi<script>alert(1)</script></div>"), "<div>hi</div>");
    assert.equal(sanitizeHtmlSource("<div>a<style>p{color:red}</style>b</div>"), "<div>ab</div>");
    assert.equal(sanitizeHtmlSource("<div><svg><circle r='1'/></svg>x</div>"), "<div>x</div>");
    assert.equal(sanitizeHtmlSource('<div><iframe src="//evil.example"></iframe>x</div>'), "<div>x</div>");
    // Void executable elements close nothing, so nothing after them is skipped.
    assert.equal(sanitizeHtmlSource('<div><meta charset="utf-8">kept</div>'), "<div>kept</div>");
});

test("the string strip removes what executes from a tag and keeps the rest", () => {
    assert.equal(sanitizeHtmlSource('<div onclick="steal()" id="x">t</div>'), '<div  id="x">t</div>');
    assert.equal(sanitizeHtmlSource('<a href="javascript:alert(1)" title="t">x</a>'), '<a  title="t">x</a>');
    assert.equal(sanitizeHtmlSource('<a href="//evil.example/x">x</a>'), "<a >x</a>");
});

test("the string strip hands back markup with nothing to remove byte for byte", () => {
    // The round trip this module promises is a byte-level one, so a pass that
    // rebuilt every tag it read would break it on markup that was already clean.
    for (const html of [
        '<div style="color:red"><font size="2">kept</font></div>',
        '<table border="1"><tr><td width="100">cell</td></tr></table>',
        '<a href="https://example.com" title="t">link</a>',
        '<span data-vss-mention="version:2.0,abc">@Someone</span>',
        "<div><!-- terminated -->text</div>",
        "<P CLASS='x'>upper</P>",
        "",
    ]) {
        assert.equal(sanitizeHtmlSource(html), html, html);
    }
});

test("the string strip is not fooled by a comment opened inside an attribute", () => {
    // The one-pass tokenizer matters here: stripping comments first would delete
    // the run between two attribute values and take the live onclick with it,
    // making the markup look clean rather than removing the handler.
    const html = '<a title="x <!--" onclick="alert(1)" data-y="-->">t</a>';
    const stripped = sanitizeHtmlSource(html);
    assert.doesNotMatch(stripped, /onclick/i);
    assert.match(stripped, /title="x <!--"/);
});
