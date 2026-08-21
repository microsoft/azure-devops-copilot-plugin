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

const CHECK_STATES = {
    failure: {
        label: "Needs attention",
        icon: "M2.343 13.657A8 8 0 1 1 13.658 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.751.751 0 0 1-1.042.018.751.751 0 0 1-.018 1.042L6.94 8 4.97 9.97a.749.749 0 0 0 .326 1.275.749.749 0 0 0 .734-.215L8 9.06l1.97 1.97a.749.749 0 0 0 1.275-.326.749.749 0 0 0-.215-.734L9.06 8l1.97-1.97a.749.749 0 0 0-.326-1.275.749.749 0 0 0-.734.215L8 6.94Z",
    },
    pending: {
        label: "In progress",
        icon: "M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm.75-11.25a.75.75 0 0 0-1.5 0V8c0 .199.079.39.22.53l2.25 2.25a.75.75 0 1 0 1.06-1.06L8.75 7.69V4.75Z",
    },
    "not-run": {
        label: "Not run",
        icon: "M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm0-1.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13Z",
    },
    success: {
        label: "Passed",
        icon: "M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.751.751 0 0 0-.018-1.042.751.751 0 0 0-1.042-.018L6.75 9.19 5.28 7.72a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042l2 2a.75.75 0 0 0 1.06 0Z",
    },
    neutral: {
        label: "Informational",
        icon: "M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16ZM7 7v5h2V7H7Zm0-3v2h2V4H7Z",
    },
};

const POLICY_STATUS_GROUPS = {
    success: new Set(["approved", "completed", "passed", "succeeded", "success"]),
    pending: new Set(["evaluating", "inprogress", "pending", "running"]),
    // The policy API reports an untouched build validation as "queued", while
    // the ADO web UI correctly presents it as "not run" with a Queue action.
    // "running"/"inProgress" are the states that mean execution actually began.
    "not-run": new Set(["notset", "notstarted", "queued"]),
    failure: new Set(["broken", "cancelled", "canceled", "error", "failed", "failure", "rejected"]),
    neutral: new Set(["notapplicable", "skipped", "unknown"]),
};

function normalizedStatus(value) {
    return String(value || "").toLowerCase().replace(/[\s_-]/g, "");
}

export function policyState(policy) {
    const status = normalizedStatus(policy?.status);
    for (const [state, statuses] of Object.entries(POLICY_STATUS_GROUPS)) {
        if (statuses.has(status)) {
            return state;
        }
    }
    return policy?.isRequired ? "pending" : "neutral";
}

function statusIcon(state, label = CHECK_STATES[state]?.label || "Status", { decorative = false } = {}) {
    const definition = CHECK_STATES[state] || CHECK_STATES.neutral;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("check-indicator");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    if (decorative) {
        svg.setAttribute("aria-hidden", "true");
    } else {
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", label);
    }
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", definition.icon);
    svg.append(path);
    return svg;
}

function requiredReviewCheck(pr) {
    const required = (pr.reviewers || []).filter((reviewer) => reviewer.isRequired);
    if (pr.isDraft) {
        return {
            name: "Required reviews",
            state: "not-run",
            description: "Reviewers are not notified while this pull request is a draft.",
            isRequired: true,
        };
    }
    if (!required.length) {
        return {
            name: "Required reviews",
            state: "neutral",
            description: "This pull request has no required reviewers.",
            isRequired: false,
            requirement: "Not configured",
        };
    }
    const approved = required.filter((reviewer) => Number(reviewer.vote) >= 5).length;
    const blocked = required.filter((reviewer) => Number(reviewer.vote) <= -5).length;
    return {
        name: "Required reviews",
        state: blocked ? "failure" : approved === required.length ? "success" : "pending",
        description: blocked
            ? `${blocked} required reviewer${blocked === 1 ? " is" : "s are"} blocking this pull request.`
            : `${approved} of ${required.length} required reviewer${required.length === 1 ? "" : "s"} approved.`,
        isRequired: true,
    };
}

