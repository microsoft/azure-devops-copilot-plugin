// Run with: node --test comment-composer.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

let JSDOM;
try {
    ({ JSDOM } = await import("jsdom"));
} catch {
    JSDOM = null;
}
const needsDom = { skip: JSDOM ? false : "jsdom is not installed" };

let createCommentComposer;
let serializeCommentBody;
if (JSDOM) {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
        url: "http://localhost/",
        pretendToBeVisual: true,
    });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.Node = dom.window.Node;
    ({ createCommentComposer, serializeCommentBody } = await import("./ui/comment-composer.mjs"));
}

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

function setCaretAtEnd(node) {
    const selection = node.ownerDocument.getSelection();
    const range = node.ownerDocument.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
}

function setCaret(node, offset) {
    const selection = node.ownerDocument.getSelection();
    const range = node.ownerDocument.createRange();
    range.setStart(node.firstChild, offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
}

test("comment serialization preserves text and emits stable mention tokens", needsDom, () => {
    const body = document.createElement("div");
    body.append(document.createTextNode("Hello "));
    const mention = document.createElement("span");
    mention.className = "comment-mention";
    mention.dataset.mentionId = "identity-guid";
    mention.textContent = "@Ada Lovelace";
    body.append(mention, document.createTextNode("  \nplease review"));

    assert.equal(serializeCommentBody(body), "Hello @<identity-guid>  \nplease review");
});

test("typing @query inline inserts a named chip and submits the Azure DevOps token", needsDom, async () => {
    let submitted = "";
    const composer = createCommentComposer({
        id: "test-comment",
        onSearchIdentities: async () => ({
            identities: [{
                id: "reviewer-id",
                mentionId: "mention-id",
                displayName: "Ada Lovelace",
                uniqueName: "ada@example.com",
            }, {
                id: "reviewer-id-2",
                mentionId: "mention-id-2",
                displayName: "Grace Hopper",
                uniqueName: "grace@example.com",
            }],
        }),
        onSubmit: async (content) => {
            submitted = content;
        },
    });
    document.body.append(composer.host);
    const body = composer.host.querySelector(".comment-composer-body");
    body.textContent = "Please review @Ad";
    body.focus();
    setCaretAtEnd(body);
    body.dispatchEvent(new window.Event("input", { bubbles: true }));
    await settle(300);
    assert.equal(composer.host.querySelector(".comment-mention-picker-input"), null);
    const [ada, grace] = composer.host.querySelectorAll(".comment-mention-picker-add");
    assert.equal(ada.querySelector(".comment-mention-name").textContent, "Ada Lovelace");
    assert.equal(ada.tabIndex, -1);
    assert.equal(ada.getAttribute("aria-selected"), "true");
    assert.equal(body.getAttribute("role"), "textbox");
    assert.equal(body.getAttribute("aria-multiline"), "true");
    assert.equal(body.getAttribute("aria-activedescendant"), ada.id);
    body.dispatchEvent(new window.KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
    }));
    assert.equal(ada.getAttribute("aria-selected"), "false");
    assert.equal(grace.getAttribute("aria-selected"), "true");
    assert.equal(body.getAttribute("aria-activedescendant"), grace.id);
    body.dispatchEvent(new window.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
    }));
    await settle();

    assert.equal(body.querySelector(".comment-mention").textContent, "@Grace Hopper");
    assert.equal(composer.getValue(), "Please review @<mention-id-2> ");
    composer.host.querySelector(".comment-submit").click();
    await settle();
    assert.equal(submitted, "Please review @<mention-id-2> ");
    composer.host.remove();
});

