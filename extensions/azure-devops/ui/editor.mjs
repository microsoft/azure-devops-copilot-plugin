// Editing surfaces for Azure DevOps canvas content.
//
// Every editable field here is either plain text, a fixed set of choices, or
// Markdown source. None of them is a contenteditable surface, and that is a
// deliberate constraint rather than a missing feature.
//
// A WYSIWYG editor over Azure DevOps content has to convert the edited document
// back into storage format on every save. That conversion is lossy in ways the
// user cannot see -- it rewrites formatting they never touched -- and proving it
// is not lossy requires comparing against Azure DevOps' own renderer, which only
// Azure DevOps has. Editing the source instead makes the question moot: the bytes
// saved are the bytes the user typed.
//
// Markdown fields get a toolbar that inserts syntax into the textarea and a
// preview rendered by the same renderer Azure DevOps uses, so the user can still
// see what they are writing.
//
// Fields share one shell: a toolbar, a body, and a form-level footer with save
// and cancel.

import { renderRichText } from "./rich-text.mjs";
import { isSafeWriteUrl } from "./rich-text-policy.mjs";
import { canEditStoredHtml, fromEditableHtml, toEditableFragment } from "./editable-html.mjs";

function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = String(text);
    }
    return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function pencilIcon() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("fill", "currentColor");
    // The button carries the accessible name, so the glyph is decorative.
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute(
        "d",
        "M13.23 1.77a1.75 1.75 0 0 0-2.47 0L2.5 10.03c-.19.19-.33.43-.4.7l-.85 3.02a.6.6 0 0 0 .74.74l3.02-.85c.27-.08.51-.22.7-.4l8.26-8.27a1.75 1.75 0 0 0 0-2.47ZM10.4 3.9 12.1 5.6l-6.9 6.9-1.7-1.7Z",
    );
    svg.append(path);
    return svg;
}

/**
 * The affordance that turns a rendered field into an editor.
 *
 * Shared by both views so the two surfaces cannot drift apart, and icon-only so
 * it sits in a heading without competing with the content it edits.
 *
 * @param {string} label what is being edited, used for the accessible name
 * @param {() => void} onClick
 * @returns {HTMLButtonElement}
 */
export function editButton(label, onClick) {
    const button = element("button", "inline-edit");
    button.type = "button";
    button.title = `Edit ${label}`;
    button.setAttribute("aria-label", `Edit ${label}`);
    button.append(pencilIcon());
    button.addEventListener("click", onClick);
    return button;
}

const IS_APPLE = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || "");

function normalizeShortcut(spec) {
    return typeof spec === "string" ? { key: spec, shift: false } : { shift: false, ...spec };
}

function shortcutLabel(spec) {
    const { key, shift } = normalizeShortcut(spec);
    // Apple orders modifiers control-option-shift-command.
    return IS_APPLE
        ? `${shift ? "\u21e7" : ""}\u2318${key.toUpperCase()}`
        : `Ctrl+${shift ? "Shift+" : ""}${key.toUpperCase()}`;
}

function shortcutsLabel(specs) {
    return specs.map(shortcutLabel).join(" or ");
}

// execCommand's state query throws in some hosts and is simply absent in others,
// so an unavailable answer is reported as "not active" rather than breaking the
// toolbar.
function markdownWrapped(textarea, delimiter) {
    const { selectionStart: start, selectionEnd: end, value } = textarea;
    return value.slice(0, start).endsWith(delimiter) && value.slice(end).startsWith(delimiter);
}

function markdownLinePrefixed(textarea, ordered) {
    const { selectionStart: start, selectionEnd: end, value } = textarea;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = value.indexOf("\n", end) === -1 ? value.length : value.indexOf("\n", end);
    const lines = value.slice(lineStart, lineEnd).split("\n").filter((line) => line.trim());
    const pattern = ordered ? /^\s*\d+[.)]\s/ : /^\s*[-*+]\s/;
    return lines.length > 0 && lines.every((line) => pattern.test(line));
}

