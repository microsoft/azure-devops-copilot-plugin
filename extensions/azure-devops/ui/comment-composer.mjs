import { createSearchPicker } from "./search-picker.mjs";

function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function initials(name) {
    return String(name || "?")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || "?";
}

function identityResult(node, identity, avatarUrl) {
    const avatar = element("span", "comment-mention-avatar", initials(identity.displayName));
    const source = avatarUrl?.(identity.imageUrl);
    if (source) {
        const image = element("img", "comment-mention-avatar-image");
        image.alt = "";
        image.src = source;
        image.addEventListener("error", () => image.remove(), { once: true });
        avatar.append(image);
    }
    const copy = element("span", "comment-mention-copy");
    copy.append(element("span", "comment-mention-name", identity.displayName));
    if (identity.uniqueName) {
        copy.append(element("span", "comment-mention-unique-name", identity.uniqueName));
    }
    node.dataset.identityId = identity.mentionId || identity.id;
    node.append(avatar, copy);
}

function mentionNode(document_, identity) {
    const mention = document_.createElement("span");
    mention.className = "comment-mention";
    mention.textContent = `@${identity.displayName || identity.uniqueName || "Unknown"}`;
    mention.setAttribute("contenteditable", "false");
    mention.dataset.mentionId = String(identity.mentionId || "").trim();
    mention.setAttribute("aria-label", `Mention ${identity.displayName || identity.uniqueName || "identity"}`);
    return mention;
}

function seedBody(body, value, mentions) {
    const identities = new Map(
        (mentions || []).map((identity) => [String(identity.mentionId || "").toUpperCase(), identity]),
    );
    const source = String(value || "");
    const token = /@<([0-9a-f]{8}-[0-9a-f-]{27})>/gi;
    let offset = 0;
    for (const match of source.matchAll(token)) {
        if (match.index > offset) {
            body.append(body.ownerDocument.createTextNode(source.slice(offset, match.index)));
        }
        const identity = identities.get(match[1].toUpperCase());
        body.append(identity ? mentionNode(body.ownerDocument, identity) : body.ownerDocument.createTextNode(match[0]));
        offset = match.index + match[0].length;
    }
    if (offset < source.length) {
        body.append(body.ownerDocument.createTextNode(source.slice(offset)));
    }
}

function serializeNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
        return String(node.nodeValue || "").replace(/\u00a0/g, " ");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    if (node.classList.contains("comment-mention")) {
        return `@<${node.dataset.mentionId}>`;
    }
    if (node.tagName === "BR") return "\n";
    const content = [...node.childNodes].map(serializeNode).join("");
    return ["DIV", "P"].includes(node.tagName) ? `${content}\n` : content;
}

export function serializeCommentBody(body) {
    return [...body.childNodes]
        .map(serializeNode)
        .join("")
        .replace(/\u200b/g, "")
        .replace(/\n+$/, "");
}

function insertPlainText(body, text) {
    const selection = body.ownerDocument.getSelection?.();
    if (!selection?.rangeCount) {
        body.append(body.ownerDocument.createTextNode(text));
        return;
    }
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = body.ownerDocument.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
}

const BLOCK_BOUNDARIES = new Set([
    "ADDRESS", "BLOCKQUOTE", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "P", "PRE",
]);

function precedingCharacter(body, node) {
    let cursor = node;
    while (cursor && cursor !== body) {
        let sibling = cursor.previousSibling;
        while (sibling) {
            if (
                sibling.nodeType === Node.ELEMENT_NODE &&
                (sibling.tagName === "BR" || BLOCK_BOUNDARIES.has(sibling.tagName))
            ) {
                return "\n";
            }
            const text = String(sibling.textContent || "");
            if (text) return text.at(-1);
            sibling = sibling.previousSibling;
        }
        const parent = cursor.parentNode;
        if (
            parent &&
            parent !== body &&
            parent.nodeType === Node.ELEMENT_NODE &&
            BLOCK_BOUNDARIES.has(parent.tagName)
        ) {
            return "\n";
        }
        cursor = parent;
    }
    return "";
}

