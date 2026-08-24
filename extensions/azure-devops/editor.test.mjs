// Run with: node --test editor.test.mjs
//
// The editing surfaces are plain text, a fixed set of choices, or Markdown
// source. There is no contenteditable and no HTML round trip, so the property
// worth asserting hardest is that what the user typed is what gets saved --
// including the trailing spaces Azure DevOps reads as a line break.
import assert from "node:assert/strict";
import test from "node:test";

// These extensions ship without node_modules, so jsdom is not guaranteed to be
// present. Skip rather than fail when it is missing, and run with:
//   npm install jsdom && node --test editor.test.mjs
let JSDOM;
try {
    ({ JSDOM } = await import("jsdom"));
} catch {
    JSDOM = null;
}
const needsDom = { skip: JSDOM ? false : "jsdom is not installed" };

if (JSDOM) {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.DOMParser = dom.window.DOMParser;
    globalThis.Node = dom.window.Node;
}

function mount(host) {
    document.body.append(host);
    return host;
}

function tools(editor) {
    return [...editor.host.querySelectorAll(".editor-tool")];
}

function tool(editor, name) {
    return tools(editor).find((node) => node.getAttribute("aria-label").startsWith(name));
}

function click(node) {
    node.dispatchEvent(new window.Event("click"));
}

test("a description is saved exactly as typed, including trailing-space line breaks", needsDom, async () => {
    const { createMarkdownField } = await import("./ui/editor.mjs");
    // Two trailing spaces are how Azure DevOps spells a line break. A round trip
    // through a rich editor is what used to eat them.
    const original = "line one  \nline two\n\n- bullet\n- another";
    const editor = createMarkdownField({ label: "Description", value: original });
    mount(editor.host);

    assert.equal(editor.getValue(), original, "an untouched field returns its source byte for byte");
    assert.equal(editor.isDirty(), false);

    editor.host.remove();
});

test("leading whitespace is kept, because four spaces start a code block", needsDom, async () => {
    const { createMarkdownField } = await import("./ui/editor.mjs");
    // Trimming both ends would turn this indented code block into a paragraph the
    // moment the user edited anything else in the description.
    const original = "    const a = 1;\n\nprose after";
    const editor = createMarkdownField({ label: "Description", value: original });
    mount(editor.host);

    assert.equal(editor.getValue(), original);
    assert.equal(editor.isDirty(), false, "an untouched field is not rewritten");

    editor.host.remove();
});

test("editing marks the field dirty and returns the edited source", needsDom, async () => {
    const { createMarkdownField } = await import("./ui/editor.mjs");
    let dirty = null;
    const editor = createMarkdownField({
        label: "Description",
        value: "before",
        onDirtyChange: (value) => { dirty = value; },
    });
    mount(editor.host);

    const source = editor.host.querySelector(".editor-source");
    source.value = "after  \nwith a break";
    source.dispatchEvent(new window.Event("input"));

    assert.equal(dirty, true);
    assert.equal(editor.getValue(), "after  \nwith a break", "trailing spaces survive the edit");
    editor.host.remove();
});

test("the toolbar inserts Markdown into the source rather than formatting a document", needsDom, async () => {
    const { createMarkdownField } = await import("./ui/editor.mjs");
    const editor = createMarkdownField({ label: "Description", value: "hello world" });
    mount(editor.host);
    const source = editor.host.querySelector(".editor-source");

    source.setSelectionRange(0, 5);
    click(tool(editor, "Bold"));
    assert.equal(source.value, "**hello** world");

    editor.host.remove();
});

test("a formatting shortcut answers to both the plain and shift combinations", needsDom, async () => {
    const { createMarkdownField } = await import("./ui/editor.mjs");
    const editor = createMarkdownField({ label: "Description", value: "hello world" });
    mount(editor.host);
    const source = editor.host.querySelector(".editor-source");

    source.setSelectionRange(0, 5);
    source.dispatchEvent(new window.KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true, cancelable: true }));
    assert.equal(source.value, "**hello** world", "the plain combination should apply bold");

    editor.host.remove();
});

