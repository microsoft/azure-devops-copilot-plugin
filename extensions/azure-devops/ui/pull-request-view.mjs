import { createActionMenu } from "./action-menu.mjs";
import { createCommentComposer } from "./comment-composer.mjs";
import { renderLinkedWorkItems, renderPullRequestActions, renderReviewers } from "./pull-request-actions.mjs";
import { renderPullRequestChecks } from "./pull-request-checks.mjs";
import { createEditActions, createMarkdownField, createPlainField, editButton } from "./editor.mjs";
import { richTextElement } from "./rich-text.mjs";

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

function externalLink(text, href, className = "") {
    const node = element("a", className, text);
    node.href = href;
    node.target = "_blank";
    node.rel = "noopener noreferrer";
    if (text) {
        node.setAttribute("aria-label", `${text} (opens in a new tab)`);
    }
    return node;
}

function link(text, href, className = "") {
    return externalLink(text, href, ["primer-link", className].filter(Boolean).join(" "));
}

function openCommentLink(href) {
    const node = externalLink(undefined, href, "comment-open-button");
    node.setAttribute("aria-label", "Open comment thread in Azure DevOps");
    node.title = "Open comment thread in Azure DevOps";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("comment-open-icon");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.5 0H13a1 1 0 0 1 1 1v2.75a.75.75 0 0 1-1.5 0V4.56L8.28 8.78a.75.75 0 0 1-1.06-1.06L11.44 3.5h-1.19a.75.75 0 0 1 0-1.5Z");
    svg.append(path);
    node.append(svg);
    return node;
}

function copilotIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("comment-fix-icon");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("aria-hidden", "true");
    for (const pathData of [
        "M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.128-1.769.693-2.484.579-.733 1.494-1.124 2.724-1.261 1.206-.134 2.262.034 2.944.765.05.053.096.108.139.165.044-.057.094-.112.143-.165.682-.731 1.738-.899 2.944-.765 1.23.137 2.145.528 2.724 1.261.566.715.693 1.614.693 2.484 0 .572-.053 1.148-.254 1.656.066.228.098.429.126.612.012.076.024.148.037.218.924.385 1.522 1.471 1.591 2.095v1.872c0 .766-3.351 3.795-8.002 3.795Zm0-1.485c2.28 0 4.584-1.11 5.002-1.433V7.862l-.023-.116c-.49.21-1.075.291-1.727.291-1.146 0-2.059-.327-2.71-.991A3.222 3.222 0 0 1 8 6.303a3.24 3.24 0 0 1-.544.743c-.65.664-1.563.991-2.71.991-.652 0-1.236-.081-1.727-.291l-.023.116v4.255c.419.323 2.722 1.433 5.002 1.433ZM6.762 2.83c-.193-.206-.637-.413-1.682-.297-1.019.113-1.479.404-1.713.7-.247.312-.369.789-.369 1.554 0 .793.129 1.171.308 1.371.162.181.519.379 1.442.379.853 0 1.339-.235 1.638-.54.315-.322.527-.827.617-1.553.117-.935-.037-1.395-.241-1.614Zm4.155-.297c-1.044-.116-1.488.091-1.681.297-.204.219-.359.679-.242 1.614.091.726.303 1.231.618 1.553.299.305.784.54 1.638.54.922 0 1.28-.198 1.442-.379.179-.2.308-.578.308-1.371 0-.765-.123-1.242-.37-1.554-.233-.296-.693-.587-1.713-.7Z",
        "M6.25 9.037a.75.75 0 0 1 .75.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 .75-.75Zm4.25.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 1.5 0Z",
    ]) {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", pathData);
        svg.append(path);
    }
    return svg;
}

function relativeTime(value) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
        return "";
    }
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 60) return "now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

