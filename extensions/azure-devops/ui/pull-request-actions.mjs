// The pull request action surface: the review vote, the state changes, the
// reviewer roster, and the linked work items. These are the operations the
// Azure DevOps web UI offers on a pull request, so the canvas is not a read-only
// mirror that sends the user to the browser to actually decide anything.

import { createActionMenu } from "./action-menu.mjs";
import { PULL_REQUEST_REVIEW_VOTING_ENABLED } from "./feature-flags.mjs";
import { createSearchPicker } from "./search-picker.mjs";

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

const WORK_ITEM_TYPE_COLORS = new Map([
    ["bug", "#cc293d"],
    ["epic", "#ff7b00"],
    ["feature", "#773b93"],
    ["issue", "#339947"],
    ["product backlog item", "#009ccc"],
    ["requirement", "#009ccc"],
    ["task", "#f2cb1d"],
    ["user story", "#009ccc"],
]);

export function workItemTypeColor(workItem) {
    const supplied = String(workItem?.typeColor || "").trim().replace(/^#/, "");
    if (/^[0-9a-f]{6}$/i.test(supplied)) {
        return `#${supplied}`;
    }
    return WORK_ITEM_TYPE_COLORS.get(String(workItem?.type || "").trim().toLowerCase()) || "#0078d4";
}

function workItemType(workItem, className = "pr-work-item-type") {
    const type = element("span", className, workItem?.type || "Work item");
    type.style.setProperty("--work-item-type-color", workItemTypeColor(workItem));
    return type;
}

function button(label, className, onClick, { disabled = false, title = "" } = {}) {
    const node = element("button", ["primer-button", className].filter(Boolean).join(" "), label);
    node.type = "button";
    if (title) {
        node.title = title;
    }
    if (disabled) {
        node.disabled = true;
    } else {
        node.addEventListener("click", onClick);
    }
    return node;
}

// The vote values Azure DevOps stores, in the order the menu offers them.
export const VOTE_OPTIONS = [
    { id: "approve", label: "Approve", vote: 10 },
    { id: "approve-with-suggestions", label: "Approve with suggestions", vote: 5 },
    { id: "wait-for-author", label: "Wait for author", vote: -5 },
    { id: "reject", label: "Reject", vote: -10, danger: true },
    { id: "reset", label: "Reset feedback", vote: 0 },
];

// The label for the action that records a vote. Distinct from the label for a
// vote already cast: "Reset feedback" is a thing you do, and rendering it as a
// reviewer's status read as though that were their verdict.
export function voteLabel(vote) {
    const value = Number(vote) || 0;
    return VOTE_OPTIONS.find((option) => option.vote === value)?.label || "No vote";
}

const VOTE_STATES = new Map([
    [10, "Approved"],
    [5, "Approved with suggestions"],
    [0, "No vote"],
    [-5, "Waiting for author"],
    [-10, "Rejected"],
]);

/** The label for a vote a reviewer has already cast. */
export function voteStateLabel(vote) {
    return VOTE_STATES.get(Number(vote) || 0) || "No vote";
}

export function voteTone(vote) {
    const value = Number(vote) || 0;
    if (value >= 5) return "met";
    if (value <= -5) return "not-met";
    return "in-progress";
}

function isActive(pr) {
    return String(pr.status || "").toLowerCase() === "active";
}

/**
 * The state changes available for a pull request, given its current status, as a
 * primary action plus the rest of the menu. This mirrors the Azure DevOps split
 * button: the action you almost always want is the button, the others are behind
 * the caret. Completed pull requests are terminal, so they offer no primary.
 */
export function stateActions(pr) {
    const status = String(pr.status || "").toLowerCase();
    if (status === "completed") {
        return { primary: null, items: [] };
    }
    if (status === "abandoned") {
        const reactivate = { id: "reactivate", label: "Reactivate" };
        return { primary: reactivate, items: [reactivate] };
    }
    if (pr.isDraft) {
        const publish = { id: "publish", label: "Publish" };
        return {
            primary: publish,
            items: [publish, { id: "abandon", label: "Abandon", danger: true, confirm: true }],
        };
    }
    const complete = { id: "complete", label: "Complete", confirm: true };
    return {
        primary: complete,
        items: [
            complete,
            { id: "mark-draft", label: "Mark as draft" },
            { id: "abandon", label: "Abandon", danger: true, confirm: true },
        ],
    };
}

/**
 * The signed-in user's own reviewer record, which is what the vote menu reflects.
 * A user who is not on the reviewer list has no vote, which Azure DevOps treats
 * as a vote of 0 the moment they cast one.
 */
export function myReviewer(pr) {
    const myId = String(pr.currentUser?.id || "").toLowerCase();
    if (!myId) {
        return null;
    }
    return (pr.reviewers || []).find((reviewer) => String(reviewer.id || "").toLowerCase() === myId) || null;
}

function statusMessage(host, message, tone = "error") {
    host.replaceChildren();
    if (message) {
        host.append(element("p", `pr-action-message ${tone}`, message));
    }
}

// Actions are awaited with the whole bar disabled: Azure DevOps returns the
// refreshed pull request, and letting a second action start against the stale
// one is how a vote silently lands on the wrong revision.
function runAction(host, bar, operation) {
    const controls = [...bar.querySelectorAll("button")];
    for (const control of controls) {
        control.disabled = true;
    }
    statusMessage(host, "");
    return Promise.resolve()
        .then(operation)
        .catch((error) => {
            for (const control of controls) {
                control.disabled = false;
            }
            statusMessage(host, error?.message || "The action could not be completed.");
        });
}

// A destructive action asks first. Completing merges and abandoning closes, and
// neither is undone by clicking again, so the bar swaps itself for a confirmation
// rather than acting on the first click. This is inline rather than a modal
// because the canvas has no dialog layer and a modal would be heavier than the
// decision warrants.
function confirmAction(bar, messageHost, { label, question, danger }, onConfirm) {
    const previous = [...bar.childNodes];
    const prompt = element("div", "pr-confirm");
    prompt.setAttribute("role", "group");
    prompt.setAttribute("aria-label", question);
    prompt.append(element("span", "pr-confirm-question", question));
    const restore = () => {
        bar.replaceChildren(...previous);
        bar.querySelector(".pr-primary-button, button")?.focus();
    };
    const confirm = button(label, `primary pr-confirm-accept${danger ? " danger" : ""}`, () => {
        bar.replaceChildren(...previous);
        runAction(messageHost, bar, onConfirm);
    });
    const cancel = button("Cancel", "secondary pr-confirm-cancel", restore);
    prompt.append(confirm, cancel);
    bar.replaceChildren(prompt);
    confirm.focus();
}

// A split button: the action taken almost every time is the button, the rest sit
// behind the caret. The two share one outline so they read as one control.
function splitButton({ id, primaryLabel, primaryTitle, menuAriaLabel, items, disabled, disabledReason, onPrimary, onSelect, className, tone = "primary" }) {
    const group = element("div", `pr-split-button ${className}`.trim());
    const primary = element("button", `primer-button ${tone} pr-primary-button`, primaryLabel);
    primary.type = "button";
    if (disabled) {
        primary.disabled = true;
        if (disabledReason) primary.title = disabledReason;
    } else {
        if (primaryTitle) primary.title = primaryTitle;
        primary.addEventListener("click", onPrimary);
    }
    const { control, trigger } = createActionMenu({
        id,
        className: "pr-split-menu",
        triggerLabel: "",
        triggerAriaLabel: menuAriaLabel,
        menuAriaLabel,
        items,
        onSelect,
    });
    trigger.classList.add("pr-split-caret");
    if (disabled && !items.some((item) => !item.disabled)) {
        trigger.disabled = true;
        if (disabledReason) trigger.title = disabledReason;
    }
    group.append(primary, control);
    return group;
}

function renderVoteControl(pr, options, bar, messageHost) {
    const mine = myReviewer(pr);
    const currentVote = Number(mine?.vote) || 0;
    const disabled = !isActive(pr) || !pr.currentUser?.id;
    const group = splitButton({
        id: `pr-vote-menu-${pr.id}`,
        className: "pr-vote-control",
        // Reviewing is the secondary treatment and completing the primary, which
        // is how Azure DevOps ranks the two.
        tone: "secondary",
        // Approve is the primary because it is the action taken most of the time;
        // the button keeps that label whatever the current vote is, so it always
        // says what clicking it does rather than what has already happened.
        primaryLabel: "Approve",
        primaryTitle: currentVote ? `Your current vote: ${voteLabel(currentVote)}` : "",
        menuAriaLabel: `Review options. Your current vote: ${voteLabel(currentVote)}`,
        items: VOTE_OPTIONS.map((option) => ({
            id: option.id,
            label: option.label,
            checked: option.vote === currentVote,
            role: "menuitemradio",
            danger: option.danger,
            disabled,
            dataset: { vote: option.id },
        })),
        disabled,
        disabledReason: disabled
            ? isActive(pr)
                ? "Azure DevOps did not identify the signed-in user, so a vote cannot be recorded."
                : `A ${String(pr.status || "").toLowerCase()} pull request cannot be reviewed.`
            : "",
        onPrimary: () => runAction(messageHost, bar, () => options.onVote?.("approve")),
        onSelect: (id) => runAction(messageHost, bar, () => options.onVote?.(id)),
    });
    const primary = group.querySelector(".pr-primary-button");
    primary.dataset.vote = String(currentVote);
    primary.classList.add(`vote-${voteTone(currentVote)}`);
    if (currentVote === 10) {
        primary.setAttribute("aria-pressed", "true");
    }
    return group;
}

function stateActionRunner(pr, action, options, bar, messageHost) {
    const run = () => options.onStateAction?.(action.id);
    if (!action.confirm) {
        return () => runAction(messageHost, bar, run);
    }
    return () => confirmAction(bar, messageHost, {
        label: action.label,
        danger: action.danger,
        question: action.id === "complete"
            ? `Complete !${pr.id} and merge it into ${String(pr.targetRefName || "").replace(/^refs\/heads\//, "") || "the target branch"}?`
            : `Abandon !${pr.id}?`,
    }, run);
}

function renderStateControl(pr, options, bar, messageHost) {
    const { primary, items } = stateActions(pr);
    // The link into Azure DevOps lives in this menu rather than as its own button:
    // it is the least used action on the pull request, and it was taking the most
    // prominent spot in the header.
    const menuItems = items.map((action) => ({
        id: action.id,
        label: action.label,
        danger: action.danger,
        dataset: { action: action.id },
        onSelect: stateActionRunner(pr, action, options, bar, messageHost),
    }));
    if (pr.webUrl) {
        menuItems.push({
            id: "view-in-ado",
            label: "View pull request in Azure DevOps",
            dataset: { action: "view-in-ado" },
            onSelect: () => options.onViewInAzureDevOps?.(pr.webUrl),
        });
    }
    if (!menuItems.length) {
        return null;
    }
    if (!primary) {
        // Nothing can be done to a completed pull request, so the menu stands on
        // its own rather than pairing with a disabled primary button.
        const { control } = createActionMenu({
            id: `pr-state-menu-${pr.id}`,
            className: "pr-state-control pr-state-menu-only",
            triggerLabel: "Actions",
            triggerAriaLabel: "Pull request actions",
            menuAriaLabel: "Pull request actions",
            items: menuItems,
        });
        return control;
    }
    return splitButton({
        id: `pr-state-menu-${pr.id}`,
        className: "pr-state-control",
        primaryLabel: primary.label,
        menuAriaLabel: "Pull request actions",
        items: menuItems,
        onPrimary: stateActionRunner(pr, primary, options, bar, messageHost),
    });
}

export function renderPullRequestActions(pr, options = {}) {
    const section = element("div", "pr-actions");
    const bar = element("div", "pr-action-bar");
    const messageHost = element("div", "pr-action-messages");
    if (PULL_REQUEST_REVIEW_VOTING_ENABLED) {
        bar.append(renderVoteControl(pr, options, bar, messageHost));
    }
    const state = renderStateControl(pr, options, bar, messageHost);
    if (state) {
        bar.append(state);
    }
    section.append(bar, messageHost);
    return section;
}

function reviewerAvatar(reviewer, options) {
    const url = options.avatarUrl?.(reviewer.imageUrl);
    if (url) {
        const image = element("img", "reviewer-avatar");
        image.src = url;
        image.alt = "";
        return image;
    }
    const initials = String(reviewer.displayName || "?")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join("") || "?";
    return element("span", "reviewer-avatar reviewer-avatar-initials", initials);
}

function ellipsisIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("reviewer-menu-icon");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M8 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm-5 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z");
    svg.append(path);
    return svg;
}

