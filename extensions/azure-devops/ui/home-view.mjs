const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const OCTICONS = {
    comment: {
        viewBox: "0 0 16 16",
        paths: ["M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"],
    },
    "comment-discussion": {
        viewBox: "0 0 16 16",
        paths: ["M1.75 1h8.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 10.25 10H7.061l-2.574 2.573A1.458 1.458 0 0 1 2 11.543V10h-.25A1.75 1.75 0 0 1 0 8.25v-5.5C0 1.784.784 1 1.75 1ZM1.5 2.75v5.5c0 .138.112.25.25.25h1a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h3.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25Zm13 2a.25.25 0 0 0-.25-.25h-.5a.75.75 0 0 1 0-1.5h.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 14.25 12H14v1.543a1.458 1.458 0 0 1-2.487 1.03L9.22 12.28a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215l2.22 2.22v-2.19a.75.75 0 0 1 .75-.75h1a.25.25 0 0 0 .25-.25Z"],
    },
    "device-desktop": {
        viewBox: "0 0 16 16",
        paths: ["M14.25 1c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 14.25 12h-3.727c.099 1.041.52 1.872 1.292 2.757A.75.75 0 0 1 11.25 16h-6.5a.75.75 0 0 1-.565-1.243c.772-.885 1.192-1.716 1.292-2.757H1.75A1.75 1.75 0 0 1 0 10.25v-7.5C0 1.784.784 1 1.75 1Zm-.25 1.5H1.75a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"],
    },
    "git-pull-request": {
        viewBox: "0 0 16 16",
        paths: ["M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"],
    },
    project: {
        viewBox: "0 0 16 16",
        paths: ["M1.75 0h12.5C15.216 0 16 .784 16 1.75v12.5A1.75 1.75 0 0 1 14.25 16H1.75A1.75 1.75 0 0 1 0 14.25V1.75C0 .784.784 0 1.75 0ZM1.5 1.75v12.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25H1.75a.25.25 0 0 0-.25.25ZM11.75 3a.75.75 0 0 1 .75.75v7.5a.75.75 0 0 1-1.5 0v-7.5a.75.75 0 0 1 .75-.75Zm-8.25.75a.75.75 0 0 1 1.5 0v5.5a.75.75 0 0 1-1.5 0ZM8 3a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 3Z"],
    },
};