/**
 * A toolbar control.
 *
 * `isActive` makes the button reflect the formatting under the caret rather than
 * just firing a command, so the user can see what is on. `shortcut` is advertised
 * in the tooltip and bound by bindShortcuts.
 *
 * @param {string} label
 * @param {string} title
 * @param {() => void} onClick
 * @param {{ shortcut?: string, isActive?: () => boolean }} options
 */
function toolbarButton(label, title, onClick, { shortcut, isActive } = {}) {
    const button = element("button", "editor-tool", label);
    button.type = "button";
    const specs = shortcut ? [shortcut].flat().map(normalizeShortcut) : [];
    const described = specs.length ? `${title} (${shortcutsLabel(specs)})` : title;
    button.title = described;
    button.setAttribute("aria-label", described);
    // Keeps focus (and therefore the selection) inside the editable body.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", onClick);
    if (isActive) {
        // A toggle rather than a plain action, so assistive technology is told the
        // state and CSS has something to key the pressed styling off.
        button.setAttribute("aria-pressed", "false");
        button.refreshState = () => {
            let active = false;
            try {
                active = Boolean(isActive());
            } catch {
                active = false;
            }
            button.setAttribute("aria-pressed", String(active));
        };
    }
    return button;
}

/**
 * Binds editing shortcuts on an element, and keeps the toolbar in step.
 *
 * Hosts handle some of these natively, but not consistently, so they are handled
 * here to make every field behave the same way.
 *
 * @param {Element} node element to bind on
 * @param {Array<{ key: string, shift?: boolean, action: () => void }>} bindings
 * @param {{ onSave?: () => void, onCancel?: () => void }} options
 */
function bindShortcuts(node, bindings, { onSave, onCancel } = {}) {
    node.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && onCancel) {
            event.preventDefault();
            onCancel();
            return;
        }
        if (!(event.metaKey || event.ctrlKey) || event.altKey) {
            return;
        }
        if (event.key === "Enter" && onSave) {
            event.preventDefault();
            onSave();
            return;
        }
        const key = event.key.toLowerCase();
        const match = bindings.find((binding) =>
            binding.key === key && Boolean(binding.shift) === Boolean(event.shiftKey));
        if (match) {
            event.preventDefault();
            match.action();
        }
    });
}

// The host application claims some of the conventional combinations as native
// accelerators, and a native accelerator never reaches the canvas at all. Which
// ones it takes is not something the canvas can detect, so every formatting
// action answers to both the plain combination and a shift variant: if the
// obvious one is swallowed, adding shift always works.
function withShiftAlternate(key, action) {
    return [{ key, action }, { key, shift: true, action }];
}

function shortcutPair(key) {
    return [{ key }, { key, shift: true }];
}

// Keeps every stateful button in step with the caret. The listener lives on the
// document because selection changes are not delivered to the editable element,
// so it removes itself once the editor is gone rather than firing at detached
// nodes for the life of the page.
function trackToolbarState(host, buttons) {
    const refresh = () => {
        for (const button of buttons) {
            button.refreshState?.();
        }
    };
    const onSelectionChange = () => {
        if (!host.isConnected) {
            document.removeEventListener("selectionchange", onSelectionChange);
            return;
        }
        refresh();
    };
    document.addEventListener("selectionchange", onSelectionChange);
    refresh();
    return refresh;
}

function linkBar(onSubmit, onDismiss) {
    const bar = element("div", "editor-link-bar");
    const input = element("input", "editor-link-input");
    input.type = "url";
    input.placeholder = "https://";
    input.setAttribute("aria-label", "Link URL");
    const apply = element("button", "editor-link-apply", "Apply");
    apply.type = "button";
    const cancel = element("button", "secondary editor-link-cancel", "Cancel");
    cancel.type = "button";
    // The error belongs to the bar rather than the surrounding field: it is
    // always about the URL in this input, and it has to sit next to the control
    // the user has to correct.
    const error = element("div", "editor-link-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    const setError = (message) => {
        error.textContent = message || "";
        error.hidden = !message;
    };
    const dismiss = () => {
        setError("");
        onDismiss();
    };
    apply.addEventListener("click", () => onSubmit(input.value));
    cancel.addEventListener("click", dismiss);
    input.addEventListener("input", () => setError(""));
    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            onSubmit(input.value);
        }
        if (event.key === "Escape") {
            event.preventDefault();
            dismiss();
        }
    });
    bar.append(input, apply, cancel, error);
    return { bar, input, setError };
}