function reviewerRow(pr, reviewer, options, host, messageHost) {
    const row = element("li", "reviewer-row");
    row.dataset.reviewerId = reviewer.id;
    row.dataset.required = String(Boolean(reviewer.isRequired));
    const identity = element("div", "reviewer-identity");
    identity.append(reviewerAvatar(reviewer, options));
    const copy = element("div", "reviewer-copy");
    copy.append(element("span", "reviewer-name", reviewer.displayName));
    if (reviewer.uniqueName) {
        copy.append(element("span", "reviewer-unique-name", reviewer.uniqueName));
    }
    identity.append(copy);
    row.append(identity);

    const meta = element("div", "reviewer-meta");
    meta.append(element("span", `reviewer-vote vote-${voteTone(reviewer.vote)}`, voteStateLabel(reviewer.vote)));
    row.append(meta);

    if (options.canManageReviewers) {
        const isMe = String(reviewer.id || "").toLowerCase() === String(pr.currentUser?.id || "").toLowerCase();
        const items = [{
            id: "role",
            label: reviewer.isRequired ? "Make optional" : "Make required",
            dataset: { role: reviewer.isRequired ? "optional" : "required" },
            onSelect: () => runAction(
                messageHost,
                host,
                () => options.onSetReviewer?.(reviewer.id, !reviewer.isRequired),
            ),
        }];
        // Resetting a vote is only offered on your own row. The vote endpoint
        // always writes as the signed-in identity, so offering it on someone
        // else's row would quietly reset your own vote instead of theirs.
        if (PULL_REQUEST_REVIEW_VOTING_ENABLED && isMe && Number(reviewer.vote)) {
            items.push({
                id: "reset",
                label: "Reset feedback",
                dataset: { action: "reset" },
                onSelect: () => runAction(messageHost, host, () => options.onVote?.("reset")),
            });
        }
        items.push({
            id: "remove",
            label: "Remove",
            danger: true,
            dataset: { action: "remove" },
            onSelect: () => runAction(messageHost, host, () => options.onRemoveReviewer?.(reviewer.id)),
        });

        // One small overflow control on the right rather than a row of buttons:
        // the roster is a list of people, and a full-width control per person
        // dominated a sidebar that is mostly names.
        const { control, trigger } = createActionMenu({
            id: `reviewer-menu-${pr.id}-${reviewer.id}`,
            className: "reviewer-menu",
            triggerLabel: "",
            triggerAriaLabel: `Options for ${reviewer.displayName}`,
            menuAriaLabel: `Options for ${reviewer.displayName}`,
            items,
        });
        trigger.classList.add("reviewer-menu-trigger");
        trigger.querySelector(".primer-action-menu-caret")?.remove();
        trigger.append(ellipsisIcon());
        row.append(control);
    }
    return row;
}

