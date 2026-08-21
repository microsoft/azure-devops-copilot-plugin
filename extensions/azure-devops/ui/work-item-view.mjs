import {
    createChoiceField,
    createEditActions,
    createHtmlField,
    createMarkdownField,
    createPlainField,
    editButton,
} from "./editor.mjs";
import { createCommentComposer } from "./comment-composer.mjs";
import { canEditStoredHtml } from "./editable-html.mjs";
import { richTextElement } from "./rich-text.mjs";

function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function externalLink(text, href, className = "") {
    const node = element("a", className, text);
    node.href = href;
    node.target = "_blank";
    node.rel = "noopener noreferrer";
    return node;
}

function link(text, href, className = "") {
    return externalLink(text, href, ["primer-link", className].filter(Boolean).join(" "));
}

function secondaryLink(text, href, className = "") {
    return externalLink(text, href, ["primer-button", "secondary", className].filter(Boolean).join(" "));
}

function relativeTime(value) {
    const elapsed = Date.now() - Date.parse(value);
    if (!Number.isFinite(elapsed) || elapsed < 0) return "";
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
    return `${Math.floor(minutes / 1440)}d ago`;
}

function absoluteTime(value) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : "";
}

// Azure DevOps returns colors as bare hex; a leading # makes them usable in CSS.
function cssColor(value) {
    return /^#?[0-9a-fA-F]{6}$/.test(String(value || "")) ? `#${String(value).replace(/^#/, "")}` : "";
}

function statePill(item) {
    const pill = element("span", "state-pill", item.state || "Unknown");
    const category = String(item.stateCategory || "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    if (category) {
        pill.classList.add(`state-${category}`);
    }
    const color = cssColor(item.stateColor);
    if (color) {
        pill.style.setProperty("--state-color", color);
        pill.classList.add("has-color");
    }
    return pill;
}

function personLine(label, name, date) {
    if (!name && !date) {
        return null;
    }
    const age = relativeTime(date);
    const line = element("span", "work-item-person");
    line.append(
        element("span", "work-item-person-label", label),
        element("span", "work-item-person-name", name || "Unknown"),
    );
    if (age) {
        line.append(element("span", "work-item-person-time", `· ${age}`));
    }
    const exact = absoluteTime(date);
    if (exact) line.title = exact;
    return line;
}

function detailsGrid(item, details, options, fields) {
    const grid = element("dl", "detail-grid");
    grid.style.setProperty("--detail-rows", Math.ceil(details.length / 2));
    for (const detail of details) {
        const row = element("div", "detail-item");
        const value = element("dd");
        if (detail.name.toLowerCase() === "state") {
            value.append(renderState(item, options, fields));
        } else {
            value.textContent = detail.value;
        }
        row.append(element("dt", "", detail.name), value);
        grid.append(row);
    }
    return grid;
}

function relationIcon(kind) {
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.classList.add("relation-icon", `relation-icon-${kind || "link"}`);
    icon.setAttribute("viewBox", "0 0 16 16");
    icon.setAttribute("width", "16");
    icon.setAttribute("height", "16");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M7.775 3.275a3.25 3.25 0 0 1 4.596 4.596l-1.5 1.5a.75.75 0 0 1-1.06-1.06l1.5-1.5a1.75 1.75 0 1 0-2.475-2.475l-1.5 1.5a.75.75 0 0 1-1.06-1.06l1.5-1.5Zm-2.646 3.35a.75.75 0 0 1 1.06 1.06l-1.5 1.5a1.75 1.75 0 1 0 2.475 2.475l1.5-1.5a.75.75 0 0 1 1.06 1.06l-1.5 1.5a3.25 3.25 0 0 1-4.596-4.596l1.5-1.5Z");
    icon.append(path);
    return icon;
}