/**
 * The chrome shared by every field control: an optional toolbar above a body.
 *
 * Field controls deliberately do not own saving. A detail view puts every field
 * into edit mode at once and saves them together in a single request, so the
 * save and cancel actions belong to the form, not to each field.
 */
function fieldShell({ label, toolbar, body }) {
    const host = element("div", "editor");
    host.setAttribute("role", "group");
    host.setAttribute("aria-label", `Edit ${label}`);
    if (toolbar) {
        host.append(toolbar);
    }
    host.append(body);
    return { host };
}

/**
 * The save and cancel controls for a detail view's edit mode.
 *
 * @param {{ onSave: () => Promise<void>, onCancel: () => void, saveLabel?: string }} options
 * @returns {{ host: Element, setError: (message: string) => void, setBusy: (busy: boolean) => void }}
 */
export function createEditActions({ onSave, onCancel, saveLabel = "Save" }) {
    const host = element("div", "edit-actions");
    const save = element("button", "editor-save", saveLabel);
    save.type = "button";
    const cancel = element("button", "secondary editor-cancel", "Cancel");
    cancel.type = "button";
    const error = element("div", "editor-error");
    error.setAttribute("role", "alert");
    error.hidden = true;

    const setError = (message) => {
        error.hidden = !message;
        error.textContent = message || "";
    };
    const setBusy = (busy) => {
        save.disabled = busy;
        cancel.disabled = busy;
        save.textContent = busy ? "Saving..." : saveLabel;
    };

    save.addEventListener("click", async () => {
        setError("");
        setBusy(true);
        try {
            await onSave();
        } catch (saveError) {
            setError(saveError?.message || "Could not save the change.");
        } finally {
            setBusy(false);
        }
    });
    cancel.addEventListener("click", onCancel);

    host.append(save, cancel, error);
    return { host, setError, setBusy };
}

function toggleMarkdown(textarea, delimiter) {
    const { selectionStart: start, selectionEnd: end, value } = textarea;
    const selected = value.slice(start, end);
    const before = value.slice(0, start);
    const after = value.slice(end);
    const width = delimiter.length;
    if (before.endsWith(delimiter) && after.startsWith(delimiter)) {
        textarea.value = before.slice(0, -width) + selected + after.slice(width);
        textarea.setSelectionRange(start - width, end - width);
        return;
    }
    textarea.value = `${before}${delimiter}${selected || "text"}${delimiter}${after}`;
    textarea.setSelectionRange(start + width, start + width + (selected || "text").length);
}

function prefixMarkdownLines(textarea, prefix) {
    const { selectionStart: start, selectionEnd: end, value } = textarea;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = value.indexOf("\n", end) === -1 ? value.length : value.indexOf("\n", end);
    const block = value.slice(lineStart, lineEnd) || "item";
    const lines = block.split("\n");
    const numbered = prefix === "1. ";
    const applied = lines.every((line) => new RegExp(`^\\s*(?:[-*+]\\s|\\d+[.)]\\s)`).test(line))
        ? lines.map((line) => line.replace(/^\s*(?:[-*+]\s|\d+[.)]\s)/, ""))
        : lines.map((line, index) => `${numbered ? `${index + 1}. ` : prefix}${line}`);
    const next = applied.join("\n");
    textarea.value = value.slice(0, lineStart) + next + value.slice(lineEnd);
    textarea.setSelectionRange(lineStart, lineStart + next.length);
}