test("Tab accepts a full-name inline mention query", needsDom, async () => {
    const queries = [];
    const composer = createCommentComposer({
        id: "full-name-tab-comment",
        onSearchIdentities: async (query) => {
            queries.push(query);
            return {
                identities: [{
                    mentionId: "carlo-id",
                    displayName: "Carlo Rivera",
                    uniqueName: "crivera@microsoft.com",
                }],
            };
        },
        onSubmit: async () => {},
    });
    document.body.append(composer.host);
    const body = composer.host.querySelector(".comment-composer-body");
    body.textContent = "Please review @Carlo Rivera";
    body.focus();
    setCaretAtEnd(body);
    body.dispatchEvent(new window.Event("input", { bubbles: true }));
    await settle(300);

    assert.deepEqual(queries, ["Carlo Rivera"]);
    const option = composer.host.querySelector(".comment-mention-picker-add");
    assert.equal(option.querySelector(".comment-mention-name").textContent, "Carlo Rivera");
    const tab = new window.KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
    });
    body.dispatchEvent(tab);
    await settle();

    assert.equal(tab.defaultPrevented, true);
    assert.equal(composer.getValue(), "Please review @<carlo-id> ");
    composer.host.remove();
});

test("Tab stays native while inline mention search is still loading", needsDom, () => {
    const composer = createCommentComposer({
        id: "native-tab-comment",
        onSearchIdentities: async () => ({ identities: [] }),
        onSubmit: async () => {},
    });
    document.body.append(composer.host);
    const body = composer.host.querySelector(".comment-composer-body");
    body.textContent = "@Ada";
    body.focus();
    setCaretAtEnd(body);
    body.dispatchEvent(new window.Event("input", { bubbles: true }));
    const picker = composer.host.querySelector(".comment-mention-picker");
    assert.equal(picker.hidden, false);
    assert.equal(picker.querySelectorAll('[role="option"]').length, 0);
    const tab = new window.KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
    });
    body.dispatchEvent(tab);

    assert.equal(tab.defaultPrevented, false);
    composer.host.remove();
});

test("Shift+Tab keeps its native behavior while a mention option is highlighted", needsDom, async () => {
    const composer = createCommentComposer({
        id: "shift-tab-comment",
        onSearchIdentities: async () => ({
            identities: [{ mentionId: "mention-id", displayName: "Ada Lovelace" }],
        }),
        onSubmit: async () => {},
    });
    document.body.append(composer.host);
    const body = composer.host.querySelector(".comment-composer-body");
    body.textContent = "@Ada";
    body.focus();
    setCaretAtEnd(body);
    body.dispatchEvent(new window.Event("input", { bubbles: true }));
    await settle(300);
    const tab = new window.KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
    });
    body.dispatchEvent(tab);

    assert.equal(tab.defaultPrevented, false);
    assert.equal(body.querySelector(".comment-mention"), null);
    composer.host.remove();
});

test("a space immediately after @ does not start identity search", needsDom, async () => {
    let searches = 0;
    const composer = createCommentComposer({
        id: "at-prose-comment",
        onSearchIdentities: async () => {
            searches += 1;
            return { identities: [] };
        },
        onSubmit: async () => {},
    });
    document.body.append(composer.host);
    const body = composer.host.querySelector(".comment-composer-body");
    body.textContent = "Meet @ 3pm tomorrow";
    body.focus();
    setCaretAtEnd(body);
    body.dispatchEvent(new window.Event("input", { bubbles: true }));
    await settle(300);

    assert.equal(searches, 0);
    assert.equal(composer.host.querySelector(".comment-mention-picker").hidden, true);
    composer.host.remove();
});

test("an unaccepted mention query stops before it consumes a sentence", needsDom, async () => {
    const queries = [];
    const composer = createCommentComposer({
        id: "bounded-query-comment",
        onSearchIdentities: async (query) => {
            queries.push(query);
            return { identities: [{ mentionId: "carlo-id", displayName: "Carlo Rivera" }] };
        },
        onSubmit: async () => {},
    });
    document.body.append(composer.host);
    const body = composer.host.querySelector(".comment-composer-body");
    body.textContent = "@carlo";
    body.focus();
    setCaretAtEnd(body);
    body.dispatchEvent(new window.Event("input", { bubbles: true }));
    await settle(300);
    assert.equal(composer.host.querySelector(".comment-mention-picker").hidden, false);

    body.textContent = "@carlo can you review this";
    setCaretAtEnd(body);
    body.dispatchEvent(new window.Event("input", { bubbles: true }));
    await settle(300);

    assert.deepEqual(queries, ["carlo"]);
    assert.equal(composer.host.querySelector(".comment-mention-picker").hidden, true);
    composer.host.remove();
});