function relationTarget(entry, onOpenWorkItem) {
    let target;
    if (entry.id && onOpenWorkItem) {
        target = element("button", "primer-link relation-link");
        target.type = "button";
        target.addEventListener("click", () => onOpenWorkItem(entry));
    } else if (entry.webUrl) {
        target = link(undefined, entry.webUrl, "relation-link");
    } else {
        target = element("span", "relation-link");
    }
    target.append(element("span", "relation-reference", entry.label));
    if (entry.title) {
        target.append(document.createTextNode(" "), element("span", "relation-title", entry.title));
    }
    target.title = [entry.label, entry.title].filter(Boolean).join(" ");
    return target;
}

function relationRow(entry, groupName, onOpenWorkItem, development = false) {
    const row = element("article", "relation-row");
    const content = element("div", "relation-row-content");
    const metadata = [
        development ? entry.kindLabel : groupName,
        entry.state,
        relativeTime(entry.changedDate),
    ].filter(Boolean);
    const meta = metadata.length
        ? element("div", development ? "relation-kind" : "relation-meta", metadata.join(" · "))
        : null;
    if (development && meta) {
        content.append(meta);
    }
    content.append(relationTarget(entry, onOpenWorkItem));
    if (!development && meta) {
        content.append(meta);
    }
    row.append(relationIcon(entry.kind), content);
    return row;
}

function relationsSection(title, groups, onOpenWorkItem, { development = false } = {}) {
    const entries = groups.flatMap((group) =>
        (group.links || []).map((entry) => ({ entry, groupName: group.name })));
    if (!entries.length) {
        return null;
    }
    const card = element(
        "section",
        `work-item-card work-item-sidebar-card ${development ? "development-section" : "related-work-section"}`,
    );
    const header = element("div", "work-item-card-header");
    header.append(
        element("h2", "work-item-card-title section-title", title),
        element("span", "primer-counter", entries.length),
    );
    card.append(header);

    const list = element("div", "relation-list");
    for (const { entry, groupName } of entries.slice(0, 6)) {
        list.append(relationRow(entry, groupName, onOpenWorkItem, development));
    }
    card.append(list);

    if (entries.length > 6) {
        const overflow = element("details", "relation-overflow");
        overflow.append(element("summary", "primer-link relation-show-more", `Show ${entries.length - 6} more`));
        const overflowList = element("div", "relation-list relation-list-overflow");
        for (const { entry, groupName } of entries.slice(6)) {
            overflowList.append(relationRow(entry, groupName, onOpenWorkItem, development));
        }
        overflow.append(overflowList);
        card.append(overflow);
    }
    return card;
}

function detailsSection(item, details, options, fields) {
    const card = element("section", "work-item-card work-item-details");
    card.setAttribute("aria-label", "Work item details");
    if (details.length) {
        card.append(detailsGrid(item, details, options, fields));
    }
    return card;
}

function authorInitials(name) {
    return String(name || "?")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || "?";
}

function identityAvatar(name, imageUrl, avatarUrl, className = "comment-avatar") {
    const avatar = element("span", className, authorInitials(name));
    avatar.setAttribute("aria-hidden", "true");
    const src = avatarUrl?.(imageUrl);
    if (src) {
        const image = element("img", "comment-avatar-image identity-avatar-image");
        image.alt = "";
        image.src = src;
        image.addEventListener("error", () => image.remove(), { once: true });
        avatar.append(image);
    }
    return avatar;
}

function commentAvatar(comment, avatarUrl) {
    return identityAvatar(comment.author, comment.authorImageUrl, avatarUrl);
}

function metadataSection(item, avatarUrl) {
    const meta = element("div", "work-item-meta");
    const summary = element("div", "work-item-meta-summary");
    const assignee = element("span", "work-item-meta-badge");
    assignee.append(
        document.createTextNode("Assigned to "),
        identityAvatar(item.assignedTo, item.assignedToImageUrl, avatarUrl, "work-item-meta-avatar"),
        element("strong", "", item.assignedTo),
    );
    summary.append(
        assignee,
        element(
            "span",
            "work-item-meta-badge",
            `${item.commentCount} comment${item.commentCount === 1 ? "" : "s"}`,
        ),
    );
    for (const tag of item.tags || []) {
        summary.append(element("span", "tag", tag));
    }

    const people = element("div", "work-item-meta-people");
    for (const line of [
        personLine("Created by", item.createdBy, item.createdDate),
        personLine("Updated by", item.changedBy, item.changedDate),
    ]) {
        if (line) people.append(line);
    }
    meta.append(summary);
    if (people.childElementCount) {
        meta.append(people);
    }
    return meta;
}