function branchName(refName) {
    return String(refName || "").replace(/^refs\/heads\//, "");
}

function branchLink(pr, refName) {
    if (!pr.webUrl) {
        return null;
    }
    const name = branchName(refName);
    const repositoryUrl = pr.webUrl.replace(/\/pullrequest\/\d+(?:[?#].*)?$/, "");
    return name ? `${repositoryUrl}?version=GB${encodeURIComponent(name).replace(/%2F/g, "/")}` : null;
}

function isResolved(thread) {
    return ["fixed", "closed", "bydesign", "wontfix"].includes(String(thread.status || "").toLowerCase());
}

function authorInitials(name) {
    return String(name || "?")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || "?";
}

function commentAvatar(comment, avatarUrl) {
    const avatar = element("span", "comment-avatar", authorInitials(comment?.author));
    avatar.setAttribute("aria-hidden", "true");
    const src = avatarUrl?.(comment?.authorImageUrl);
    if (src) {
        const image = element("img", "comment-avatar-image");
        image.alt = "";
        image.src = src;
        image.addEventListener("error", () => image.remove(), { once: true });
        avatar.append(image);
    }
    return avatar;
}

function commentIdentity(comment, avatarUrl) {
    const title = element("div", "comment-header-title");
    const age = relativeTime(comment?.publishedDate);
    const metadata = element("span", "comment-header-meta");
    metadata.append(element("span", "comment-header-author", comment?.author || "Unknown"));
    if (age) {
        metadata.append(document.createTextNode(" · "), element("span", "comment-header-age", age));
    }
    title.append(commentAvatar(comment, avatarUrl), metadata);
    return title;
}

function commentHeaderActions(threadUrl, isActive) {
    if (!threadUrl && !isActive) {
        return null;
    }
    const actions = element("div", "comment-header-actions");
    if (isActive) {
        actions.append(element("span", "comment-status-pill", "Active"));
    }
    if (threadUrl) {
        actions.append(openCommentLink(threadUrl));
    }
    return actions;
}

function commentHeader(comment, avatarUrl, threadUrl, isActive) {
    const header = element("div", "comment-header");
    header.append(commentIdentity(comment, avatarUrl));
    const actions = commentHeaderActions(threadUrl, isActive);
    if (actions) {
        header.append(actions);
    }
    return header;
}

function codeCommentHeader(thread, threadUrl, isActive) {
    const header = element("div", "comment-header comment-code-header");
    const filePath = String(thread.filePath || thread.fileName || "").replace(/^\/+/, "");
    const lineNumber = Number(thread.lineNumber);
    header.append(element("code", "comment-file-reference", `${filePath}${lineNumber > 0 ? `:L${lineNumber}` : ""}`));
    const actions = commentHeaderActions(threadUrl, isActive);
    if (actions) {
        header.append(actions);
    }
    return header;
}

function commentByline(comment, avatarUrl) {
    const byline = element("div", "comment-byline");
    byline.append(commentIdentity(comment, avatarUrl));
    return byline;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escapeMentionLabel(value) {
    return escapeHtml(value).replace(/[*_~[\]`]/g, (character) => `&#${character.charCodeAt(0)};`);
}

function replaceMentionTokens(text, identities) {
    let result = text;
    for (const identity of identities || []) {
        const id = String(identity.id || "").trim();
        if (!id || !identity.displayName) continue;
        const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const token = new RegExp(`@<${escapedId}>`, "gi");
        const mention = `<a href="#" data-vss-mention="version:2.0,${escapeHtml(id)}">@${escapeMentionLabel(identity.displayName)}</a>`;
        result = result.replace(token, () => mention);
    }
    return result;
}

function displayCommentText(comment) {
    const lines = String(comment?.text || "").split("\n");
    let fence = null;
    return lines.map((line) => {
        const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
        if (marker) {
            if (!fence) fence = { character: marker[0], length: marker.length };
            else if (marker[0] === fence.character && marker.length >= fence.length) fence = null;
            return line;
        }
        if (fence) return line;

        const inlineCode = /(`+)([\s\S]*?)\1/g;
        let offset = 0;
        let output = "";
        for (const match of line.matchAll(inlineCode)) {
            output += replaceMentionTokens(line.slice(offset, match.index), comment?.mentionIdentities || []);
            output += match[0];
            offset = match.index + match[0].length;
        }
        return output + replaceMentionTokens(line.slice(offset), comment?.mentionIdentities || []);
    }).join("\n");
}

function codeDiffRows(target, source) {
    const oldLines = target || [];
    const newLines = source || [];
    if (!oldLines.length) {
        return newLines.map((line) => ({
            type: line.isSelected === false ? "context" : "addition",
            ...line,
        }));
    }
    if (!newLines.length) {
        return oldLines.map((line) => ({
            type: line.isSelected === false ? "context" : "deletion",
            ...line,
        }));
    }
    const matches = Array.from({ length: oldLines.length + 1 }, () => Array(newLines.length + 1).fill(0));
    for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
        for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
            matches[oldIndex][newIndex] = oldLines[oldIndex].text === newLines[newIndex].text
                ? matches[oldIndex + 1][newIndex + 1] + 1
                : Math.max(matches[oldIndex + 1][newIndex], matches[oldIndex][newIndex + 1]);
        }
    }

    const rows = [];
    let oldIndex = 0;
    let newIndex = 0;
    while (oldIndex < oldLines.length || newIndex < newLines.length) {
        if (
            oldIndex < oldLines.length &&
            newIndex < newLines.length &&
            oldLines[oldIndex].text === newLines[newIndex].text
        ) {
            rows.push({ type: "context", ...newLines[newIndex] });
            oldIndex += 1;
            newIndex += 1;
        } else if (
            oldIndex < oldLines.length &&
            (newIndex >= newLines.length || matches[oldIndex + 1][newIndex] >= matches[oldIndex][newIndex + 1])
        ) {
            rows.push({ type: "deletion", ...oldLines[oldIndex] });
            oldIndex += 1;
        } else {
            rows.push({ type: "addition", ...newLines[newIndex] });
            newIndex += 1;
        }
    }
    return rows;
}

function codeDiff(thread) {
    const diff = element("div", "comment-diff");
    diff.setAttribute("role", "table");
    diff.setAttribute("aria-label", `Code diff for ${thread.filePath || thread.fileName}`);
    const rows = Array.isArray(thread.diff)
        ? thread.diff
        : codeDiffRows(thread.target, thread.source);
    for (const line of rows) {
        const sign = line.type === "addition" ? "+" : line.type === "deletion" ? "-" : "";
        const row = element("div", `comment-diff-row ${line.type}`);
        row.setAttribute("role", "row");
        row.setAttribute("aria-label", `${line.type === "context" ? "Context" : line.type === "addition" ? "Added" : "Deleted"} line ${line.lineNumber}`);
        row.append(
            element("span", "comment-diff-line-number", line.lineNumber),
            element("span", "comment-diff-sign", sign),
            element("code", "comment-diff-code", line.text),
        );
        diff.append(row);
    }
    return diff;
}

function timelineEntries(pr) {
    const entries = (pr.commentThreads || []).flatMap((thread) => thread.isTimelineEvent
        ? (thread.comments || []).map((comment) => ({ kind: "event", timestamp: comment.publishedDate, text: comment.text }))
        : [{ kind: "thread", timestamp: thread.updatedDate, thread }]);
    if (pr.creationDate) {
        entries.push({ kind: "event", timestamp: pr.creationDate, text: `${pr.createdBy || "Unknown"} created this pull request` });
    }
    return entries.sort((left, right) => (Date.parse(right.timestamp) || 0) - (Date.parse(left.timestamp) || 0));
}

function renderThread(thread, options) {
    const { avatarUrl } = options;
    const card = element("article", "comment-thread");
    const comments = thread.comments || [];
    const hasCode = Boolean(thread.filePath);
    const hasDiff = Array.isArray(thread.diff)
        ? thread.diff.length > 0
        : Boolean((thread.target || []).length || (thread.source || []).length);
    const threadUrl = thread.webUrl || comments[0]?.webUrl;
    const isActive = String(thread.status || "").toLowerCase() === "active";
    if (hasCode) {
        card.append(codeCommentHeader(thread, threadUrl, isActive));
        if (hasDiff) {
            card.append(codeDiff(thread));
        } else if (thread.codeError && Number(thread.lineNumber) > 0) {
            card.append(element("div", "comment-code-unavailable", `Code preview unavailable: ${thread.codeError}`));
        }
    }
    for (const [index, comment] of comments.entries()) {
        const post = element("div", "comment-post");
        if (!hasCode && index === 0) {
            post.append(commentHeader(comment, avatarUrl, threadUrl, isActive));
        } else {
            post.append(commentByline(comment, avatarUrl));
        }
        post.append(richTextElement("div", "comment-post-content", displayCommentText(comment), { format: "markdown" }));
        card.append(post);
    }
    if (thread.isResolvable !== false) {
        const footer = element("div", "comment-thread-actions");
        const message = element("div", "comment-thread-action-error");
        message.setAttribute("role", "alert");
        message.hidden = true;
        const parentCommentId = comments.find((comment) => !comment.isSystem)?.id || comments[0]?.id;
        let replyComposer = null;
        if (parentCommentId && options.onReplyComment) {
            const reply = element("button", "primer-button secondary comment-reply-button", "Reply");
            reply.type = "button";
            reply.addEventListener("click", () => {
                if (replyComposer) {
                    replyComposer.focus();
                    return;
                }
                replyComposer = createCommentComposer({
                    id: `pr-${options.pullRequestId}-thread-${thread.id}-reply`,
                    label: "Reply to this discussion",
                    submitLabel: "Reply",
                    avatarUrl,
                    onSearchIdentities: options.onSearchIdentities,
                    onSubmit: (content) => options.onReplyComment(thread.id, parentCommentId, content),
                    value: options.replyDrafts?.[thread.id]?.content || "",
                    mentions: options.replyDrafts?.[thread.id]?.mentions || [],
                    onChange: (draft) => options.onReplyDraftChange?.(thread.id, draft),
                    onCancel: () => {
                        replyComposer.host.remove();
                        replyComposer = null;
                        reply.focus();
                    },
                });
                card.append(replyComposer.host);
                replyComposer.focus();
            });
            footer.append(reply);
        }
        if (options.onSetThreadStatus) {
            const nextStatus = isResolved(thread) ? "active" : "fixed";
            const status = element(
                "button",
                "primer-button secondary comment-status-button",
                nextStatus === "active" ? "Reopen" : "Resolve",
            );
            status.type = "button";
            status.addEventListener("click", async () => {
                const controls = [...footer.querySelectorAll("button")];
                controls.forEach((control) => { control.disabled = true; });
                message.hidden = true;
                try {
                    await options.onSetThreadStatus(thread.id, nextStatus);
                } catch (error) {
                    message.textContent = error?.message || "Could not update the discussion status.";
                    message.hidden = false;
                    controls.forEach((control) => { control.disabled = false; });
                }
            });
            footer.append(status);
        }
        if (isActive) {
            const fix = element("button", "primer-button secondary comment-fix-button");
            fix.type = "button";
            fix.append(copilotIcon(), element("span", "", "Fix"));
            footer.append(fix);
        }
        footer.append(message);
        card.append(footer);
    }
    return card;
}

function timelineEvent(entry) {
    const event = element("div", "timeline-event");
    const marker = element("span", "timeline-event-marker");
    marker.setAttribute("aria-hidden", "true");
    const content = element("div", "timeline-event-content");
    content.append(richTextElement("span", "timeline-event-text", entry.text, { inline: true, format: "markdown" }));
    const age = relativeTime(entry.timestamp);
    if (age) {
        content.append(document.createTextNode(" · "), element("span", "timeline-event-age", age));
    }
    event.append(marker, content);
    return event;
}

// A heading and its actions on one line, with the actions pushed to the far edge.
function headerRow(className, heading, action) {
    const row = element("div", className);
    row.append(heading);
    if (action) {
        row.append(action);
    }
    return row;
}

// Collects the field controls the view is showing so the form can read them all
// at save time; an untouched field stays out of the request.
function createFieldSet(onDirtyChange) {
    const controls = new Map();
    return {
        add(name, control) {
            controls.set(name, control);
            return control;
        },
        first: () => controls.values().next().value || null,
        anyDirty: () => [...controls.values()].some((control) => control.isDirty()),
        firstError: () => {
            for (const control of controls.values()) {
                const error = control.validate?.() || "";
                if (error) {
                    return error;
                }
            }
            return "";
        },
        changed: () => Object.fromEntries([...controls.entries()]
            .filter(([, control]) => control.isDirty())
            .map(([name, control]) => [name, control.getValue()])),
        onDirtyChange,
    };
}

function renderTitle(pr, options, fields) {
    if (!options.editMode) {
        const heading = element("h1", "pr-title");
        heading.append(element("span", "pr-title-text", pr.title));
        return heading;
    }
    return fields.add("title", createPlainField({
        label: "Pull request title",
        value: pr.title,
        required: true,
        onDirtyChange: fields.onDirtyChange,
        onSubmit: options.onSubmit,
        onCancel: options.onCancelEdit,
    })).host;
}

function renderDescription(pr, options, fields) {
    const block = element("article", "pr-description pr-activity-card");
    const header = element("div", "pr-description-header");
    header.append(element("h2", "section-title", "Description"));
    block.append(header);

    if (!options.editMode) {
        block.append(pr.description
            ? richTextElement("div", "pr-description-content", pr.description, { format: "markdown" })
            : element("div", "pr-empty-state", "No description has been added."));
        return block;
    }
    const control = fields.add("description", createMarkdownField({
        label: "Pull request description",
        value: pr.description || "",
        onDirtyChange: fields.onDirtyChange,
        onSubmit: options.onSubmit,
        onCancel: options.onCancelEdit,
    }));
    block.append(control.host);
    return block;
}

const PULL_REQUEST_STATUSES = {
    active: { label: "Active", tone: "info" },
    completed: { label: "Completed", tone: "success" },
    abandoned: { label: "Abandoned", tone: "neutral" },
};

function pullRequestStatusBadge(statusValue) {
    const status = String(statusValue || "").trim().toLowerCase();
    const definition = PULL_REQUEST_STATUSES[status] || {
        label: status ? status[0].toUpperCase() + status.slice(1) : "Not set",
        tone: "neutral",
    };
    return element("span", `pr-status pr-status-${definition.tone}`, definition.label);
}

/**
 * Renders a pull request, either read-only or with every supported field in edit
 * mode at once. See renderWorkItem for why edit mode is a property of the view
 * rather than of a single field.
 */
export function renderPullRequest(container, pr, options) {
    container.replaceChildren();
    const summary = element("article", "pr-summary");

    const fields = createFieldSet(() => options.onDirtyChange?.(fields.anyDirty()));

    let actions = null;
    if (options.editMode) {
        actions = createEditActions({
            onCancel: () => options.onCancelEdit?.(),
            onSave: async () => {
                const error = fields.firstError();
                if (error) {
                    throw new Error(error);
                }
                await options.onSave?.(fields.changed());
            },
        });
    }

    const overview = element("section", "pr-overview");
    const header = element("div", "pr-header");
    const headerCopy = element("div", "pr-header-copy");
    const titleRow = headerRow("pr-title-row", renderTitle(pr, options, fields), null);
    headerCopy.append(titleRow);
    const merge = element("div", "pr-merge-summary");
    const identity = element("div", "pr-identity-summary");
    identity.append(pullRequestStatusBadge(pr.status));
    if (pr.isDraft) {
        identity.append(element("span", "draft-badge", "Draft"));
    }
    identity.append(pr.webUrl ? link(`!${pr.id}`, pr.webUrl, "pr-link") : document.createTextNode(`!${pr.id}`));
    identity.append(element("span", "pr-proposal", `${pr.createdBy || "Unknown"} proposes to merge`));
    const source = branchLink(pr, pr.sourceRefName);
    const target = branchLink(pr, pr.targetRefName);
    const sourceName = branchName(pr.sourceRefName);
    const targetName = branchName(pr.targetRefName);
    const branchFlow = element("div", "pr-branch-flow");
    branchFlow.append(
        source ? link(sourceName, source, "pr-branch") : element("span", "pr-branch", sourceName),
        element("span", "pr-merge-into", "into"),
        target ? link(targetName, target, "pr-branch") : element("span", "pr-branch", targetName),
    );
    merge.append(identity, branchFlow);
    header.append(headerCopy);
    // The decisions share the title row, while the merge proposal gets the full
    // row beneath both columns instead of wrapping in the space left by buttons.
    const headerActions = element("div", "pr-header-actions");
    if (options.editMode) {
        headerActions.append(actions.host);
    } else {
        if (options.canEdit) {
            headerActions.append(editButton("this pull request", () => options.onEdit?.()));
        }
        headerActions.append(renderPullRequestActions(pr, options));
    }
    if (headerActions.childElementCount) {
        header.append(headerActions);
    }
    header.append(merge);
    overview.append(header);
    summary.append(overview);

    const readiness = renderPullRequestChecks(pr);

    // Below the header the view splits the way the Azure DevOps web UI does: the
    // description and the discussion take the width, and the reviewer roster and
    // linked work items ride alongside them in a sidebar rather than being pushed
    // below the fold. In edit mode there is no sidebar, so the editor gets the
    // full width.
    const body = element("div", "pr-body");
    const mainColumn = element("div", "pr-main-column pr-activity");
    mainColumn.append(readiness);

    const description = renderDescription(pr, options, fields);
    if (description) {
        mainColumn.append(description);
    }

    if (!options.editMode) {
        const sidebar = element("aside", "pr-sidebar");
        sidebar.setAttribute("aria-label", "Pull request context");
        sidebar.append(renderReviewers(pr, options));
        sidebar.append(renderLinkedWorkItems(pr, options.relatedWorkItems, options));
        body.classList.add("has-sidebar");
        body.append(mainColumn, sidebar);
    } else {
        body.append(mainColumn);
    }
    summary.append(body);

    const entries = timelineEntries(pr);
    const threads = entries.filter((entry) => entry.kind === "thread");
    const filters = [
        ["all", "All", entries.length],
        ["comments", "Comments", threads.length],
        ["mine", "My comments and replies", threads.filter((entry) => entry.thread.comments.some((comment) => comment.isMine)).length],
        ["active", "Active comments", threads.filter((entry) => entry.thread.status === "active").length],
        ["resolved", "Resolved comments", threads.filter((entry) => isResolved(entry.thread)).length],
    ];
    const timeline = element("section", "timeline pr-activity-section");
    const timelineHeader = element("div", "timeline-header");
    const timelineHeading = element("div", "discussion-header");
    timelineHeading.append(
        element("h2", "discussion-title", "Activity"),
        element("span", "primer-counter", entries.length),
    );
    const controls = element("div", "timeline-filters");
    const selectedFilter = filters.find(([id]) => id === options.timelineFilter) || filters[0];
    const { control: filterControl } = createActionMenu({
        id: `comment-filter-menu-${pr.id}`,
        className: "timeline-filter-control",
        triggerLabel: `${selectedFilter[1]} (${selectedFilter[2]})`,
        triggerAriaLabel: `Filter comments: ${selectedFilter[1]}`,
        menuAriaLabel: "Filter comments",
        items: filters.map(([id, label, count]) => ({
            id,
            label: `${label} (${count})`,
            checked: id === options.timelineFilter,
            role: "menuitemradio",
            dataset: { filter: id },
        })),
        onSelect: (id) => options.onFilter(id),
    });
    controls.append(filterControl);
    timelineHeader.append(timelineHeading, controls);
    const visible = entries.filter((entry) => options.timelineFilter === "all" || entry.kind === "thread" && (
        options.timelineFilter === "comments" ||
        options.timelineFilter === "mine" && entry.thread.comments.some((comment) => comment.isMine) ||
        options.timelineFilter === "active" && entry.thread.status === "active" ||
        options.timelineFilter === "resolved" && isResolved(entry.thread)
    ));
    const content = element("div", "timeline-entries");
    for (const entry of visible) {
        content.append(entry.kind === "thread"
            ? renderThread(entry.thread, { ...options, pullRequestId: pr.id })
            : timelineEvent(entry));
    }
    if (!visible.length) {
        content.append(element(
            "div",
            "timeline-empty",
            options.timelineFilter === "all"
                ? "No pull request activity yet."
                : `No activity matches the ${selectedFilter[1].toLowerCase()} filter.`,
        ));
    }
    timeline.append(timelineHeader);
    if (options.onAddComment) {
        const composer = createCommentComposer({
            id: `pr-${pr.id}-new-comment`,
            label: "Add to the pull request discussion",
            submitLabel: "Comment",
            avatarUrl: options.avatarUrl,
            onSearchIdentities: options.onSearchIdentities,
            onSubmit: options.onAddComment,
            value: options.commentDraft?.content || "",
            mentions: options.commentDraft?.mentions || [],
            onChange: options.onCommentDraftChange,
        });
        timeline.append(composer.host);
    }
    timeline.append(content);
    // The discussion belongs to the main column so the sidebar stays at the top
    // right rather than floating above a full-width timeline.
    mainColumn.append(timeline);
    container.append(summary);

    if (options.editMode) {
        queueMicrotask(() => fields.first()?.focus());
    }
}