function inlineMentionTrigger(body) {
    const selection = body.ownerDocument.getSelection?.();
    if (!selection?.rangeCount) {
        return null;
    }
    const selectionRange = selection.getRangeAt(0);
    if (!selectionRange.collapsed || !body.contains(selectionRange.endContainer)) return null;
    let node = selectionRange.endContainer;
    let offset = selectionRange.endOffset;
    if (node.nodeType === Node.ELEMENT_NODE && offset > 0) {
        const previous = node.childNodes[offset - 1];
        if (previous?.nodeType === Node.TEXT_NODE) {
            node = previous;
            offset = String(previous.nodeValue || "").length;
        }
    }
    if (node.nodeType !== Node.TEXT_NODE) return null;
    const before = String(node.nodeValue || "").slice(0, offset);
    // Keep spaces inside the query so display names such as "Carlo Rivera"
    // search exactly as they do in Azure DevOps. The query must start
    // immediately after @ and stays bounded so ordinary prose does not leave
    // identity search running indefinitely.
    const match = /(^|\s)@([^\s@\n][^@\n]{0,63})$/.exec(before);
    if (!match) return null;
    if (match[2].trim().split(/\s+/).length > 4) return null;
    const startOffset = match.index + match[1].length;
    if (!match[1] && startOffset === 0) {
        const preceding = precedingCharacter(body, node);
        if (preceding && !/\s/.test(preceding)) return null;
    }
    const range = body.ownerDocument.createRange();
    range.setStart(node, startOffset);
    range.setEnd(node, offset);
    return { query: match[2], range };
}

function insertMention(body, range, identity) {
    const mentionId = String(identity.mentionId || "").trim();
    if (!mentionId) throw new Error("Azure DevOps did not return an identity ID that can be mentioned.");

    const mention = mentionNode(body.ownerDocument, { ...identity, mentionId });
    const selection = body.ownerDocument.getSelection?.();
    const target = range && body.contains(range.commonAncestorContainer)
        ? range
        : body.ownerDocument.createRange();
    if (!range || !body.contains(range.commonAncestorContainer)) {
        target.selectNodeContents(body);
        target.collapse(false);
    }
    const followingNode = target.endContainer.nodeType === Node.TEXT_NODE
        ? target.endContainer
        : target.endContainer.childNodes?.[target.endOffset];
    const followingText = followingNode?.nodeType === Node.TEXT_NODE
        ? String(followingNode.nodeValue || "").slice(
            followingNode === target.endContainer ? target.endOffset : 0,
        )
        : "";
    const needsSpace = !/^\s/.test(followingText);
    target.deleteContents();
    target.insertNode(mention);
    target.setStartAfter(mention);
    if (needsSpace) {
        const space = body.ownerDocument.createTextNode(" ");
        target.insertNode(space);
        target.setStartAfter(space);
    }
    target.collapse(true);
    if (selection) {
        selection.removeAllRanges();
        selection.addRange(target);
    }
    body.focus();
    body.dispatchEvent(new body.ownerDocument.defaultView.Event("input", { bubbles: true }));
}