function insertMarkdownLink(textarea, url) {
    const { selectionStart: start, selectionEnd: end, value } = textarea;
    const selected = value.slice(start, end) || "link";
    const snippet = `[${selected}](${url})`;
    textarea.value = value.slice(0, start) + snippet + value.slice(end);
    textarea.setSelectionRange(start + 1, start + 1 + selected.length);
}

/**
 * Field control for Markdown fields such as pull request descriptions.
 *
 * Markdown is edited as source with a preview, never as a rich document. A
 * visual editor would have to serialize back to Markdown on every save, and that
 * conversion rewrites formatting the user never touched. Editing the source means
 * the value returned is the value the user typed.
 *
 * @param {{ label: string, value: string, onDirtyChange?: (dirty: boolean) => void, onSubmit?: () => void, onCancel?: () => void }} options
 * @returns {{ host: Element, getValue: () => string, isDirty: () => boolean, focus: () => void }}
 */
export function createMarkdownField({ label, value, onDirtyChange, onSubmit, onCancel }) {
    // Only trailing whitespace is dropped, and only at the very end. Leading
    // whitespace is load-bearing -- four spaces on the first line start a code
    // block -- so trimming both ends would rewrite the description the moment the
    // user edited anything else in it.
    const original = String(value ?? "").replace(/\r\n?/g, "\n").replace(/\s+$/, "");

    const body = element("div", "editor-markdown");
    const source = element("textarea", "editor-body editor-source");
    source.value = original;
    source.rows = Math.min(24, Math.max(6, original.split("\n").length + 2));
    source.spellcheck = true;
    source.setAttribute("aria-label", `${label} (Markdown)`);

    const preview = element("div", "editor-preview rich-text");
    preview.hidden = true;
    body.append(source, preview);

    let mode = "write";
    let dirty = false;

    function currentValue() {
        // Trailing whitespace is trimmed at the very end of the document only.
        // Trailing spaces *within* it are load-bearing: two of them are how Azure
        // DevOps spells a line break.
        return source.value.replace(/\s+$/, "");
    }

    function notifyDirty() {
        const next = currentValue() !== original;
        if (next !== dirty) {
            dirty = next;
            onDirtyChange?.(dirty);
        }
    }

    const toolbar = element("div", "editor-toolbar");
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", `${label} formatting`);

    const { bar, input, setError: setLinkError } = linkBar(
        (url) => {
            const href = isSafeWriteUrl(url);
            if (!href) {
                setLinkError("Enter an http, https, or mailto link.");
                return;
            }
            setLinkError("");
            insertMarkdownLink(source, href);
            bar.hidden = true;
            source.focus();
            notifyDirty();
        },
        () => {
            bar.hidden = true;
            source.focus();
        },
    );
    bar.hidden = true;

    // Formatting edits the source text directly, so there is no browser command
    // to ask and nothing to normalize afterwards.
    const formatAction = (apply) => () => {
        if (mode !== "write") {
            return;
        }
        apply();
        source.focus();
        notifyDirty();
        refreshToolbar();
    };

    const openLinkBar = () => {
        if (mode !== "write") {
            return;
        }
        bar.hidden = false;
        input.value = "";
        input.focus();
    };

    const previewButton = toolbarButton("Preview", "Preview the rendered Markdown", () => {
        setMode(mode === "write" ? "preview" : "write");
    }, { isActive: () => mode === "preview" });

    const boldAction = formatAction(() => toggleMarkdown(source, "**"));
    const italicAction = formatAction(() => toggleMarkdown(source, "_"));
    const codeAction = formatAction(() => toggleMarkdown(source, "`"));

    const buttons = [
        toolbarButton("B", "Bold", boldAction, {
            shortcut: shortcutPair("b"),
            isActive: () => mode === "write" && markdownWrapped(source, "**"),
        }),
        toolbarButton("I", "Italic", italicAction, {
            shortcut: shortcutPair("i"),
            isActive: () => mode === "write" && markdownWrapped(source, "_"),
        }),
        toolbarButton("\u2022", "Bulleted list", formatAction(() => prefixMarkdownLines(source, "- ")), {
            isActive: () => mode === "write" && markdownLinePrefixed(source, false),
        }),
        toolbarButton("1.", "Numbered list", formatAction(() => prefixMarkdownLines(source, "1. ")), {
            isActive: () => mode === "write" && markdownLinePrefixed(source, true),
        }),
        toolbarButton("<>", "Inline code", codeAction, {
            shortcut: shortcutPair("e"),
            isActive: () => mode === "write" && markdownWrapped(source, "`"),
        }),
        // No shortcut: the conventional one is the host application's global search.
        toolbarButton("Link", "Insert link", openLinkBar),
        previewButton,
    ];
    toolbar.append(...buttons);

    function setMode(next) {
        if (next === mode) {
            return;
        }
        mode = next;
        if (mode === "preview") {
            bar.hidden = true;
            const rendered = renderRichText(preview, currentValue(), { format: "markdown" });
            if (!rendered) {
                preview.replaceChildren(element("div", "status", "Nothing to preview."));
            }
        }
        applyMode();
        if (mode === "write") {
            source.focus();
        }
        refreshToolbar();
    }

    function applyMode() {
        source.hidden = mode !== "write";
        preview.hidden = mode !== "preview";
        previewButton.setAttribute("aria-pressed", String(mode === "preview"));
        previewButton.title = mode === "preview" ? "Back to editing" : "Preview the rendered Markdown";
    }

    applyMode();

    const shell = fieldShell({ label, toolbar, body });
    shell.host.insertBefore(bar, body);
    const refreshToolbar = trackToolbarState(shell.host, buttons);

    source.addEventListener("input", () => {
        notifyDirty();
        refreshToolbar();
    });
    // A textarea reports no selectionchange, so the caret is sampled from the
    // interactions that move it.
    for (const event of ["keyup", "mouseup", "select", "focus"]) {
        source.addEventListener(event, () => refreshToolbar());
    }
    // The toolbar's shortcut hints and the actual key bindings are separate: the
    // host application claims some plain combinations, so each one is bound with a
    // shift alternate as well.
    bindShortcuts(shell.host, [
        ...withShiftAlternate("b", boldAction),
        ...withShiftAlternate("i", italicAction),
        ...withShiftAlternate("e", codeAction),
    ], { onSave: onSubmit, onCancel });

    return {
        host: shell.host,
        getValue: () => currentValue(),
        isDirty: () => dirty,
        focus: () => {
            setMode("write");
            source.focus();
        },
    };
}