function discussionSection(item, options) {
    const discussion = element("section", "discussion work-item-discussion");
    const header = element("div", "discussion-header");
    header.append(element("h2", "discussion-title", "Discussion"));
    const count = Number(item.commentCount) || 0;
    const counter = element("span", "primer-counter", count);
    counter.setAttribute("aria-label", `${count} comment${count === 1 ? "" : "s"}`);
    header.append(counter);
    discussion.append(header);

    if (options.onAddComment) {
        discussion.append(createCommentComposer({
            id: `work-item-${item.id}-new-comment`,
            label: "Add to the work item discussion",
            submitLabel: "Comment",
            avatarUrl: options.avatarUrl,
            onSearchIdentities: options.onSearchIdentities,
            onSubmit: options.onAddComment,
            value: options.commentDraft?.content || "",
            mentions: options.commentDraft?.mentions || [],
            onChange: options.onCommentDraftChange,
        }).host);
    }

    if (!(item.discussion || []).length) {
        discussion.append(element("div", "status work-item-empty", "No discussion yet."));
        return discussion;
    }

    const list = element("div", "discussion-list");
    for (const comment of item.discussion) {
        const card = element("article", "comment-thread work-item-comment");
        const post = element("div", "comment-post");
        const commentHeader = element("div", "comment-header");
        const identity = element("div", "comment-header-title");
        const age = relativeTime(comment.createdDate);
        const metadata = element("span", "comment-header-meta");
        metadata.append(element("span", "comment-header-author", comment.author || "Unknown"));
        if (age) {
            const timestamp = element("span", "comment-header-age", age);
            const exact = absoluteTime(comment.createdDate);
            if (exact) timestamp.title = exact;
            metadata.append(document.createTextNode(" · "), timestamp);
        }
        identity.append(commentAvatar(comment, options.avatarUrl), metadata);
        commentHeader.append(identity);
        // Discussion content is mixed in practice: service comments carry raw
        // HTML while human comments can carry Markdown. markdown-it handles both.
        post.append(commentHeader, richTextElement(
            "div",
            "comment-post-content comment-text",
            comment.text,
            { format: comment.format || "html" },
        ));
        card.append(post);
        list.append(card);
    }
    discussion.append(list);
    return discussion;
}