// These are the 16px status vectors from Microsoft's azure-devops-ui Status
// component. Keeping the vectors local avoids pulling React into this canvas.
const ADO_STATUS_ICON_DEFINITIONS = {
    Success: {
        circle: { cx: "8", cy: "8", r: "8" },
        path: "M6.062 11.144l-.003-.002-1.784-1.785A.937.937 0 1 1 5.6 8.031l1.125 1.124 3.88-3.88A.937.937 0 1 1 11.931 6.6l-4.54 4.54-.004.004a.938.938 0 0 1-1.325 0z",
        pathFill: "white",
    },
    Failed: {
        circle: { cx: "8", cy: "8", r: "8" },
        path: "M10.984 5.004a.9.9 0 0 1 0 1.272L9.27 7.99l1.74 1.741a.9.9 0 1 1-1.272 1.273l-1.74-1.741-1.742 1.74a.9.9 0 1 1-1.272-1.272l1.74-1.74-1.713-1.714a.9.9 0 0 1 1.273-1.273l1.713 1.713 1.714-1.713a.9.9 0 0 1 1.273 0z",
        pathFill: "white",
    },
    Warning: {
        circle: { cx: "8", cy: "8", r: "8" },
        path: "M8.91 3.9a.9.9 0 0 0-1.8 0v4.7a.9.9 0 1 0 1.8 0V3.9zm-.95 8.65a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8z",
        pathFill: "white",
        evenOdd: true,
    },
    Information: {
        circle: { cx: "8", cy: "8", r: "8" },
        path: "M8.91 3.9a.9.9 0 0 0-1.8 0v4.7a.9.9 0 1 0 1.8 0V3.9zm-.95 8.65a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8z",
        pathFill: "white",
        transform: "rotate(180 8 8)",
        evenOdd: true,
    },
    Running: {
        circle: { cx: "8", cy: "8", r: "8" },
        path: "M4.75 8a3.25 3.25 0 0 1 1.917-2.965c.33-.148.583-.453.583-.814 0-.479-.432-.848-.881-.683A4.752 4.752 0 0 0 3.29 8.62c.064.49.616.697 1.043.45.303-.175.443-.528.423-.877A3.304 3.304 0 0 1 4.75 8zm6.5 0c0 .065-.002.13-.006.194-.02.349.12.702.422.877.428.247.98.04 1.044-.45a4.752 4.752 0 0 0-3.078-5.084c-.45-.164-.882.205-.882.684 0 .36.253.666.583.814A3.25 3.25 0 0 1 11.25 8zM8 11.25c.758 0 1.455-.26 2.008-.694.293-.23.696-.31 1.019-.123.402.233.51.77.167 1.083A4.733 4.733 0 0 1 8 12.75c-1.23 0-2.35-.467-3.194-1.234-.344-.312-.235-.85.168-1.083.322-.186.725-.108 1.018.123.553.435 1.25.694 2.008.694z",
        pathFill: "white",
        animatedPath: true,
    },
    Waiting: {
        circle: { cx: "8", cy: "8", r: "8" },
        path: "M8 3.5a.9.9 0 0 1 .9.9v3.325l2.002 2.001A.9.9 0 1 1 9.629 11L7.408 8.778A.898.898 0 0 1 7.1 8.1V4.4a.9.9 0 0 1 .9-.9z",
        pathFill: "white",
    },
    Queued: {
        circle: { cx: "8", cy: "8", r: "7" },
        circleFill: "white",
        path: "M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm0-1.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z",
        evenOdd: true,
    },
    Canceled: {
        circle: { cx: "8", cy: "8", r: "7" },
        circleFill: "white",
        path: "M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-1.5 0a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0zM6.41 5.124a.9.9 0 1 0-1.274 1.272l4.385 4.385a.9.9 0 1 0 1.272-1.273L6.41 5.124z",
        evenOdd: true,
    },
    Abandoned: {
        viewBox: "4 4 16 16",
        circle: { cx: "12", cy: "12", r: "8" },
        circleFill: "white",
        path: "M17.657 6.343A8 8 0 1 1 6.343 17.657 8 8 0 0 1 17.657 6.343zm-1.06 1.06a6.5 6.5 0 1 1-9.193 9.193 6.5 6.5 0 0 1 9.192-9.192ZM8.84 11.092a.9.9 0 1 0 0 1.8h6.2a.9.9 0 1 0 0-1.8h-6.2Z",
        evenOdd: true,
    },
};

const PIPELINE_STATUS_PRESENTATIONS = {
    succeeded: { icon: "Success", tone: "success" },
    partiallysucceeded: { icon: "Warning", tone: "warning" },
    failed: { icon: "Failed", tone: "failed" },
    canceled: { icon: "Canceled", tone: "neutral" },
    inprogress: { icon: "Running", tone: "active", animated: true },
    notstarted: { icon: "Queued", tone: "neutral" },
    postponed: { icon: "Waiting", tone: "active" },
    cancelling: { icon: "Canceled", tone: "neutral" },
    abandoned: { icon: "Abandoned", tone: "neutral" },
    completed: { icon: "Information", tone: "neutral" },
    none: { icon: "Information", tone: "neutral" },
};

function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function octicon(name, size = 16) {
    const definition = OCTICONS[name];
    const svg = document.createElementNS(SVG_NAMESPACE, "svg");
    svg.setAttribute("data-icon-source", "octicon");
    svg.setAttribute("data-icon-name", name);
    svg.setAttribute("viewBox", definition.viewBox);
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    for (const pathData of definition.paths) {
        const path = document.createElementNS(SVG_NAMESPACE, "path");
        path.setAttribute("d", pathData);
        svg.append(path);
    }
    return svg;
}