test("a long single-token query never reaches identity search", needsDom, async () => {
    let searches = 0;
    const composer = createCommentComposer({
        id: "long-query-comment",
        onSearchIdentities: async () => {
            searches += 1;
            return { identities: [] };
        },
        onSubmit: async () => {},
    });
    document.body.append(composer.host);
    const body = composer.host.querySelector(".comment-composer-body");
    body.textContent = `@${"a".repeat(80)}`;
    body.focus();
    setCaretAtEnd(body);
    body.dispatchEvent(new window.Event("input", { bubbles: true }));
    await settle(300);

    assert.equal(searches, 0);
    assert.equal(composer.host.querySelector(".comment-mention-picker").hidden, true);
    composer.host.remove();
});

test("pointer selection survives WebKit-style blur before click", needsDom, async () => {
    const composer = createCommentComposer({
        id: "webkit-pointer-comment",
        onSearchIdentities: async () => ({
            identities: [{ mentionId: "mention-id", displayName: "Ada Lovelace" }],
        }),
        onSubmit: async () => {},
    });
    document.body.append(composer.host);
    const body = composer.host.querySelector(".comment-composer-body");
    body.textContent = "Ask @Ad";
    body.focus();
    setCaretAtEnd(body);
    body.dispatchEvent(new window.Event("input", { bubbles: true }));
    await settle(300);
    const option = composer.host.querySelector(".comment-mention-picker-add");

    const pointerDown = new window.MouseEvent("mousedown", { bubbles: true, cancelable: true });
    option.dispatchEvent(pointerDown);
    assert.equal(pointerDown.defaultPrevented, true);
    body.blur();
    await settle();
    assert.equal(option.isConnected, true, "the option must survive until its click is delivered");
    option.click();
    await settle();

    assert.equal(composer.getValue(), "Ask @<mention-id> ");
    composer.host.remove();
});

test("abandoned pointer selection still lets focus dismissal close suggestions", needsDom, async () => {
    const composer = createCommentComposer({
        id: "abandoned-pointer-comment",
        onSearchIdentities: async () => ({
            identities: [{ mentionId: "mention-id", displayName: "Ada Lovelace" }],
        }),
        onSubmit: async () => {},
    });
    const outside = document.createElement("button");
    document.body.append(composer.host, outside);
    const body = composer.host.querySelector(".comment-composer-body");
    body.textContent = "Ask @Ad";
    body.focus();
    setCaretAtEnd(body);
    body.dispatchEvent(new window.Event("input", { bubbles: true }));
    await settle(300);
    const option = composer.host.querySelector(".comment-mention-picker-add");
    option.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    document.body.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
    outside.focus();
    await settle();

    assert.equal(composer.host.querySelector(".comment-mention-picker").hidden, true);
    assert.equal(body.hasAttribute("aria-activedescendant"), false);
    composer.host.remove();
    outside.remove();
});

test("an empty comment reports an error without calling the submitter", needsDom, async () => {
    let calls = 0;
    const composer = createCommentComposer({
        id: "empty-comment",
        onSearchIdentities: async () => ({ identities: [] }),
        onSubmit: async () => { calls += 1; },
    });
    document.body.append(composer.host);
    composer.host.querySelector(".comment-composer-body").textContent = " \n ";
    composer.host.querySelector(".comment-submit").click();
    await settle();

    assert.equal(calls, 0);
    assert.equal(composer.host.querySelector(".comment-composer-error").hidden, false);
    composer.host.remove();
});

