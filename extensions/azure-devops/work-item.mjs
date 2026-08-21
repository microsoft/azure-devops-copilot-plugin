import {
    hasRenderableContent,
    normalizeMultilineFieldFormat,
    normalizeRichText,
    normalizeString,
} from "./common.mjs";

function fieldValue(workItem, name) {
    const value = workItem?.fields?.[name];
    return value && typeof value === "object" && "displayName" in value ? value.displayName : value ?? "";
}

function personValue(workItem, name) {
    const value = workItem?.fields?.[name];
    return value && typeof value === "object"
        ? { name: normalizeString(value.displayName), imageUrl: normalizeString(value.imageUrl) }
        : { name: normalizeString(value), imageUrl: "" };
}

// Fields shown in the details grid, in display order. Anything absent is skipped.
const DETAIL_FIELDS = [
    ["System.State", "State"],
    ["System.Reason", "Reason"],
    ["System.AreaPath", "Area"],
    ["System.IterationPath", "Iteration"],
];

const RELATION_GROUPS = [
    ["System.LinkTypes.Hierarchy-Reverse", "Parent"],
    ["System.LinkTypes.Hierarchy-Forward", "Children"],
    ["System.LinkTypes.Related", "Related"],
    ["System.LinkTypes.Duplicate-Forward", "Duplicates"],
    ["System.LinkTypes.Duplicate-Reverse", "Duplicated by"],
    ["System.LinkTypes.Dependency-Forward", "Successors"],
    ["System.LinkTypes.Dependency-Reverse", "Predecessors"],
    ["Microsoft.VSTS.Common.Affects-Forward", "Affects"],
    ["Microsoft.VSTS.Common.Affects-Reverse", "Affected by"],
    ["ArtifactLink", "Development"],
    ["Hyperlink", "Links"],
    ["AttachedFile", "Attachments"],
];

// Template fields kept even when empty, so a work item that is missing one can
// have it filled in from the canvas. Every other empty field stays hidden: work
// item templates carry dozens of fields and showing them all as blank rows would
// bury the ones that matter.
const ALWAYS_EDITABLE_FIELDS = new Set([
    "System.Description",
    "Microsoft.VSTS.TCM.ReproSteps",
    "Microsoft.VSTS.Common.AcceptanceCriteria",
]);

// Rendered by the header, meta row, or details grid, so template sections skip them.
const SUMMARIZED_FIELDS = new Set([
    "System.Title",
    "System.Tags",
    "System.AssignedTo",
    "System.CreatedBy",
    "System.CreatedDate",
    "System.ChangedBy",
    "System.ChangedDate",
    ...DETAIL_FIELDS.map(([name]) => name),
]);

function displayFieldName(name) {
    const knownNames = {
        "System.Description": "Description",
        "Microsoft.VSTS.TCM.ReproSteps": "Repro steps",
    };
    if (knownNames[name]) {
        return knownNames[name];
    }
    return name
        .split(".")
        .at(-1)
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replaceAll("_", " ");
}

function normalizeFieldValue(value) {
    if (typeof value === "string") {
        return hasRenderableContent(value) ? normalizeRichText(value) : "";
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (value && typeof value === "object" && typeof value.displayName === "string") {
        return value.displayName;
    }
    return "";
}

function timestampValue(value) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function multilineFieldFormats(workItem) {
    return new Map(
        Object.entries(workItem?.multilineFieldsFormat || {})
            .map(([name, value]) => [
                normalizeString(name).toLowerCase(),
                normalizeMultilineFieldFormat(value),
            ])
            .filter(([name, format]) => name && format),
    );
}

function xmlAttributes(source) {
    return Object.fromEntries(
        [...source.matchAll(/([A-Za-z]+)="([^"]*)"/g)].map(([, name, value]) => [
            name,
            value.replace(
                /&(?:#(\d+)|#x([0-9a-f]+)|(amp|apos|gt|lt|quot));/gi,
                (entity, decimal, hexadecimal, named) => {
                    if (named) {
                        return {
                            amp: "&",
                            apos: "'",
                            gt: ">",
                            lt: "<",
                            quot: '"',
                        }[named.toLowerCase()];
                    }
                    const codePoint = Number.parseInt(decimal || hexadecimal, decimal ? 10 : 16);
                    return Number.isInteger(codePoint) &&
                        codePoint >= 0 &&
                        codePoint <= 0x10ffff &&
                        !(codePoint >= 0xd800 && codePoint <= 0xdfff)
                        ? String.fromCodePoint(codePoint)
                        : entity;
                },
            ),
        ]),
    );
}