function adoStatusIcon({ icon, tone, animated }) {
    const definition = ADO_STATUS_ICON_DEFINITIONS[icon];
    const svg = document.createElementNS(SVG_NAMESPACE, "svg");
    svg.setAttribute("data-icon-source", "azure-devops-ui");
    svg.setAttribute("data-icon-name", icon);
    svg.setAttribute("viewBox", definition.viewBox || "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("home-pipeline-status-icon", `is-${tone}`);
    if (animated) svg.classList.add("is-animated");

    const root = definition.transform
        ? document.createElementNS(SVG_NAMESPACE, "g")
        : svg;
    if (definition.transform) {
        root.setAttribute("transform", definition.transform);
        svg.append(root);
    }

    const circle = document.createElementNS(SVG_NAMESPACE, "circle");
    for (const [name, value] of Object.entries(definition.circle)) {
        circle.setAttribute(name, value);
    }
    if (definition.circleFill === "white") {
        circle.setAttribute("fill", "var(--color-white, #fff)");
    }
    root.append(circle);

    const path = document.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("d", definition.path);
    if (definition.evenOdd) {
        path.setAttribute("fill-rule", "evenodd");
        path.setAttribute("clip-rule", "evenodd");
    }
    if (definition.pathFill === "white") {
        path.setAttribute("fill", "var(--color-white, #fff)");
    }
    if (definition.animatedPath) {
        const group = document.createElementNS(SVG_NAMESPACE, "g");
        group.classList.add("home-pipeline-status-running-arcs");
        group.append(path);
        root.append(group);
    } else {
        root.append(path);
    }
    return svg;
}

function relativeTime(value) {
    const elapsed = Date.now() - Date.parse(value);
    if (!Number.isFinite(elapsed) || elapsed < 0) return "";
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
    return `${Math.floor(minutes / 1440)}d ago`;
}

function section(title, scope) {
    const card = element("section", "home-section");
    const header = element("div", "home-section-header");
    header.append(element("h3", "home-section-title", title));
    if (scope) {
        header.append(element("span", "home-section-scope", `in ${scope}`));
    }
    card.append(header);
    return card;
}

function group(title, className = "") {
    const wrapper = element("section", `home-group ${className}`.trim());
    wrapper.append(element("h2", "home-group-title", title));
    const cards = element("div", "home-card-grid");
    wrapper.append(cards);
    return { wrapper, cards };
}

function statusCard(message, error = "") {
    const card = element("div", error ? "home-section-error" : "status", message);
    if (error) card.setAttribute("role", "alert");
    return card;
}

function actionRow(...actions) {
    const row = element("div", "home-section-actions");
    row.append(...actions);
    return row;
}

function retryButton(onRetry) {
    const button = element("button", "secondary retry-button", "Retry");
    button.type = "button";
    button.addEventListener("click", onRetry);
    return button;
}

function newBranchAction(onCreateBranch) {
    const actions = element("div", "home-section-actions home-new-branch-actions");
    const button = element("button", "home-new-branch", "New branch for current session");
    button.type = "button";
    const status = element("span", "home-action-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    button.addEventListener("click", async () => {
        button.disabled = true;
        button.textContent = "Sending...";
        status.textContent = "";
        status.setAttribute("role", "status");
        try {
            await onCreateBranch();
            button.textContent = "Request sent";
            status.textContent = "Sent to chat.";
        } catch (error) {
            button.disabled = false;
            button.textContent = "New branch for current session";
            status.textContent = error?.message || "Could not send the request to chat.";
            status.setAttribute("role", "alert");
        }
    });
    actions.append(button, status);
    return actions;
}

function makeRowInteractive(row, { href, label, onClick } = {}) {
    if (!href && !onClick) return row;
    const activate = () => {
        if (onClick) {
            onClick();
        } else {
            window.open(href, "_blank", "noopener,noreferrer");
        }
    };
    const hitbox = element(onClick ? "button" : "a", "home-row-hitbox");
    if (onClick) {
        hitbox.type = "button";
        hitbox.addEventListener("click", onClick);
    } else {
        Object.assign(hitbox, { href, target: "_blank", rel: "noopener noreferrer" });
    }
    if (label) hitbox.setAttribute("aria-label", label);
    row.classList.add("home-row-interactive");
    row.append(hitbox);
    row.addEventListener("click", (event) => {
        if (event.target?.closest?.("button, a")) return;
        activate();
    });
    return row;
}

// Azure DevOps titles are plain text and display literally, so they are not
// rendered as Markdown; only bodies, comments, and system messages are.
function rowLabel(prefix, title, leadingIcon = null) {
    const node = element("span", "home-row-label");
    if (leadingIcon) {
        node.classList.add("has-leading-icon");
        const icon = element("span", "home-row-leading");
        icon.append(leadingIcon);
        node.append(icon);
    }
    node.append(element("span", "home-row-id", prefix), element("span", "home-row-title", title));
    return node;
}

function pullRequestComments(pr) {
    const total = Math.max(0, Number(pr.commentCount) || 0);
    const open = Math.max(0, Math.min(total, Number(pr.openCommentCount) || 0));
    const summary = element("span", `home-pr-comments${open ? " has-open-comments" : ""}`);
    summary.setAttribute(
        "aria-label",
        open ? `${open} open of ${total} comment threads` : `${total} resolved comment threads`,
    );
    const icon = element("span", "home-pr-comment-icon");
    icon.append(octicon(open ? "comment-discussion" : "comment"));
    summary.append(icon, element("span", "home-pr-comment-count", open ? `${open}/${total}` : total));
    return summary;
}