test("Escape closes inline mention suggestions and keeps focus in the comment", needsDom, () => {
    const composer = createCommentComposer({
        id: "escape-comment",
        onSearchIdentities: async () => ({ identities: [] }),
        onSubmit: async () => {},
    });
    document.body.append(composer.host);
    const body = composer.host.querySelector(".comment-composer-body");
    body.textContent = "@Ad";
    body.focus();
    setCaretAtEnd(body);
    body.dispatchEvent(new window.Event("input", { bubbles: true }));
    const picker = composer.host.querySelector(".comment-mention-picker");
    assert.equal(picker.hidden, false);

    body.dispatchEvent(new window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
    }));
    assert.equal(picker.hidden, true);
    assert.equal(document.activeElement, body);
    composer.host.remove();
});

test("identity search waits for two inline characters after @", needsDom, async () => {
    let searches = 0;
    const composer = createCommentComposer({
        id: "short-query-comment",
        onSearchIdentities: async () => {
            searches += 1;
            return { identities: [] };
        },
        onSubmit: async () => {},
    });
    document.body.append(composer.host);
    const body = composer.host.querySelector(".comment-composer-body");
    body.textContent = "@A";
    body.focus();
    setCaretAtEnd(body);
    body.dispatchEvent(new window.Event("input", { bubbles: true }));
    await settle(300);

    assert.equal(searches, 0);
    assert.equal(composer.host.querySelector(".comment-mention-picker").hidden, true);
    composer.host.remove();
});

test("a new text node does not bypass the mention word boundary", needsDom, async () => {
    let searches = 0;
    const composer = createCommentComposer({
        id: "split-boundary-comment",
        onSearchIdentities: async () => {
            searches += 1;
            return { identities: [] };
        },
        onSubmit: async () => {},
    });
    document.body.append(composer.host);
    const body = composer.host.querySelector(".comment-composer-body");
    body.append(document.createTextNode("abc"), document.createTextNode("@ad"));
    body.focus();
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(body.lastChild, 3);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    body.dispatchEvent(new window.Event("input", { bubbles: true }));
    await settle(300);

    assert.equal(searches, 0);
    assert.equal(composer.host.querySelector(".comment-mention-picker").hidden, true);
    composer.host.remove();
});

for (const tagName of ["div", "p"]) {
    test(`inline mentions open at the start of a new ${tagName.toUpperCase()} line`, needsDom, async () => {
        let searches = 0;
        const composer = createCommentComposer({
            id: `${tagName}-line-comment`,
            onSearchIdentities: async () => {
                searches += 1;
                return { identities: [] };
            },
            onSubmit: async () => {},
        });
        document.body.append(composer.host);
        const body = composer.host.querySelector(".comment-composer-body");
        const firstLine = document.createElement(tagName);
        firstLine.textContent = "line one";
        const secondLine = document.createElement(tagName);
        secondLine.textContent = "@ad";
        body.append(firstLine, secondLine);
        body.focus();
        const selection = document.getSelection();
        const range = document.createRange();
        range.setStart(secondLine.firstChild, 3);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        body.dispatchEvent(new window.Event("input", { bubbles: true }));
        await settle(300);

        assert.equal(searches, 1);
        composer.host.remove();
    });
}

test("inline mentions open in text immediately after a block line", needsDom, async () => {
    let searches = 0;
    const composer = createCommentComposer({
        id: "after-block-comment",
        onSearchIdentities: async () => {
            searches += 1;
            return { identities: [] };
        },
        onSubmit: async () => {},
    });
    document.body.append(composer.host);
    const body = composer.host.querySelector(".comment-composer-body");
    const firstLine = document.createElement("div");
    firstLine.textContent = "line one";
    const secondLine = document.createTextNode("@ad");
    body.append(firstLine, secondLine);
    body.focus();
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(secondLine, 3);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    body.dispatchEvent(new window.Event("input", { bubbles: true }));
    await settle(300);

    assert.equal(searches, 1);
    composer.host.remove();
});