function templateLabel(value, stripMnemonics = false) {
    const label = normalizeString(value);
    if (!stripMnemonics) {
        return label;
    }
    let result = "";
    for (let index = 0; index < label.length; index += 1) {
        if (label[index] !== "&") {
            result += label[index];
            continue;
        }
        if (label[index + 1] === "&") {
            result += "&";
            index += 1;
            continue;
        }
        if (!label[index + 1] || /\s/.test(label[index + 1])) {
            result += "&";
        }
    }
    return result;
}

function xmlElementTree(source) {
    const root = { name: "", attributes: {}, children: [] };
    const stack = [root];
    let order = 0;
    const tags = String(source ?? "").matchAll(
        /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?([A-Za-z][\w:.-]*)\b[^>]*>/g,
    );
    for (const match of tags) {
        const token = match[0];
        const qualifiedName = match[1];
        if (!qualifiedName) {
            continue;
        }
        const name = qualifiedName.split(":").at(-1).toLowerCase();
        if (token.startsWith("</")) {
            const index = stack.findLastIndex((element) => element.name === name);
            if (index > 0) {
                stack.length = index;
            }
            continue;
        }
        const node = { name, attributes: xmlAttributes(token), children: [], order };
        order += 1;
        stack.at(-1).children.push(node);
        if (!/\/\s*>$/.test(token)) {
            stack.push(node);
        }
    }
    return root;
}

function templateControl(node, stripMnemonics) {
    if (node.name !== "control") {
        return null;
    }
    const control = node.attributes;
    if (
        (control.Type !== "FieldControl" && control.Type !== "HtmlFieldControl") ||
        !control.FieldName
    ) {
        return null;
    }
    return {
        name: control.FieldName,
        label: templateLabel(control.Label, stripMnemonics) || displayFieldName(control.FieldName),
        order: node.order,
        // The control type is the authoritative signal for whether the field
        // holds HTML. Guessing from the value fails on empty fields.
        isHtml: control.Type === "HtmlFieldControl",
    };
}

function groupControls(group, stripMnemonics) {
    const controls = [];
    const visit = (node) => {
        for (const child of node.children) {
            // A labelled nested group is its own card. Do not copy its fields into
            // the enclosing section as well.
            if (child.name === "group" && templateLabel(child.attributes.Label, stripMnemonics)) {
                continue;
            }
            const control = templateControl(child, stripMnemonics);
            if (control) {
                controls.push(control);
            }
            visit(child);
        }
    };
    visit(group);
    return controls;
}

export function parseWorkItemTemplate(xmlForm) {
    const tree = xmlElementTree(xmlForm);
    const form = tree.children.find((child) => child.name === "form") || tree;
    // Hosted forms often carry the current WebLayout beside a legacy desktop
    // Layout. Azure DevOps renders only the WebLayout in the browser; flattening
    // both repeats the same controls and exposes legacy mnemonic labels.
    const layout =
        form.children.find((child) => child.name === "weblayout") ||
        form.children.find((child) => child.name === "layout") ||
        form;
    const stripMnemonics = layout.name === "layout";
    const sections = [];
    const visit = (node, column = 1, columnResolved = false) => {
        // Hosted/inherited processes expose three WebLayout <Section> elements;
        // older XML process templates expose sibling <Column> elements. Legacy
        // forms may then subdivide the right side again, so only the first
        // multi-column level in a branch determines its visual column.
        const columns = node.children.filter((child) =>
            child.name === "column" || child.name === "section");
        const resolvesColumn = !columnResolved && columns.length > 1;
        for (const child of node.children) {
            const isColumn = columns.includes(child);
            const childColumn = resolvesColumn && isColumn
                ? columns.indexOf(child) + 1
                : column;
            const childColumnResolved = columnResolved || (resolvesColumn && isColumn);
            if (child.name === "group") {
                const title = templateLabel(child.attributes.Label, stripMnemonics);
                const fields = title ? groupControls(child, stripMnemonics) : [];
                if (fields.length) {
                    sections.push({ title, column: childColumn, fields });
                }
            }
            visit(child, childColumn, childColumnResolved);
        }
    };
    visit(layout);
    const firstFieldOrders = new Map();
    for (const section of sections) {
        for (const field of section.fields) {
            const key = field.name.toLowerCase();
            const firstOrder = firstFieldOrders.get(key);
            if (firstOrder === undefined || field.order < firstOrder) {
                firstFieldOrders.set(key, field.order);
            }
        }
    }
    return sections
        .map((section) => ({
            ...section,
            fields: section.fields
                .filter((field) => firstFieldOrders.get(field.name.toLowerCase()) === field.order)
                .map(({ order, ...field }) => field),
        }))
        .filter((section) => section.fields.length);
}