// The picker is built per role: the group it is opened from decides whether the
// reviewer is added as required or optional, so the role never has to be chosen
// as a separate step.
function reviewerPicker(pr, required, options, host, messageHost) {
    const existing = new Set((pr.reviewers || []).map((reviewer) => String(reviewer.id || "").toLowerCase()));
    const role = required ? "required" : "optional";
    const { picker } = createSearchPicker({
        prefix: "reviewer",
        id: `reviewer-picker-${pr.id}-${role}`,
        labelText: `Add a ${role} reviewer`,
        placeholder: "Search people and groups",
        inputAriaLabel: `Search Azure DevOps people and groups to add as a ${role} reviewer`,
        resultsAriaLabel: `Reviewer search results for ${role} reviewers`,
        emptyText: "No matching people or groups.",
        failureText: "The reviewer search failed.",
        onSearch: async (query) => {
            const found = await options.onSearchIdentities?.(query);
            return {
                error: found?.error || "",
                items: (found?.identities || []).filter(
                    (identity) => !existing.has(String(identity.id).toLowerCase()),
                ),
            };
        },
        renderResult: (node, identity) => {
            node.dataset.identityId = identity.id;
            node.append(reviewerAvatar(identity, options));
            const copy = element("div", "reviewer-copy");
            copy.append(element("span", "reviewer-name", identity.displayName));
            if (identity.uniqueName) {
                copy.append(element("span", "reviewer-unique-name", identity.uniqueName));
            }
            node.append(copy);
        },
        onPick: (identity) => options.onSetReviewer?.(identity.id, required),
        execute: (operation) => runAction(messageHost, host, operation),
    });
    picker.dataset.role = role;
    return picker;
}

function plusIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("reviewer-add-icon");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M7.25 3.25a.75.75 0 0 1 1.5 0v4h4a.75.75 0 0 1 0 1.5h-4v4a.75.75 0 0 1-1.5 0v-4h-4a.75.75 0 0 1 0-1.5h4Z");
    svg.append(path);
    return svg;
}

function unlinkIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("pr-work-item-unlink-icon");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z");
    svg.append(path);
    return svg;
}

// The work item picker searches the project rather than asking for an id. A
// number input with increment arrows implied that work item ids are a range to
// step through, which they are not.
function workItemPicker(pr, linkedIds, options, host, messageHost) {
    const linked = new Set(linkedIds.map((id) => Number(id)));
    const { picker } = createSearchPicker({
        prefix: "pr-work-item",
        id: `pr-work-item-picker-${pr.id}`,
        labelText: "Link",
        placeholder: "Search by title or ID",
        inputAriaLabel: "Search Azure DevOps work items to link to this pull request",
        resultsAriaLabel: "Work item search results",
        minChars: 0,
        emptyText: "No matching work items.",
        failureText: "The work item search failed.",
        onSearch: async (query) => {
            const found = await options.onSearchWorkItems?.(query);
            return {
                error: found?.error || "",
                items: (found?.workItems || []).filter((workItem) => !linked.has(Number(workItem.id))),
            };
        },
        renderResult: (node, workItem) => {
            node.dataset.workItemId = String(workItem.id);
            node.append(element("span", "pr-work-item-id", `#${workItem.id}`));
            const copy = element("div", "pr-work-item-result-copy");
            copy.append(element("span", "pr-work-item-result-title", workItem.title || `Work item ${workItem.id}`));
            if (workItem.type || workItem.state) {
                const meta = element("span", "pr-work-item-result-meta");
                if (workItem.type) {
                    meta.append(workItemType(workItem, "pr-work-item-result-type"));
                }
                if (workItem.type && workItem.state) {
                    meta.append(document.createTextNode(" · "));
                }
                if (workItem.state) {
                    meta.append(element("span", "", workItem.state));
                }
                copy.append(meta);
            }
            node.append(copy);
        },
        onPick: (workItem) => options.onLinkWorkItem?.(Number(workItem.id)),
        execute: (operation) => runAction(messageHost, host, operation),
    });
    return picker;
}