test("submitting while suggestions are open closes and clears the picker", needsDom, async () => {
    const composer = createCommentComposer({
        id: "submit-open-picker",
        onSearchIdentities: async () => ({
            identities: [{ mentionId: "mention-id", displayName: "Ada Lovelace" }],
        }),
        onSubmit: async () => {},
    });
    document.body.append(composer.host);
    const body = composer.host.querySelector(".comment-composer-body");
    body.textContent = "Hello @Ad";
    body.focus();
    setCaretAtEnd(body);
    body.dispatchEvent(new window.Event("input", { bubbles: true }));
    await settle(300);
    assert.equal(composer.host.querySelector(".comment-mention-picker").hidden, false);

    composer.host.querySelector(".comment-submit").click();
    await settle();
    assert.equal(composer.host.querySelector(".comment-mention-picker").hidden, true);
    assert.equal(composer.host.querySelectorAll(".comment-mention-picker-add").length, 0);
    assert.equal(body.textContent, "");
    body.dispatchEvent(new window.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
    }));
    assert.equal(body.querySelector(".comment-mention"), null);
    composer.host.remove();
});

test("an empty identity result does not trap vertical caret movement", needsDom, async () => {
    const composer = createCommentComposer({
        id: "empty-results-comment",
        onSearchIdentities: async () => ({ identities: [] }),
        onSubmit: async () => {},
    });
    document.body.append(composer.host);
    const body = composer.host.querySelector(".comment-composer-body");
    body.textContent = "line one\n@zz";
    body.focus();
    setCaretAtEnd(body);
    body.dispatchEvent(new window.Event("input", { bubbles: true }));
    await settle(300);
    assert.equal(composer.host.querySelector(".comment-mention-picker").hidden, true);
    assert.equal(
        composer.host.querySelector(".comment-mention-picker-status").textContent,
        "No matching people or groups.",
    );

    const arrow = new window.KeyboardEvent("keydown", {
        key: "ArrowUp",
        bubbles: true,
        cancelable: true,
    });
    body.dispatchEvent(arrow);
    assert.equal(arrow.defaultPrevented, false);
    composer.host.remove();
});

test("identity search failures remain visible and do not trap keyboard input", needsDom, async () => {
    const composer = createCommentComposer({
        id: "failed-search-comment",
        onSearchIdentities: async () => ({ identities: [], error: "Directory unavailable." }),
        onSubmit: async () => {},
    });
    document.body.append(composer.host);
    const body = composer.host.querySelector(".comment-composer-body");
    body.textContent = "@Ad";
    body.focus();
    setCaretAtEnd(body);
    body.dispatchEvent(new window.Event("input", { bubbles: true }));
    await settle(300);
    const picker = composer.host.querySelector(".comment-mention-picker");
    assert.equal(picker.hidden, false);
    assert.equal(picker.querySelector(".comment-mention-picker-empty").textContent, "Directory unavailable.");
    assert.equal(picker.querySelector(".comment-mention-picker-empty").getAttribute("role"), "presentation");
    assert.equal(
        composer.host.querySelector(".comment-mention-picker-status").textContent,
        "Directory unavailable.",
    );

    const arrow = new window.KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
    });
    body.dispatchEvent(arrow);
    assert.equal(arrow.defaultPrevented, false);
    composer.host.remove();
});

test("an inline mention replaces only the query in the middle of text", needsDom, async () => {
    const composer = createCommentComposer({
        id: "middle-comment",
        onSearchIdentities: async () => ({
            identities: [{ mentionId: "mention-id", displayName: "Ada Lovelace" }],
        }),
        onSubmit: async () => {},
    });
    document.body.append(composer.host);
    const body = composer.host.querySelector(".comment-composer-body");
    body.textContent = "Ask @Ad please";
    body.focus();
    setCaret(body, 7);
    body.dispatchEvent(new window.Event("input", { bubbles: true }));
    await settle(300);
    composer.host.querySelector(".comment-mention-picker-add").click();
    await settle();

    assert.equal(composer.getValue(), "Ask @<mention-id> please");
    composer.host.remove();
});