function mergeConflictCheck(pr) {
    const hasConflicts = normalizedStatus(pr.mergeStatus) === "conflicts";
    return {
        name: hasConflicts ? "Merge conflicts" : "No merge conflicts",
        state: hasConflicts ? "failure" : "success",
        description: hasConflicts
            ? "Resolve source and target branch conflicts before completing this pull request."
            : "Azure DevOps reports that the source and target branches can be merged.",
        isRequired: true,
    };
}

export function pullRequestChecks(pr) {
    return [
        ...(pr.policyEvaluations || []).map((policy) => {
            const name = policy.displayName || "Unnamed policy";
            const state = policyState(policy);
            return {
                name,
                state,
                description: policy.description || (state === "not-run" ? `${name} not run` : ""),
                isRequired: Boolean(policy.isRequired),
            };
        }),
        requiredReviewCheck(pr),
        mergeConflictCheck(pr),
    ];
}

function checkRow(check) {
    const row = element("div", `check-row check-row-${check.state}`);
    row.append(statusIcon(check.state, `${check.name}: ${CHECK_STATES[check.state]?.label || "Status"}`));
    const copy = element("div", "check-copy");
    copy.append(element("div", "check-name", check.name));
    if (check.description) {
        copy.append(element("div", "check-description", check.description));
    }
    row.append(copy);
    row.append(element(
        "span",
        "check-requirement",
        check.requirement || (check.isRequired ? "Required" : "Optional"),
    ));
    return row;
}

function checkGroup(state, checks) {
    const group = element("details", `pr-check-group pr-check-group-${state}`);
    group.open = state === "failure";
    const summary = element("summary", "pr-check-group-summary");
    summary.append(
        statusIcon(state, undefined, { decorative: true }),
        element("span", "pr-check-group-label", CHECK_STATES[state].label),
        element("span", "primer-counter", checks.length),
    );
    group.append(summary);
    const list = element("div", "check-list");
    checks.forEach((check) => list.append(checkRow(check)));
    group.append(list);
    return group;
}

function overallStatus(groups) {
    if (groups.failure.length) {
        return {
            state: "failure",
            text: `${groups.failure.length} check${groups.failure.length === 1 ? " needs" : "s need"} attention`,
        };
    }
    if (groups.pending.length) {
        return {
            state: "pending",
            text: `${groups.pending.length} check${groups.pending.length === 1 ? "" : "s"} in progress`,
        };
    }
    if (groups["not-run"].length) {
        return {
            state: "not-run",
            text: `${groups["not-run"].length} check${groups["not-run"].length === 1 ? "" : "s"} not run`,
        };
    }
    return {
        state: "success",
        text: "All required checks passed",
    };
}

function externalLink(text, href) {
    const link = element("a", "primer-link pr-checks-link", text);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", `${text} (opens in a new tab)`);
    return link;
}

export function renderPullRequestChecks(pr) {
    const checks = pullRequestChecks(pr);
    const groups = {
        failure: checks.filter((check) => check.state === "failure"),
        pending: checks.filter((check) => check.state === "pending"),
        "not-run": checks.filter((check) => check.state === "not-run"),
        success: checks.filter((check) => check.state === "success"),
        neutral: checks.filter((check) => check.state === "neutral"),
    };
    const section = element("section", "pr-checks pr-activity-card");
    const heading = element("div", "pr-section-heading");
    heading.append(element("h2", "section-title", "Checks"));
    if (pr.webUrl) {
        heading.append(externalLink("View in Azure DevOps", pr.webUrl));
    }
    section.append(heading);

    const overall = overallStatus(groups);
    const summary = element("div", `pr-check-summary pr-check-summary-${overall.state}`);
    summary.append(
        statusIcon(overall.state, overall.text, { decorative: true }),
        element("span", "pr-check-summary-text", overall.text),
        element("span", "pr-check-summary-count", `${checks.length} total`),
    );
    section.append(summary);

    const grouped = element("div", "pr-check-groups");
    for (const state of ["failure", "pending", "not-run", "success", "neutral"]) {
        if (groups[state].length) {
            grouped.append(checkGroup(state, groups[state]));
        }
    }
    section.append(grouped);
    return section;
}