export function parseWorkItemUrl(workItemUrl) {
    const rawUrl = normalizeString(workItemUrl);
    if (!rawUrl) {
        return null;
    }
    try {
        const url = new URL(rawUrl);
        const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
        const workItemsIndex = segments.findIndex((segment) => segment.toLowerCase() === "_workitems");
        const editIndex = segments.findIndex((segment) => segment.toLowerCase() === "edit");
        const id = Number(segments[editIndex + 1]);
        if (workItemsIndex < 1 || editIndex < 0 || !Number.isInteger(id) || id <= 0) {
            return null;
        }

        if (url.hostname.toLowerCase() === "dev.azure.com") {
            return {
                organization: segments[0],
                project: segments[workItemsIndex - 1],
                id,
            };
        }
        if (url.hostname.toLowerCase().endsWith(".visualstudio.com")) {
            return {
                organization: url.hostname.slice(0, -".visualstudio.com".length),
                project: segments[workItemsIndex - 1],
                id,
            };
        }
    } catch {
        return null;
    }
    return null;
}

export function hasWorkItemReference(input = {}) {
    return Boolean(normalizeString(input.workItemUrl)) ||
        Boolean(
            normalizeString(input.organization || input.org) &&
            normalizeString(input.project) &&
            (input.workItemId ?? input.id) !== undefined,
        );
}

// The project is optional here, unlike in hasWorkItemReference: a canvas input
// that names a work item must still name its project, but a work item reached
// from an organization-scope list has only an organization and an id. The server
// reads the project off the item in that case.
export function resolveWorkItemReference(input = {}) {
    const fromUrl = parseWorkItemUrl(input.workItemUrl);
    const organization = normalizeString(input.organization || input.org) || fromUrl?.organization || "";
    const project = normalizeString(input.project) || fromUrl?.project || "";
    const id = Number(input.workItemId ?? input.id ?? fromUrl?.id);
    return organization && Number.isInteger(id) && id > 0
        ? { organization, project, id }
        : null;
}