function delegateWorkItemAction(item, onDelegateWorkItem) {
    const action = element("div", "home-row-delegation");
    const button = element("button", "primer-button secondary home-row-delegate");
    button.type = "button";
    button.setAttribute("aria-label", `Delegate work item ${item.id}`);
    button.title = "Delegate to a local session";
    button.append(octicon("device-desktop", 14));
    const status = element("span", "home-row-action-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    button.addEventListener("click", async () => {
        button.disabled = true;
        button.classList.remove("is-complete", "is-error");
        button.setAttribute("aria-label", `Delegate work item ${item.id}`);
        button.title = "Delegate to a local session";
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        status.textContent = "";
        try {
            const result = await onDelegateWorkItem(item);
            if (result?.cancelled) {
                button.disabled = false;
                return;
            }
            if (result && !result.ok) {
                throw new Error(result.error || "Could not delegate work item.");
            }
            button.classList.add("is-complete");
            button.disabled = false;
            button.setAttribute("aria-label", `Delegation requested for work item ${item.id}`);
            button.title = "Delegation requested";
            status.textContent = "Delegation requested";
        } catch (error) {
            const message = error?.message || "Could not delegate work item.";
            button.disabled = false;
            button.classList.add("is-error");
            button.setAttribute("aria-label", `Delegate work item ${item.id}. ${message}`);
            button.title = message;
            status.setAttribute("role", "alert");
            status.setAttribute("aria-live", "assertive");
            status.textContent = message;
        }
    });
    action.append(button, status);
    return action;
}