function reviewerGroup(pr, { title, required, reviewers }, options, host, messageHost) {
    const role = required ? "required" : "optional";
    const group = element("div", "reviewer-group");
    group.dataset.role = role;
    group.append(element("h3", "reviewer-group-title", `${title} (${reviewers.length})`));
    const list = element("ul", "reviewer-list");
    if (!reviewers.length) {
        list.append(element("li", "reviewer-empty", `No ${role} reviewers.`));
    }
    for (const reviewer of reviewers) {
        list.append(reviewerRow(pr, reviewer, options, host, messageHost));
    }
    group.append(list);

    if (options.canManageReviewers) {
        // Each group adds its own reviewers. Which group the button belongs to is
        // what makes the reviewer required or optional, so the role is never a
        // separate control the user has to notice and set.
        const picker = reviewerPicker(pr, required, options, host, messageHost);
        picker.hidden = true;
        const add = element("button", "reviewer-add-button");
        add.type = "button";
        add.dataset.role = role;
        add.setAttribute("aria-expanded", "false");
        add.setAttribute("aria-label", `Add a ${role} reviewer`);
        add.append(plusIcon(), element("span", "reviewer-add-label", "Add"));
        add.addEventListener("click", () => {
            const opening = picker.hidden;
            picker.hidden = !opening;
            add.setAttribute("aria-expanded", String(opening));
            if (opening) {
                picker.querySelector("input")?.focus();
            }
        });
        group.append(add, picker);
    }
    return group;
}

