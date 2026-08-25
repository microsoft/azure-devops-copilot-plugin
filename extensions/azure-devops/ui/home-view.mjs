function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
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

// Azure DevOps titles are plain text and display literally, so they are not
// rendered as Markdown; only bodies, comments, and system messages are.
function rowLink(prefix, title, { href, onClick } = {}) {
    let node;
    if (onClick) {
        node = element("button", "home-row-link");
        node.type = "button";
        node.addEventListener("click", onClick);
    } else if (href) {
        node = element("a", "home-row-link");
        Object.assign(node, { href, target: "_blank", rel: "noopener noreferrer" });
    } else {
        node = element("span", "home-row-link");
    }
    node.append(
        element("span", "home-row-id", prefix),
        element("span", "home-row-title", title),
    );
    return node;
}

function pullRequestRow(pr, onOpenPullRequest) {
    const row = element("article", "home-row");
    const meta = [
        pr.repository,
        pr.sourceRefName?.replace(/^refs\/heads\//, ""),
        relativeTime(pr.creationDate),
    ].filter(Boolean).join(" · ");
    row.append(
        rowLink(`!${pr.id}`, pr.title, onOpenPullRequest
            ? { onClick: () => onOpenPullRequest(pr.id) }
            : { href: pr.webUrl }),
        element("div", "home-row-meta", meta),
    );
    return row;
}

function workItemRow(item, onOpenWorkItem) {
    const row = element("article", "home-row");
    // Project is shown only when the section spans more than one, which is what
    // an organization-scope connection produces.
    const meta = [item.type, item.state, item.project, item.assignedTo, relativeTime(item.changedDate)]
        .filter(Boolean).join(" · ");
    row.append(
        rowLink(item.id, item.title, onOpenWorkItem
            ? { onClick: () => onOpenWorkItem(item) }
            : { href: item.webUrl }),
        element("div", "home-row-meta", meta),
    );
    return row;
}

function displayState(value) {
    const normalized = String(value || "")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replaceAll("_", " ")
        .trim();
    return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : "";
}

function pipelineRunRow(run) {
    const row = element("article", "home-row");
    const meta = [
        run.name,
        displayState(run.status),
        relativeTime(run.changedDate),
    ].filter(Boolean).join(" · ");
    row.append(
        rowLink(run.id ? `#${run.id}` : "Run", run.pipeline || "Pipeline run", { href: run.webUrl }),
        element("div", "home-row-meta", meta),
    );
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
            related.append(workItemRow(item, onOpenWorkItem));
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
    onOpenPullRequest,
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

    const myWorkItems = connection.myWorkItems || {};
    const workItemScope = myWorkItems.scope || connection.project || connection.organization || "";
    const workItems = section("Open work items", workItemScope);
    if (myWorkItems.error) {
        workItems.append(statusCard(myWorkItems.error, true));
    } else if (!(myWorkItems.workItems || []).length) {
        workItems.append(statusCard(`No open work items assigned to you in ${workItemScope || "this project"}.`));
    } else {
        for (const item of myWorkItems.workItems) {
            workItems.append(workItemRow(item, (workItem) => onOpenWorkItem(workItem, connection)));
        }
    }

    wrapper.append(pullRequests, workItems);
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