function summaryDetails(item) {
    const mapped = new Map(
        (item.details || []).map((detail) => [String(detail.name || "").trim().toLowerCase(), detail.value]),
    );
    return [
        { name: "State", value: mapped.get("state") || item.state },
        { name: "Reason", value: mapped.get("reason") || item.reason },
        { name: "Area", value: mapped.get("area") || item.area },
        { name: "Iteration", value: mapped.get("iteration") || item.iteration },
    ].filter((detail) => detail.value);
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

// Shown in place of the editor when a field's stored markup uses formatting the
// canvas cannot round-trip. Sending the user to Azure DevOps is the honest
// outcome: the alternative is saving a version with the formatting silently gone.
function readOnlyNotice(item, reason) {
    const notice = element("div", "field-locked");
    notice.append(element("span", "", reason));
    if (item.webUrl) {
        notice.append(link("Edit in Azure DevOps", item.webUrl, "field-locked-link"));
    }
    return notice;
}

// Collects the field controls a detail view is currently showing, so the form can
// read them all at save time. A control only contributes when the user actually
// changed it, which keeps an untouched field out of the request.
function createFieldSet(onDirtyChange) {
    const controls = new Map();
    let primary = null;
    return {
        // A control marked primary is the one edit mode focuses, whatever order
        // the view happens to build its rows in. The heading is rendered after
        // the subtitle here, so insertion order alone would put the caret in the
        // state picker and let a stray arrow key change the work item's state.
        add(name, control, { isPrimary = false } = {}) {
            controls.set(name, control);
            if (isPrimary) {
                primary = name;
            }
            return control;
        },
        first: () => (primary && controls.get(primary)) || controls.values().next().value || null,
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
        changed: () => [...controls.entries()]
            .filter(([, control]) => control.isDirty())
            .map(([name, control]) => ({ name, value: control.getValue(), isHtml: Boolean(control.isHtml) })),
        onDirtyChange,
    };
}

function renderHeading(item, options, fields) {
    if (!options.editMode) {
        return element("h1", "work-item-title", item.title);
    }
    const control = fields.add("System.Title", createPlainField({
        label: "Title",
        value: item.title,
        required: true,
        onDirtyChange: fields.onDirtyChange,
        onSubmit: options.onSubmit,
        onCancel: options.onCancelEdit,
    }), { isPrimary: true });
    const wrapper = element("div", "work-item-title-edit");
    wrapper.append(control.host);
    return wrapper;
}

function renderState(item, options, fields) {
    if (!options.editMode || !item.states?.length) {
        return statePill(item);
    }
    return fields.add("System.State", createChoiceField({
        label: "State",
        value: item.state,
        options: item.states,
        onDirtyChange: fields.onDirtyChange,
    })).host;
}

function renderTemplateField(item, field, options, fields, { hideLabel = false } = {}) {
    const row = element("div", "section-field");
    const declaredFormat = String(field.format || "").toLowerCase();
    const format = declaredFormat === "markdown" || declaredFormat === "html"
        ? declaredFormat
        : field.isHtml
        ? "html"
        : "";

    if (!hideLabel) {
        row.append(element("div", "section-field-name", field.name));
    }

    // HTML fields are edited in place, preserving the markup already stored rather
    // than regenerating it: what gets saved is the original document with the
    // user's edit applied, so formatting this canvas has no toolbar for -- tables,
    // images, inline styles, mentions -- survives untouched. A field only stays
    // read-only when it holds markup that executes, which scrubbing would remove
    // and so would be an edit the user never made.
    if (options.editMode && format === "html") {
        if (canEditStoredHtml(field.value)) {
            const control = fields.add(field.field, createHtmlField({
                label: field.name,
                value: field.value,
                onDirtyChange: fields.onDirtyChange,
                onSubmit: options.onSubmit,
                onCancel: options.onCancelEdit,
            }));
            row.append(control.host);
            return row;
        }
        if (field.value) {
            row.append(richTextElement("div", "section-field-value", field.value, { format: "html" }));
        }
        row.append(readOnlyNotice(item, "This field contains markup the canvas cannot save safely."));
        return row;
    }

    if (options.editMode && format === "markdown") {
        const control = fields.add(field.field, createMarkdownField({
            label: field.name,
            value: field.value,
            onDirtyChange: fields.onDirtyChange,
            onSubmit: options.onSubmit,
            onCancel: options.onCancelEdit,
        }));
        row.append(control.host);
        return row;
    }

    if (options.editMode) {
        const control = fields.add(field.field, createPlainField({
            label: field.name,
            value: field.value,
            onDirtyChange: fields.onDirtyChange,
            onSubmit: options.onSubmit,
            onCancel: options.onCancelEdit,
        }));
        row.append(control.host);
        return row;
    }

    if (!field.value) {
        row.append(element("div", "status", "Not set."));
        return row;
    }

    row.append(richTextElement("div", "section-field-value", field.value, {
        // Plain template values retain the canvas's existing Markdown-capable
        // display. Rich fields use Azure DevOps' per-item format selection.
        format: format || "markdown",
    }));
    return row;
}

// Azure DevOps templates routinely put a single field in a group of the same
// name, so the field's own label would just repeat the heading above it.
function repeatsSectionTitle(section) {
    const fields = section.fields || [];
    return fields.length === 1 &&
        fields[0].name.trim().toLowerCase() === String(section.title).trim().toLowerCase();
}

function templateSection(item, section, options, fields, { sidebar = false } = {}) {
    const card = element(
        "section",
        `work-item-card template-section${sidebar ? " work-item-sidebar-card" : ""}`,
    );
    const collapsed = repeatsSectionTitle(section);
    const cardHeader = element("div", "work-item-card-header");
    cardHeader.append(element("h2", "work-item-card-title section-title", section.title));
    card.append(cardHeader);
    for (const field of section.fields || []) {
        card.append(renderTemplateField(item, field, options, fields, { hideLabel: collapsed }));
    }
    return card;
}

/**
 * Renders a work item, either as a read-only view or with every supported field
 * in edit mode at once.
 *
 * Edit mode is a property of the whole view rather than of one field: the user
 * turns it on once, changes whatever they like, and saves everything in a single
 * request. That matches how Azure DevOps accepts updates, so one save is one
 * atomic patch with one concurrency check.
 *
 * @param {Element} container
 * @param {object} item mapped work item detail
 * @param {{ avatarUrl?: (url: string) => string, canEdit?: boolean, editMode?: boolean, onOpenWorkItem?: (item: { id: number, project?: string }) => void, onEdit?: () => void, onCancelEdit?: () => void, onSave?: (fields: object[]) => Promise<void>, onDirtyChange?: (dirty: boolean) => void, onSubmit?: () => void }} options
 */
export function renderWorkItem(container, item, options = {}) {
    container.replaceChildren();
    const view = element("article", "work-item");
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

    const subtitle = element("div", "work-item-subtitle");
    const type = element("span", "work-item-type", item.type);
    const typeColor = cssColor(item.typeColor);
    if (typeColor) {
        type.style.setProperty("--type-color", typeColor);
        type.classList.add("has-color");
    }
    const reference = item.webUrl
        ? link(`#${item.id}`, item.webUrl, "work-item-reference")
        : element("span", "work-item-reference", `#${item.id}`);
    subtitle.append(type, reference);

    const overview = element("section", "work-item-overview");
    const header = element("header", "work-item-header");
    const headerCopy = element("div", "work-item-header-copy");
    headerCopy.append(headerRow(
        "work-item-title-row",
        renderHeading(item, options, fields),
        null,
    ), subtitle);
    header.append(headerCopy);
    const headerActions = element("div", "work-item-header-actions");
    if (options.editMode) {
        headerActions.append(actions.host);
    } else if (options.canEdit) {
        headerActions.append(editButton("this work item", () => options.onEdit?.()));
    }
    if (item.webUrl) {
        headerActions.append(secondaryLink("View on Azure DevOps", item.webUrl, "work-item-open-button"));
    }
    if (headerActions.childElementCount) {
        header.append(headerActions);
    }
    overview.append(header);
    view.append(overview);

    view.append(metadataSection(item, options.avatarUrl));

    const details = summaryDetails(item);
    if (details.length) {
        view.append(detailsSection(item, details, options, fields));
    }

    const body = element("div", "work-item-body");
    const mainColumn = element("div", "work-item-main-column");
    const primarySections = (item.templateSections || [])
        .filter((section) => (Number(section.column) || 1) === 1);
    const sidebarSections = (item.templateSections || [])
        .filter((section) => (Number(section.column) || 1) > 1);
    for (const section of primarySections) {
        mainColumn.append(templateSection(item, section, options, fields));
    }

    mainColumn.append(discussionSection(item, options));
    body.append(mainColumn);

    const developmentGroups = (item.relations || []).filter((group) => group.name === "Development");
    const relatedGroups = (item.relations || []).filter((group) => group.name !== "Development");
    const sidebar = element("aside", "work-item-sidebar");
    const development = relationsSection(
        "Development",
        developmentGroups,
        options.onOpenWorkItem,
        { development: true },
    );
    const related = relationsSection("Related work", relatedGroups, options.onOpenWorkItem);
    if (development) sidebar.append(development);
    if (related) sidebar.append(related);
    for (const section of sidebarSections) {
        sidebar.append(templateSection(item, section, options, fields, { sidebar: true }));
    }
    if (sidebar.childElementCount) {
        body.classList.add("has-sidebar");
        body.append(sidebar);
    }
    view.append(body);
    container.append(view);

    if (options.editMode) {
        queueMicrotask(() => fields.first()?.focus());
    }
}