test("pointer dismissal closes inline suggestions", needsDom, () => {
    const composer = createCommentComposer({
        id: "pointer-dismiss-comment",
        onSearchIdentities: async () => ({ identities: [] }),
        onSubmit: async () => {},
    });
    document.body.append(composer.host);
    const body = composer.host.querySelector(".comment-composer-body");
    body.textContent = "@Ad";
    body.focus();
    setCaretAtEnd(body);
    body.dispatchEvent(new window.Event("input", { bubbles: true }));
    assert.equal(composer.host.querySelector(".comment-mention-picker").hidden, false);

    document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    assert.equal(composer.host.querySelector(".comment-mention-picker").hidden, true);
    assert.equal(body.hasAttribute("aria-activedescendant"), false);
    composer.host.remove();
});

test("moving focus outside the composer closes inline suggestions", needsDom, async () => {
    const composer = createCommentComposer({
        id: "focus-dismiss-comment",
        onSearchIdentities: async () => ({ identities: [] }),
        onSubmit: async () => {},
    });
    const outside = document.createElement("button");
    document.body.append(composer.host, outside);
    const body = composer.host.querySelector(".comment-composer-body");
    body.textContent = "@Ad";
    body.focus();
    setCaretAtEnd(body);
    body.dispatchEvent(new window.Event("input", { bubbles: true }));
    assert.equal(composer.host.querySelector(".comment-mention-picker").hidden, false);

    outside.focus();
    await settle();
    assert.equal(composer.host.querySelector(".comment-mention-picker").hidden, true);
    composer.host.remove();
    outside.remove();
});

test("IME composition defers mention search and composing Enter is untouched", needsDom, async () => {
    let searches = 0;
    const composer = createCommentComposer({
        id: "ime-comment",
        onSearchIdentities: async () => {
            searches += 1;
            return { identities: [{ mentionId: "mention-id", displayName: "Ada" }] };
        },
        onSubmit: async () => {},
    });
    document.body.append(composer.host);
    const body = composer.host.querySelector(".comment-composer-body");
    body.dispatchEvent(new window.CompositionEvent("compositionstart", { bubbles: true }));
    body.textContent = "@Ad";
    body.focus();
    setCaretAtEnd(body);
    body.dispatchEvent(new window.Event("input", { bubbles: true }));
    body.dispatchEvent(new window.KeyboardEvent("keyup", {
        key: "d",
        isComposing: true,
        bubbles: true,
    }));
    await settle(300);
    assert.equal(searches, 0);

    body.dispatchEvent(new window.CompositionEvent("compositionend", { bubbles: true }));
    await settle(300);
    assert.equal(searches, 1);
    const enter = new window.KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
        cancelable: true,
    });
    body.dispatchEvent(enter);
    assert.equal(enter.defaultPrevented, false);
    assert.equal(body.querySelector(".comment-mention"), null);
    composer.host.remove();
});

test("a persisted draft restores mention chips without changing its token", needsDom, () => {
    const composer = createCommentComposer({
        id: "restored-comment",
        value: "Please ask @<11111111-1111-4111-8111-111111111111> to review.",
        mentions: [{
            mentionId: "11111111-1111-4111-8111-111111111111",
            displayName: "Ada Lovelace",
        }],
        onSearchIdentities: async () => ({ identities: [] }),
        onSubmit: async () => {},
    });
    document.body.append(composer.host);

    assert.equal(composer.host.querySelector(".comment-mention").textContent, "@Ada Lovelace");
    assert.equal(
        composer.getValue(),
        "Please ask @<11111111-1111-4111-8111-111111111111> to review.",
    );
    composer.host.remove();
});