export function createPlainField({ label, value, required = false, onDirtyChange, onSubmit, onCancel }) {
    const initial = String(value ?? "");
    const body = element("input", "editor-body editor-plain");
    body.type = "text";
    body.value = initial;
    body.setAttribute("aria-label", label);

    let dirty = false;
    body.addEventListener("input", () => {
        const next = body.value !== initial;
        if (next !== dirty) {
            dirty = next;
            onDirtyChange?.(dirty);
        }
    });
    body.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && onSubmit) {
            event.preventDefault();
            onSubmit();
        }
        if (event.key === "Escape" && onCancel) {
            event.preventDefault();
            onCancel();
        }
    });

    const shell = fieldShell({ label, toolbar: null, body });
    return {
        ...shell,
        getValue: () => body.value.trim(),
        isDirty: () => dirty,
        validate: () => (required && !body.value.trim() ? `${label} cannot be empty.` : ""),
        focus: () => body.focus(),
    };
}

/**
 * Dropdown field control for a fixed set of values, such as work item state.
 *
 * @param {{ label: string, value: string, options: string[], onDirtyChange?: () => void }} config
 * @returns {{ host: Element, getValue: () => string, isDirty: () => boolean, focus: () => void }}
 */
export function createChoiceField({ label, value, options, onDirtyChange }) {
    const initial = String(value ?? "");
    const body = element("select", "editor-body editor-choice");
    body.setAttribute("aria-label", label);
    for (const choice of options) {
        const option = element("option", "", choice);
        option.value = choice;
        option.selected = choice === initial;
        body.append(option);
    }

    let dirty = false;
    body.addEventListener("change", () => {
        const next = body.value !== initial;
        if (next !== dirty) {
            dirty = next;
            onDirtyChange?.(dirty);
        }
    });

    const shell = fieldShell({ label, toolbar: null, body });
    return {
        ...shell,
        getValue: () => body.value,
        isDirty: () => dirty,
        focus: () => body.focus(),
    };
}
/**
 * Editing surface for a work item HTML field.
 *
 * Deliberately has no toolbar. The formatting already in the field is preserved
 * untouched, so what this offers is editing the words around it, and native
 * `contenteditable` handles that with the browser's own undo stack, IME
 * composition, and paste. A toolbar is what would drag in the hand-rolled command
 * layer that got undo and IME wrong before, so none is wired up: the value here is
 * not losing content, not producing markup. The save and cancel keys are still
 * bound, since those are the form's shortcuts rather than the editor's.
 *
 * Whatever a paste drags in is scrubbed by `fromEditableHtml` on the way out, so
 * the value saved is held to the same rule as the value seeded.
 *
 * @param {{ label: string, value: string, onDirtyChange?: () => void, onSubmit?: () => void, onCancel?: () => void }} config
 * @returns {{ host: Element, getValue: () => string, isDirty: () => boolean, isHtml: boolean, focus: () => void }}
 */