test("preview renders the source and returns to editing", needsDom, async () => {
    const { createMarkdownField } = await import("./ui/editor.mjs");
    const editor = createMarkdownField({ label: "Description", value: "# Heading\n\n- one\n- two" });
    mount(editor.host);

    const source = editor.host.querySelector(".editor-source");
    const preview = editor.host.querySelector(".editor-preview");
    const previewButton = tool(editor, "Preview");

    assert.equal(preview.hidden, true, "editing is the default");

    click(previewButton);
    assert.equal(preview.hidden, false);
    assert.equal(source.hidden, true);
    assert.match(preview.innerHTML, /<h1>Heading<\/h1>/);
    assert.match(preview.innerHTML, /<li>one<\/li>/);

    click(previewButton);
    assert.equal(preview.hidden, true, "the toggle goes back to editing");
    assert.equal(source.hidden, false);

    editor.host.remove();
});

test("preview shows the Azure DevOps line-break behaviour, not the GitHub one", needsDom, async () => {
    const { createMarkdownField } = await import("./ui/editor.mjs");
    const editor = createMarkdownField({ label: "Description", value: "line one\nline two" });
    mount(editor.host);

    click(tool(editor, "Preview"));
    const preview = editor.host.querySelector(".editor-preview");
    assert.doesNotMatch(preview.innerHTML, /<br>/, "a bare newline is not a break in Azure DevOps");

    editor.host.remove();
});

test("an empty description previews as a note rather than a blank pane", needsDom, async () => {
    const { createMarkdownField } = await import("./ui/editor.mjs");
    const editor = createMarkdownField({ label: "Description", value: "" });
    mount(editor.host);
    click(tool(editor, "Preview"));
    assert.match(editor.host.querySelector(".editor-preview").textContent, /Nothing to preview/);
    editor.host.remove();
});

test("applying a link inserts Markdown, and a rejected scheme reports why", needsDom, async () => {
    const { createMarkdownField } = await import("./ui/editor.mjs");
    const editor = createMarkdownField({ label: "Description", value: "text" });
    mount(editor.host);

    const input = editor.host.querySelector(".editor-link-input");
    const apply = editor.host.querySelector(".editor-link-apply");
    const error = editor.host.querySelector(".editor-link-error");

    click(tool(editor, "Insert link"));
    input.value = "javascript:alert(1)";
    click(apply);
    assert.equal(error.hidden, false, "a rejected link should explain itself");
    assert.match(error.textContent, /http, https, or mailto/);
    assert.doesNotMatch(editor.getValue(), /javascript:/, "a refused link must not reach the source");

    input.dispatchEvent(new window.Event("input"));
    assert.equal(error.hidden, true, "editing the URL clears the error");

    const source = editor.host.querySelector(".editor-source");
    source.setSelectionRange(0, 4);
    input.value = "https://example.com/a";
    click(apply);
    assert.equal(error.hidden, true, "an accepted link leaves no error behind");
    assert.match(editor.getValue(), /\]\(https:\/\/example\.com\/a\)/, "the link lands as Markdown");

    editor.host.remove();
});

test("Escape cancels from inside the editor", needsDom, async () => {
    const { createMarkdownField } = await import("./ui/editor.mjs");
    let cancelled = false;
    const editor = createMarkdownField({
        label: "Description",
        value: "text",
        onCancel: () => { cancelled = true; },
    });
    mount(editor.host);
    editor.host.querySelector(".editor-source")
        .dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    assert.equal(cancelled, true);
    editor.host.remove();
});

test("a required plain field blocks the save when emptied", needsDom, async () => {
    const { createPlainField } = await import("./ui/editor.mjs");
    const editor = createPlainField({ label: "Title", value: "has a title", required: true });
    mount(editor.host);
    const input = editor.host.querySelector("input");
    input.value = "   ";
    input.dispatchEvent(new window.Event("input"));
    assert.notEqual(editor.validate(), "", "an empty required field reports an error");
    editor.host.remove();
});

test("the edit affordance is icon-only but keeps an accessible name", needsDom, async () => {
    const { editButton } = await import("./ui/editor.mjs");
    const button = editButton("this work item", () => {});
    assert.equal(button.getAttribute("aria-label"), "Edit this work item");
    assert.equal(button.textContent.trim(), "", "the label is for assistive tech, not the eye");
});