export function createCommentComposer({
    id,
    label = "Add a comment",
    submitLabel = "Comment",
    onSubmit,
    onCancel,
    onSearchIdentities,
    avatarUrl,
    value = "",
    mentions = [],
    onChange,
}) {
    const host = element("div", "comment-composer");
    host.setAttribute("role", "group");
    host.setAttribute("aria-label", label);
    const body = element("div", "comment-composer-body");
    body.id = `${id}-body`;
    body.setAttribute("contenteditable", "true");
    body.setAttribute("role", "textbox");
    body.setAttribute("aria-multiline", "true");
    body.setAttribute("aria-label", label);
    body.setAttribute("aria-autocomplete", "list");
    body.dataset.placeholder = label;
    body.spellcheck = true;
    seedBody(body, value, mentions);
    const actions = element("div", "comment-composer-actions");
    const submit = element("button", "primer-button comment-submit", submitLabel);
    submit.type = "button";
    const cancel = onCancel ? element("button", "primer-button secondary comment-cancel", "Cancel") : null;
    if (cancel) cancel.type = "button";
    const error = element("div", "comment-composer-error");
    error.setAttribute("role", "alert");
    error.hidden = true;

    let savedRange = null;
    let mentionRange = null;
    let busy = false;
    let composing = false;
    let selectingMention = false;
    const releaseMentionSelection = () => {
        selectingMention = false;
        host.ownerDocument.removeEventListener("mouseup", releaseMentionSelection);
        host.ownerDocument.removeEventListener("pointerup", releaseMentionSelection);
    };
    let updateInlineMention = () => {};
    const mentionById = new Map(
        (mentions || []).map((identity) => [String(identity.mentionId || "").toUpperCase(), identity]),
    );
    const draftValue = () => {
        const ids = [...body.querySelectorAll(".comment-mention")]
            .map((node) => String(node.dataset.mentionId || "").toUpperCase());
        return {
            content: serializeCommentBody(body),
            mentions: [...new Set(ids)].map((id) => mentionById.get(id)).filter(Boolean),
        };
    };
    const notifyChange = () => onChange?.(draftValue());
    const rememberRange = () => {
        const selection = body.ownerDocument.getSelection?.();
        if (selection?.rangeCount && body.contains(selection.anchorNode)) {
            savedRange = selection.getRangeAt(0).cloneRange();
        }
    };
    for (const event of ["focus", "keyup", "mouseup", "input"]) {
        body.addEventListener(event, rememberRange);
    }
    body.addEventListener("input", () => {
        notifyChange();
        if (!composing) updateInlineMention();
    });
    body.addEventListener("keyup", (event) => {
        if (composing || event.isComposing) return;
        if (!["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) {
            updateInlineMention();
        }
    });
    body.addEventListener("mouseup", () => updateInlineMention());
    body.addEventListener("compositionstart", () => {
        composing = true;
        closePicker();
    });
    body.addEventListener("compositionend", () => {
        composing = false;
        updateInlineMention();
    });
    body.addEventListener("paste", (event) => {
        event.preventDefault();
        insertPlainText(body, event.clipboardData?.getData("text/plain") || "");
        body.dispatchEvent(new body.ownerDocument.defaultView.Event("input", { bubbles: true }));
    });

    const setError = (message) => {
        error.textContent = message || "";
        error.hidden = !message;
    };
    const setBusy = (value) => {
        busy = value;
        submit.disabled = value;
        if (cancel) cancel.disabled = value;
        body.setAttribute("contenteditable", String(!value));
        submit.textContent = value ? `${submitLabel.replace(/e?$/, "")}ing...` : submitLabel;
    };
    const submitComment = async () => {
        if (busy) return;
        const content = serializeCommentBody(body);
        if (!content.trim()) {
            setError("Comment text cannot be empty.");
            body.focus();
            return;
        }
        setError("");
        closePicker();
        setBusy(true);
        try {
            await onSubmit(content);
            body.replaceChildren();
            savedRange = null;
            notifyChange();
        } catch (submitError) {
            if (host.isConnected) {
                setError(submitError?.message || "Could not post the comment.");
            }
        } finally {
            if (host.isConnected) setBusy(false);
        }
    };

    const mentionStatus = element("div", "comment-mention-picker-status");
    mentionStatus.setAttribute("aria-live", "polite");
    let handleSearchResults = () => {};
    const { picker, results, queueSearch, clear } = createSearchPicker({
        prefix: "comment-mention",
        id: `${id}-mention-search`,
        labelText: "Mention a person or group",
        placeholder: "Search people and groups",
        inputAriaLabel: "Search Azure DevOps people and groups to mention",
        resultsAriaLabel: "Mention search results",
        emptyText: "No matching people or groups.",
        failureText: "The identity search failed.",
        onSearch: async (query) => {
            const found = await onSearchIdentities?.(query);
            return {
                error: found?.error || "",
                items: (found?.identities || []).filter((identity) => identity.mentionId),
            };
        },
        renderResult: (node, identity) => identityResult(node, identity, avatarUrl),
        onPick: async (identity) => {
            mentionById.set(String(identity.mentionId).toUpperCase(), identity);
            insertMention(body, mentionRange || savedRange, identity);
            closePicker();
        },
        showInput: false,
        onResultsChanged: (items, state, message) => handleSearchResults(items, state, message),
        statusElement: mentionStatus,
    });
    picker.id = `${id}-mention-picker`;
    picker.hidden = true;
    results.id = `${id}-mention-results`;
    body.setAttribute("aria-controls", results.id);

    let removalObserver = null;
    const closePicker = ({ restoreFocus = false, preserveStatus = false } = {}) => {
        picker.hidden = true;
        mentionRange = null;
        selectingMention = false;
        releaseMentionSelection();
        body.removeAttribute("aria-activedescendant");
        clear({ preserveStatus });
        host.ownerDocument.removeEventListener("pointerdown", onDocumentPointerDown);
        removalObserver?.disconnect();
        removalObserver = null;
        if (restoreFocus) body.focus();
    };
    const onDocumentPointerDown = (event) => {
        if (!host.isConnected) {
            host.ownerDocument.removeEventListener("pointerdown", onDocumentPointerDown);
        } else if (!host.contains(event.target)) {
            closePicker();
        }
    };
    updateInlineMention = () => {
        const trigger = inlineMentionTrigger(body);
        if (!trigger || trigger.query.trim().length < 2) {
            closePicker();
            return;
        }
        mentionRange = trigger.range.cloneRange();
        picker.hidden = false;
        host.ownerDocument.addEventListener("pointerdown", onDocumentPointerDown);
        if (!removalObserver && host.parentNode) {
            removalObserver = new host.ownerDocument.defaultView.MutationObserver(() => {
                if (!host.isConnected) closePicker();
            });
            removalObserver.observe(host.parentNode, { childList: true, subtree: true });
        }
        queueSearch(trigger.query);
    };
    const activateResult = (index) => {
        const options = [...results.querySelectorAll('[role="option"]')];
        if (!options.length) return false;
        const next = (index + options.length) % options.length;
        options.forEach((option, optionIndex) =>
            option.setAttribute("aria-selected", String(optionIndex === next)));
        body.setAttribute("aria-activedescendant", options[next].id);
        options[next].scrollIntoView?.({ block: "nearest" });
        return true;
    };
    const moveActiveResult = (delta) => {
        const options = [...results.querySelectorAll('[role="option"]')];
        if (!options.length) return false;
        const current = options.findIndex((option) => option.getAttribute("aria-selected") === "true");
        return activateResult(current < 0 ? (delta > 0 ? 0 : options.length - 1) : current + delta);
    };
    const chooseActiveResult = () => {
        const options = [...results.querySelectorAll('[role="option"]')];
        const selected = options.find((option) => option.getAttribute("aria-selected") === "true");
        selected?.click();
        return Boolean(selected);
    };
    handleSearchResults = (_items, state) => {
        body.removeAttribute("aria-activedescendant");
        if (state === "ready") activateResult(0);
        else if (state === "empty") closePicker({ preserveStatus: true });
    };
    picker.addEventListener("mousedown", (event) => {
        if (event.target.closest?.('[role="option"]')) {
            selectingMention = true;
            host.ownerDocument.addEventListener("mouseup", releaseMentionSelection, { once: true });
            host.ownerDocument.addEventListener("pointerup", releaseMentionSelection, { once: true });
        }
    });
    host.addEventListener("focusout", () => {
        queueMicrotask(() => {
            if (!selectingMention && !host.contains(host.ownerDocument.activeElement)) closePicker();
        });
    });
    submit.addEventListener("click", submitComment);
    cancel?.addEventListener("click", () => onCancel());
    body.addEventListener("keydown", (event) => {
        if (event.isComposing) return;
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            submitComment();
        } else if (!picker.hidden && event.key === "ArrowDown" && moveActiveResult(1)) {
            event.preventDefault();
        } else if (!picker.hidden && event.key === "ArrowUp" && moveActiveResult(-1)) {
            event.preventDefault();
        } else if (!picker.hidden && event.key === "Enter" && chooseActiveResult()) {
            event.preventDefault();
        } else if (
            !picker.hidden &&
            event.key === "Tab" &&
            !event.shiftKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            chooseActiveResult()
        ) {
            event.preventDefault();
        } else if (!picker.hidden && event.key === "Escape") {
            event.preventDefault();
            closePicker({ restoreFocus: true });
        } else if (event.key === "Escape" && onCancel) {
            event.preventDefault();
            onCancel();
        }
    });

    actions.append(submit);
    if (cancel) actions.append(cancel);
    host.append(body, picker, mentionStatus, actions, error);
    return {
        host,
        focus: () => body.focus(),
        getValue: () => serializeCommentBody(body),
    };
}