export function createHtmlField({ label, value, onDirtyChange, onSubmit, onCancel }) {
    const body = element("div", "editor-body editor-html");
    // Set as an attribute rather than through the property: jsdom does not
    // implement contentEditable, so the property assignment silently does nothing
    // and the surface would be untestable.
    body.setAttribute("contenteditable", "true");
    body.spellcheck = true;
    body.setAttribute("role", "textbox");
    body.setAttribute("aria-multiline", "true");
    body.setAttribute("aria-label", label);
    body.append(toEditableFragment(value));
    const initial = body.innerHTML;

    let dirty = false;
    body.addEventListener("input", () => {
        const next = body.innerHTML !== initial;
        if (next !== dirty) {
            dirty = next;
            onDirtyChange?.(dirty);
        }
    });
    // Enter inserts a line break here rather than saving, because this is a
    // multi-line body. Save is Cmd/Ctrl+Enter and cancel is Escape, bound through
    // the same helper the Markdown field uses so a description and a work item
    // field answer to the same keys. The bindings list is empty: those are the
    // formatting commands, and this surface has none.
    // Native paste is left alone when the clipboard holds nothing the scrub would
    // strip, which keeps the browser's own undo entry and its handling of the
    // markup. It is only downgraded to plain text when the payload would not have
    // survived the save anyway -- pasted markup lands live in the DOM, and an
    // `onerror` does not wait for the save to run. The predicate is the same one
    // that decides whether a field is editable at all, so the two cannot drift.
    body.addEventListener("paste", (event) => {
        const html = event.clipboardData?.getData("text/html");
        if (!html || canEditStoredHtml(html)) {
            return;
        }
        event.preventDefault();
        const selection = body.ownerDocument.getSelection?.();
        if (!selection?.rangeCount) {
            return;
        }
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(body.ownerDocument.createTextNode(event.clipboardData.getData("text/plain") || ""));
        selection.collapseToEnd();
        body.dispatchEvent(new Event("input", { bubbles: true }));
    });

    bindShortcuts(body, [], { onSave: onSubmit, onCancel });

    const shell = fieldShell({ label, toolbar: null, body });
    return {
        ...shell,
        getValue: () => fromEditableHtml(body.innerHTML),
        isDirty: () => dirty,
        isHtml: true,
        focus: () => body.focus(),
    };
}
