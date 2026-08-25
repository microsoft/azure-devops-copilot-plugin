import assert from "node:assert/strict";
import test from "node:test";

let JSDOM;
try {
    ({ JSDOM } = await import("jsdom"));
} catch {
    JSDOM = null;
}
const needsDom = { skip: JSDOM ? false : "jsdom is not installed" };

let renderConnectionPanel;
if (JSDOM) {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    ({ renderConnectionPanel } = await import("./ui/connection-view.mjs"));
}

function render(overrides = {}) {
    const host = document.createElement("section");
    const draftChanges = [];
    const committedOrganizations = [];
    const view = renderConnectionPanel(host, {
        draft: { organization: "Alpha", project: "", repositoryId: "", isDefault: false },
        organizations: ["Alpha", "Beta", "Gamma"],
        projects: ["Project one", "Project two"],
        repositories: ["Repo one", "Repo two"],
        ...overrides,
    }, {
        onDraftChange: (change) => draftChanges.push(change),
        onOrganizationCommitted: (value) => committedOrganizations.push(value),
        onSave() {},
        onClearDefault() {},
        onCancel() {},
    });
    return { host, view, draftChanges, committedOrganizations };
}

test("an exact selection still opens the complete combobox option list", needsDom, () => {
    const { host } = render();
    const input = host.querySelector('[role="combobox"]');

    input.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    assert.equal(input.getAttribute("aria-expanded"), "true");
    assert.deepEqual(
        [...host.querySelectorAll('[role="option"]')].map((option) => option.textContent),
        ["Alpha", "Beta", "Gamma"],
    );
    assert.equal(host.querySelector("datalist"), null);
});

test("typing filters choices and choosing one commits it", needsDom, () => {
    const { host, draftChanges, committedOrganizations } = render();
    const input = host.querySelector('[role="combobox"]');
    input.value = "be";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));

    assert.deepEqual(
        [...host.querySelectorAll('[role="option"]')].map((option) => option.textContent),
        ["Beta"],
    );
    host.querySelector('[role="option"]').dispatchEvent(new window.MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
    }));

    assert.equal(input.value, "Beta");
    assert.deepEqual(draftChanges.at(-1), { organization: "Beta" });
    assert.deepEqual(committedOrganizations, ["Beta"]);
    assert.equal(input.getAttribute("aria-expanded"), "false");
});

test("the combobox supports keyboard selection", needsDom, () => {
    const { host, committedOrganizations } = render();
    const input = host.querySelector('[role="combobox"]');

    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    assert.equal(input.value, "Beta");
    assert.deepEqual(committedOrganizations, ["Beta"]);
});