export function renderReviewers(pr, options = {}) {
    const all = pr.reviewers || [];
    const section = element("section", "pr-reviewers pr-context-section");
    const heading = element("div", "pr-context-heading");
    heading.append(
        element("h2", "section-title", "Reviewers"),
        element("span", "primer-counter", all.length),
    );
    section.append(heading);
    const body = element("div", "pr-reviewers-body");
    const messageHost = element("div", "pr-action-messages");
    const byName = (left, right) => String(left.displayName).localeCompare(String(right.displayName));
    // Required and optional are listed separately rather than tagged per row: on
    // a pull request the question is "who has to sign off", and a group answers
    // that at a glance where a per-row label does not.
    const groups = [
        { title: "Required", required: true, reviewers: all.filter((reviewer) => reviewer.isRequired).sort(byName) },
        { title: "Optional", required: false, reviewers: all.filter((reviewer) => !reviewer.isRequired).sort(byName) },
    ];
    for (const group of groups) {
        if (group.reviewers.length || options.canManageReviewers) {
            body.append(reviewerGroup(pr, group, options, body, messageHost));
        }
    }
    body.append(messageHost);
    section.append(body);
    return section;
}

function workItemRow(workItem, options, host, messageHost) {
    const row = element("li", "pr-work-item-row");
    row.dataset.workItemId = String(workItem.id);
    const copy = element("div", "pr-work-item-copy");
    const kicker = element("div", "pr-work-item-kicker");
    kicker.append(workItemType(workItem), element("span", "pr-work-item-id", `#${workItem.id}`));
    copy.append(kicker);
    const title = element("button", "pr-work-item-title", workItem.title || `Work item ${workItem.id}`);
    title.type = "button";
    title.addEventListener("click", () => options.onOpenWorkItem?.(workItem));
    copy.append(title);
    if (workItem.state) {
        copy.append(element("span", "pr-work-item-state", workItem.state));
    }
    row.append(copy);
    if (options.canManageWorkItems) {
        const unlink = button(
            "",
            "secondary danger pr-work-item-unlink",
            () => runAction(messageHost, host, () => options.onUnlinkWorkItem?.(workItem.id)),
            { title: "Unlink" },
        );
        unlink.setAttribute("aria-label", `Unlink work item #${workItem.id}`);
        unlink.append(unlinkIcon());
        row.append(unlink);
    }
    return row;
}

export function renderLinkedWorkItems(pr, relatedWorkItems, options = {}) {
    const workItems = relatedWorkItems?.workItems || [];
    const section = element("section", "pr-work-items pr-context-section");
    const heading = element("div", "pr-context-heading");
    heading.append(
        element("h2", "section-title", "Linked work items"),
        element("span", "primer-counter", workItems.length),
    );
    section.append(heading);
    const body = element("div", "pr-work-items-body");
    const messageHost = element("div", "pr-action-messages");
    const list = element("ul", "pr-work-item-list");
    if (relatedWorkItems?.error) {
        list.append(element("li", "pr-work-item-empty", relatedWorkItems.error));
    } else if (!workItems.length) {
        list.append(element("li", "pr-work-item-empty", "No work items are linked to this pull request."));
    }
    for (const workItem of workItems) {
        list.append(workItemRow(workItem, options, body, messageHost));
    }
    body.append(list);

    if (options.canManageWorkItems) {
        body.append(workItemPicker(pr, workItems.map((workItem) => workItem.id), options, body, messageHost));
    }
    body.append(messageHost);
    section.append(body);
    return section;
}