function pullRequestRow(pr, onOpenPullRequest) {
    const row = makeRowInteractive(element("article", "home-row home-pr-row"), {
        href: onOpenPullRequest ? "" : pr.webUrl,
        label: `Open pull request !${pr.id}: ${pr.title}`,
        onClick: onOpenPullRequest ? () => onOpenPullRequest(pr.id) : null,
    });
    const meta = [
        pr.repository,
        pr.sourceRefName?.replace(/^refs\/heads\//, ""),
        relativeTime(pr.creationDate),
    ].filter(Boolean).join(" · ");
    const content = element("div", "home-row-content");
    content.append(
        rowLabel(`!${pr.id}`, pr.title, octicon("git-pull-request")),
        element("div", "home-row-meta", meta),
    );
    const side = element("div", "home-row-side");
    side.append(pullRequestComments(pr));
    row.append(content, side);
    return row;
}

function workItemRow(item, onOpenWorkItem, onDelegateWorkItem) {
    const row = makeRowInteractive(element("article", "home-row home-work-item-row"), {
        href: onOpenWorkItem ? "" : item.webUrl,
        label: `Open ${item.type || "work item"} ${item.id}: ${item.title}`,
        onClick: onOpenWorkItem ? () => onOpenWorkItem(item) : null,
    });
    // Project is shown only when the section spans more than one, which is what
    // an organization-scope connection produces.
    const meta = [item.type, item.state, item.project, item.assignedTo, relativeTime(item.changedDate)]
        .filter(Boolean).join(" · ");
    let typeIcon = null;
    if (item.typeIcon) {
        typeIcon = element("img", "home-work-item-type-icon");
        typeIcon.src = item.typeIcon;
        typeIcon.alt = "";
        typeIcon.setAttribute("data-icon-source", "azure-devops");
        typeIcon.setAttribute("data-icon-name", item.type || "work-item");
    }
    const content = element("div", "home-row-content");
    content.append(
        rowLabel(item.id, item.title, typeIcon),
        element("div", "home-row-meta", meta),
    );
    row.append(content);
    if (onDelegateWorkItem) {
        const side = element("div", "home-row-side");
        side.append(delegateWorkItemAction(item, onDelegateWorkItem));
        row.append(side);
    }
    return row;
}

function boardRow(board, onOpenBoard) {
    const row = makeRowInteractive(element("article", "home-row"), {
        href: onOpenBoard ? "" : board.url,
        label: `Open board ${board.name}`,
        onClick: onOpenBoard ? () => onOpenBoard(board) : null,
    });
    const label = rowLabel("", board.name, octicon("project"));
    label.querySelector(".home-row-leading")?.classList.add("home-row-icon");
    row.append(label);
    return row;
}

function displayState(value) {
    const normalized = String(value || "")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replaceAll("_", " ")
        .toLowerCase()
        .trim();
    return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : "";
}

function pipelineStatusPresentation(run) {
    const result = String(run.result || "").trim();
    const status = String(run.status || "").trim();
    const resultKey = result.toLowerCase();
    const value = resultKey && resultKey !== "none"
        ? result
        : status || result || "none";
    const key = value.toLowerCase();
    return {
        ...(PIPELINE_STATUS_PRESENTATIONS[key] || PIPELINE_STATUS_PRESENTATIONS.none),
        label: displayState(value),
    };
}

function pipelineRunRow(run) {
    const row = makeRowInteractive(element("article", "home-row"), {
        href: run.webUrl,
        label: `Open pipeline run ${run.id || run.pipeline || ""}`.trim(),
    });
    const status = pipelineStatusPresentation(run);
    const meta = [
        run.name,
        status.label,
        relativeTime(run.changedDate),
    ].filter(Boolean).join(" · ");
    const content = element("div", "home-row-content");
    content.append(
        rowLabel(run.id ? `#${run.id}` : "Run", run.pipeline || "Pipeline run", adoStatusIcon(status)),
        element("div", "home-row-meta", meta),
    );
    row.append(content);
    return row;
}

function renderCurrentSession(container, {
    branchPullRequest,
    branchName,
    branchScope,
    branchError,
    relatedWorkItems,
    development,
    isDefaultBranch,
    createPullRequestUrl,
    showNewBranchAction,
    onRetryBranch,
    onCreateBranch,
    onOpenPullRequest,
    onDelegateWorkItem,
    onOpenWorkItem,
}) {
    const current = group("My current session", "home-current-session");
    const branch = section("Branch", branchScope);
    if (branchName) {
        branch.append(element("code", "home-branch-name", branchName.replace(/^refs\/heads\//, "")));
    } else {
        branch.append(statusCard("No branch for this session."));
        if (showNewBranchAction && onCreateBranch) {
            branch.append(newBranchAction(onCreateBranch));
        }
    }
    current.cards.append(branch);
    if (isDefaultBranch) {
        container.append(current.wrapper);
        return;
    }

    const pullRequest = section("Pull request");
    if (branchPullRequest) {
        pullRequest.append(pullRequestRow(branchPullRequest, onOpenPullRequest));
    } else if (branchError) {
        pullRequest.append(statusCard(branchError, true));
        if (onRetryBranch) {
            pullRequest.append(actionRow(retryButton(onRetryBranch)));
        }
    } else if (!branchName) {
        pullRequest.append(statusCard("Create a branch to see its pull request."));
    } else {
        pullRequest.append(statusCard("No pull request yet for this branch."));
        if (createPullRequestUrl) {
            const create = element("a", "button-link", "Create pull request");
            Object.assign(create, { href: createPullRequestUrl, target: "_blank", rel: "noopener noreferrer" });
            pullRequest.append(actionRow(create));
        }
    }

    const related = section("Related work items", branchPullRequest ? `!${branchPullRequest.id}` : "");
    if (relatedWorkItems?.error) {
        related.append(statusCard(relatedWorkItems.error, true));
    } else if (!branchPullRequest) {
        related.append(statusCard("Related work items will appear after this session has a pull request."));
    } else if (!(relatedWorkItems?.workItems || []).length) {
        related.append(statusCard(`No work items linked to !${branchPullRequest.id}.`));
    } else {
        for (const item of relatedWorkItems.workItems) {
            related.append(workItemRow(item, onOpenWorkItem, onDelegateWorkItem));
        }
    }

    const pipelineRuns = development?.pipelineRuns || [];
    const developmentCard = section("Development");
    if (development?.error) {
        developmentCard.append(statusCard(development.error, true));
    }
    if (pipelineRuns.length) {
        for (const run of pipelineRuns) {
            developmentCard.append(pipelineRunRow(run));
        }
    } else if (!development?.error) {
        developmentCard.append(statusCard(branchPullRequest
            ? `No pipeline runs linked to work items on !${branchPullRequest.id}.`
            : "Linked pipeline runs will appear after this session has a pull request."));
    }

    current.cards.append(pullRequest, related, developmentCard);
    container.append(current.wrapper);
}

function connectionHeading(connection, { showHeading }) {
    if (!showHeading) {
        return null;
    }
    const heading = element("div", "home-connection-heading");
    heading.append(element(
        "span",
        "home-connection-name",
        [connection.organization, connection.project].filter(Boolean).join(" / "),
    ));
    if (connection.isRemote) {
        heading.append(element("span", "connection-pill", "this repository"));
    }
    if (connection.isDefault) {
        heading.append(element("span", "connection-pill", "default"));
    }
    return heading;
}

function connectionSections(connection, {
    onOpenBoard,
    onOpenPullRequest,
    onDelegateWorkItem,
    onOpenWorkItem,
    onChooseProject,
    showHeading,
}) {
    const wrapper = element("div", "home-connection");
    const heading = connectionHeading(connection, { showHeading });
    if (heading) {
        wrapper.append(heading);
    }

    const myPullRequests = connection.myPullRequests || {};
    const pullRequestScope = myPullRequests.scope || connection.project || "";
    const pullRequests = section("Active pull requests", pullRequestScope);
    if (connection.requiresProject) {
        if (onChooseProject) {
            const choose = element("button", "secondary", "Choose a project");
            choose.type = "button";
            choose.addEventListener("click", () => onChooseProject(connection));
            pullRequests.append(actionRow(choose));
        }
    } else if (myPullRequests.error) {
        pullRequests.append(statusCard(myPullRequests.error, true));
    } else if (!(myPullRequests.pullRequests || []).length) {
        pullRequests.append(statusCard(`No active pull requests in ${pullRequestScope || "this repository"}.`));
    } else {
        for (const pr of myPullRequests.pullRequests) {
            pullRequests.append(pullRequestRow(pr, (id) => onOpenPullRequest(id, connection)));
        }
    }

    const myBoards = connection.myBoards || {};
    const boardScope = myBoards.scope || connection.project || "";
    const boards = section("My boards", boardScope);
    if (connection.requiresProject) {
        boards.append(statusCard("Choose a project to see your favorite boards."));
        if (onChooseProject) {
            const choose = element("button", "secondary", "Choose a project");
            choose.type = "button";
            choose.addEventListener("click", () => onChooseProject(connection));
            boards.append(actionRow(choose));
        }
    } else if (myBoards.error) {
        boards.append(statusCard(myBoards.error, true));
    } else if (!(myBoards.boards || []).length) {
        const otherProjectBoardCount = Number(myBoards.otherProjectBoardCount || 0);
        const otherProjects = otherProjectBoardCount
            ? ` ${otherProjectBoardCount} favorite ${otherProjectBoardCount === 1 ? "board is" : "boards are"} in other projects.`
            : "";
        boards.append(statusCard(`No favorite boards in ${boardScope || "this project"}.${otherProjects}`));
        if (otherProjectBoardCount && onChooseProject) {
            const choose = element("button", "secondary", "Choose another project");
            choose.type = "button";
            choose.addEventListener("click", () => onChooseProject(connection));
            boards.append(actionRow(choose));
        }
    } else {
        for (const board of myBoards.boards) {
            boards.append(boardRow(
                board,
                onOpenBoard ? (selected) => onOpenBoard(selected, connection) : null,
            ));
        }
    }

    const myWorkItems = connection.myWorkItems || {};
    const workItemScope = myWorkItems.scope || connection.project || connection.organization || "";
    const workItems = section("Open work items", workItemScope);
    if (myWorkItems.error) {
        workItems.append(statusCard(myWorkItems.error, true));
    } else if (!(myWorkItems.workItems || []).length) {
        workItems.append(statusCard(`No open work items assigned to you in ${workItemScope || "this project"}.`));
    } else {
        for (const item of myWorkItems.workItems) {
            workItems.append(workItemRow(
                item,
                (workItem) => onOpenWorkItem(workItem, connection),
                onDelegateWorkItem ? (workItem) => onDelegateWorkItem(workItem, connection) : null,
            ));
        }
    }

    wrapper.append(pullRequests, ...(onOpenBoard ? [boards] : []), workItems);
    return wrapper;
}

function renderActiveWork(container, data, options) {
    const active = group("My active work", "home-active-work");
    const connections = data.connections || [];
    const showHeading = connections.length > 1;
    for (const connection of connections) {
        active.cards.append(connectionSections(connection, { ...options, showHeading }));
    }
    container.append(active.wrapper);
}

export function renderHome(container, data, options) {
    container.replaceChildren();
    if (options.hasRemoteConnection) {
        renderCurrentSession(container, options);
    }
    renderActiveWork(container, data, options);
}