// Azure DevOps relation targets are REST URLs; the trailing segment is the id.
export function relatedWorkItemId(url) {
    const match = /\/_apis\/wit\/workitems\/(\d+)(?:[?#].*)?$/i.exec(normalizeString(url));
    return match ? Number(match[1]) : 0;
}

export function relatedWorkItemIds(workItem) {
    return [...new Set((workItem?.relations || [])
        .map((relation) => relatedWorkItemId(relation.url))
        .filter(Boolean))];
}

function relationGroupName(rel) {
    const known = RELATION_GROUPS.find(([name]) => name === rel);
    if (known) {
        return known[1];
    }
    return displayFieldName(normalizeString(rel).replace(/-(Forward|Reverse)$/i, "")) || "Links";
}

// Relation URLs are user-supplied, so a malformed percent sequence must not throw.
function safeDecode(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

// Artifact links use vstfs: URIs, e.g. vstfs:///Git/PullRequestId/{project}%2F{repo}%2F{id}.
function artifactReference(url) {
    const match = /^vstfs:\/{3}([^/]+)\/([^/]+)\/(.+)$/i.exec(normalizeString(url));
    if (!match) {
        return null;
    }
    const area = match[1].toLowerCase();
    const type = match[2].toLowerCase();
    const parts = safeDecode(match[3]).split("/");
    if (area === "git" && parts.length >= 3) {
        const [projectId, repositoryId, ...identifierParts] = parts;
        const rawIdentifier = identifierParts.join("/");
        if (type === "pullrequestid") {
            return {
                kind: "pull-request",
                kindLabel: "Pull request",
                projectId,
                repositoryId,
                identifier: rawIdentifier,
                label: `Pull request ${rawIdentifier}`,
            };
        }
        if (type === "commit") {
            return {
                kind: "commit",
                kindLabel: "Commit",
                projectId,
                repositoryId,
                identifier: rawIdentifier,
                label: `Commit ${rawIdentifier.slice(0, 8)}`,
            };
        }
        if (type === "ref") {
            const isTag = rawIdentifier.startsWith("GT");
            const version = /^(?:GB|GT)/.test(rawIdentifier)
                ? rawIdentifier
                : `${isTag ? "GT" : "GB"}${rawIdentifier}`;
            const identifier = version.slice(2).replace(/^refs\/(?:heads|tags)\//, "");
            return {
                kind: isTag ? "tag" : "branch",
                kindLabel: isTag ? "Tag" : "Branch",
                projectId,
                repositoryId,
                identifier,
                version,
                label: identifier || (isTag ? "Tag" : "Branch"),
            };
        }
    }
    if (area === "build" && type === "build") {
        const identifier = parts.at(-1) || "";
        return {
            kind: "build",
            kindLabel: "Build",
            identifier,
            label: identifier ? `Build ${identifier}` : "Build",
        };
    }
    const kindLabel = match[2]
        .replace(/Id$/i, "")
        .replace(/([a-z])([A-Z])/g, "$1 $2");
    const identifier = parts.at(-1) || "";
    return {
        kind: "artifact",
        kindLabel,
        identifier,
        label: identifier ? `${kindLabel} ${identifier}` : kindLabel,
    };
}

function projectRoot(projectWebUrl, projectId) {
    try {
        const url = new URL(normalizeString(projectWebUrl));
        const hostname = url.hostname.toLowerCase();
        const segments = url.pathname.split("/").filter(Boolean).map(safeDecode);
        if (url.protocol !== "https:") {
            return "";
        }
        if (hostname === "dev.azure.com" && segments[0]) {
            const project = projectId || segments[1];
            return project
                ? `${url.origin}/${encodeURIComponent(segments[0])}/${encodeURIComponent(project)}`
                : "";
        }
        if (hostname.endsWith(".visualstudio.com")) {
            const project = projectId || segments[0];
            return project ? `${url.origin}/${encodeURIComponent(project)}` : "";
        }
    } catch {
        return "";
    }
    return "";
}

function artifactWebUrl(reference, projectWebUrl) {
    if (!reference) {
        return "";
    }
    const root = projectRoot(projectWebUrl, reference.projectId);
    if (!root) {
        return "";
    }
    if (reference.kind === "build" && reference.identifier) {
        const url = new URL(`${root}/_build/results`);
        url.searchParams.set("buildId", reference.identifier);
        url.searchParams.set("view", "results");
        return url.href;
    }
    if (!reference.repositoryId || !reference.identifier) {
        return "";
    }
    const repositoryRoot = `${root}/_git/${encodeURIComponent(reference.repositoryId)}`;
    if (reference.kind === "pull-request") {
        return `${repositoryRoot}/pullrequest/${encodeURIComponent(reference.identifier)}`;
    }
    if (reference.kind === "commit") {
        return `${repositoryRoot}/commit/${encodeURIComponent(reference.identifier)}`;
    }
    if (reference.kind === "branch" || reference.kind === "tag") {
        const url = new URL(repositoryRoot);
        url.searchParams.set("version", reference.version);
        return url.href;
    }
    return "";
}

function externalLabel(relation) {
    const url = normalizeString(relation.url);
    const name = normalizeString(relation.attributes?.name);
    const comment = normalizeString(relation.attributes?.comment);
    const artifact = artifactReference(url);
    if (artifact) {
        return artifact.label;
    }
    if (name && name !== "Hyperlink") {
        return name;
    }
    if (comment) {
        return comment;
    }
    try {
        return new URL(url).hostname || "";
    } catch {
        return "";
    }
}

function mapRelation(relation, relatedById, projectWebUrl) {
    const url = normalizeString(relation.url);
    const id = relatedWorkItemId(url);
    const related = id ? relatedById.get(id) : null;
    if (id) {
        return {
            id,
            label: related ? `${related.type} ${id}` : `Work item ${id}`,
            title: related?.title || "",
            state: related?.state || "",
            changedDate: related?.changedDate || "",
            project: related?.project || "",
            kind: "work-item",
            kindLabel: related?.type || "Work item",
            webUrl: related?.webUrl || "",
        };
    }
    const artifact = artifactReference(url);
    const label = externalLabel(relation);
    const comment = normalizeString(relation.attributes?.comment);
    return {
        id: 0,
        label,
        title: comment === label ? "" : comment,
        state: "",
        changedDate: "",
        kind: artifact?.kind || (relation.rel === "Hyperlink" ? "link" : "artifact"),
        kindLabel: artifact?.kindLabel || normalizeString(relation.attributes?.name) || "Link",
        identifier: artifact?.identifier || "",
        webUrl: artifactWebUrl(artifact, projectWebUrl) || (/^https?:\/\//i.test(url) ? url : ""),
    };
}

function mapRelations(workItem, relatedById, projectWebUrl) {
    const groups = new Map();
    for (const relation of workItem?.relations || []) {
        const name = relationGroupName(relation.rel);
        const entry = mapRelation(relation, relatedById, projectWebUrl);
        // A link with no work item, no destination, and no label is noise.
        if (!entry.id && !entry.webUrl && !entry.label) {
            continue;
        }
        groups.set(name, [...(groups.get(name) || []), entry]);
    }
    return RELATION_GROUPS
        .map(([, name]) => name)
        .concat([...groups.keys()])
        .filter((name, index, names) => names.indexOf(name) === index && groups.has(name))
        .map((name) => ({ name, links: groups.get(name) }));
}

export function mapWorkItemDevelopment(workItem, projectWebUrl = "") {
    return mapRelations(workItem, new Map(), projectWebUrl)
        .find((group) => group.name === "Development")?.links || [];
}

export function mapWorkItem(workItem, typeDefinition = null) {
    return {
        id: workItem.id,
        // Carried so a caller that reads a work item can send the revision back
        // with an update, which is required for the concurrency check.
        rev: Number(workItem.rev) || 0,
        url: workItem.url,
        type: fieldValue(workItem, "System.WorkItemType"),
        typeColor: normalizeString(typeDefinition?.color),
        typeIconUrl: normalizeString(typeDefinition?.icon?.url),
        title: fieldValue(workItem, "System.Title"),
        state: fieldValue(workItem, "System.State"),
        // The organization-scope query spans projects, so a row has to say which
        // one it came from and a detail request has to be able to scope itself.
        project: fieldValue(workItem, "System.TeamProject"),
        assignedTo: fieldValue(workItem, "System.AssignedTo"),
        changedDate: fieldValue(workItem, "System.ChangedDate"),
        webUrl: normalizeString(workItem?._links?.html?.href),
    };
}

export function mapWorkItemDetail(workItem, comments = [], template = [], options = {}) {
    const { typeDefinition = null, relatedById = new Map(), projectWebUrl = "" } = options;
    const fields = workItem?.fields || {};
    const selectedFormats = multilineFieldFormats(workItem);
    const assignedTo = personValue(workItem, "System.AssignedTo");
    const createdBy = personValue(workItem, "System.CreatedBy");
    const changedBy = personValue(workItem, "System.ChangedBy");
    const tags = normalizeString(fieldValue(workItem, "System.Tags"))
        .split(";")
        .map((tag) => tag.trim())
        .filter(Boolean);
    const templateSections = template
        .map((section) => {
            const sectionFields = section.fields
                // Fields already shown in the header or details grid would only repeat here.
                .filter((field) => !SUMMARIZED_FIELDS.has(field.name))
                .map((field) => {
                    const value = normalizeFieldValue(fields[field.name]);
                    const selectedFormat = selectedFormats.get(field.name.toLowerCase()) || "";
                    // HtmlFieldControl means "large rich-text field", not that this
                    // particular work item still stores the field as HTML. Azure
                    // DevOps can irreversibly convert any such field to Markdown.
                    const isRichText = Boolean(field.isHtml || selectedFormat);
                    const format = selectedFormat || (field.isHtml ? "html" : "");
                    // The reference name travels with the field so the canvas can
                    // PATCH it; the label alone is not addressable.
                    return value || ALWAYS_EDITABLE_FIELDS.has(field.name)
                        ? {
                            name: field.label,
                            field: field.name,
                            isRichText,
                            isHtml: isRichText && format === "html",
                            format,
                            value,
                        }
                        : null;
                })
                .filter(Boolean);
            return sectionFields.length
                ? { title: section.title, column: Number(section.column) || 1, fields: sectionFields }
                : null;
        })
        .filter(Boolean);
    const discussion = (comments || [])
        .map((comment) => {
            const renderedText = hasRenderableContent(comment.renderedText)
                ? normalizeRichText(comment.renderedText)
                : "";
            const text = renderedText || (
                hasRenderableContent(comment.text) ? normalizeRichText(comment.text) : ""
            );
            const reportedFormat = normalizeString(comment.format).toLowerCase();
            return {
                id: comment.id ?? comment.commentId,
                author: normalizeString(comment.createdBy?.displayName) || "Unknown",
                authorImageUrl: normalizeString(
                    comment.createdBy?._links?.avatar?.href || comment.createdBy?.imageUrl,
                ),
                createdDate: comment.createdDate || "",
                text,
                // Asking Azure DevOps for renderedText gives the exact HTML it
                // shows for a Markdown comment, including resolved @mentions.
                // Legacy responses without it retain their reported storage format.
                format: renderedText
                    ? "html"
                    : reportedFormat === "html"
                    ? "html"
                    : "markdown",
            };
        })
        .filter((comment) => comment.text)
        .sort((left, right) => timestampValue(right.createdDate) - timestampValue(left.createdDate));
    const commentCount = Number(fieldValue(workItem, "System.CommentCount"));
    const state = normalizeString(fieldValue(workItem, "System.State"));
    const stateDefinition = (typeDefinition?.states || [])
        .find((entry) => normalizeString(entry.name).toLowerCase() === state.toLowerCase());
    const details = DETAIL_FIELDS
        .map(([name, label]) => ({ name: label, value: normalizeFieldValue(fields[name]) }))
        .filter((detail) => detail.value);
    return {
        id: workItem.id,
        // Azure DevOps revision number. Sent back as a test operation on save so a
        // stale canvas cannot overwrite an edit made elsewhere in the meantime.
        rev: Number(workItem.rev) || 0,
        type: normalizeString(fieldValue(workItem, "System.WorkItemType")) || "Work Item",
        typeColor: normalizeString(typeDefinition?.color),
        typeIconUrl: normalizeString(typeDefinition?.icon?.url),
        title: normalizeString(fieldValue(workItem, "System.Title")),
        assignedTo: assignedTo.name || "Unassigned",
        assignedToImageUrl: assignedTo.imageUrl,
        commentCount: Number.isFinite(commentCount) ? commentCount : discussion.length,
        tags,
        state,
        stateColor: normalizeString(stateDefinition?.color),
        stateCategory: normalizeString(stateDefinition?.category),
        // Drives the state picker. Hidden states are not offered because Azure
        // DevOps rejects a transition into them.
        states: (typeDefinition?.states || [])
            .filter((entry) => !entry.hidden)
            .map((entry) => normalizeString(entry.name))
            .filter(Boolean),
        area: normalizeString(fieldValue(workItem, "System.AreaPath")),
        reason: normalizeString(fieldValue(workItem, "System.Reason")),
        iteration: normalizeString(fieldValue(workItem, "System.IterationPath")),
        project: normalizeString(fieldValue(workItem, "System.TeamProject")),
        createdBy: createdBy.name,
        createdByImageUrl: createdBy.imageUrl,
        createdDate: normalizeString(fieldValue(workItem, "System.CreatedDate")),
        changedBy: changedBy.name,
        changedByImageUrl: changedBy.imageUrl,
        changedDate: normalizeString(fieldValue(workItem, "System.ChangedDate")),
        details,
        relations: mapRelations(workItem, relatedById, projectWebUrl),
        templateSections,
        discussion,
        webUrl: normalizeString(workItem?._links?.html?.href),
    };
}
