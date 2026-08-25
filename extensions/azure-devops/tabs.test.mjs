import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PULL_REQUEST_REVIEW_VOTING_ENABLED } from "./ui/feature-flags.mjs";
import { workItemTypeColor } from "./ui/pull-request-actions.mjs";

// These extensions ship without node_modules, so jsdom is not guaranteed to be
// present. Skip rather than fail when it is missing, and run with:
//   npm install jsdom && node --test tabs.test.mjs
let JSDOM;
try {
    ({ JSDOM } = await import("jsdom"));
} catch {
    JSDOM = null;
}
const describeDom = { skip: JSDOM ? false : "jsdom is not installed" };

const html = readFileSync(new URL("./ui/index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("./ui/styles.css", import.meta.url), "utf8");

// Drives the real app.mjs against a real DOM through the same controls a user
// clicks. Nothing is exported from the app for testing.
function makePullRequest(state, id) {
    return {
        id,
        title: `PR ${id}`,
        status: state.prStatus || "active",
        isDraft: Boolean(state.prDraft),
        webUrl: `https://dev.azure.com/example/project/_git/repo/pullrequest/${id}`,
        sourceRefName: "refs/heads/feature",
        targetRefName: "refs/heads/main",
        description: state.prDescription || "",
        threads: [],
        commentThreads: state.commentThreads || [],
        creationDate: state.creationDate || "",
        createdBy: state.prCreatedBy || "Avery Anderson",
        reviewers: state.reviewers || [],
        policyEvaluations: state.policyEvaluations || [],
        mergeStatus: state.mergeStatus || "succeeded",
        currentUser: state.currentUser === undefined ? { id: "me", displayName: "Me" } : state.currentUser,
        commits: [],
        workItems: [],
    };
}

function makeFetch(state) {
    const connection = {
        source: "remote",
        organization: state.organization || "example",
        project: state.project === undefined ? "project" : state.project,
        repositoryId: "repo",
        isDefault: false,
        isRemote: true,
        requiresProject: state.project === "",
    };
    return async (url, options = {}) => {
        const path = String(url);
        const json = (body) => ({ ok: true, json: async () => body });
        if (path.includes("/api/config")) {
            const response = json({
                apiNonce: "n",
                authProcess: state.configAuthProcess || null,
                config: {
                    auth: state.configAuth || {
                        isAuthenticated: !state.configAuthProcess,
                        authType: state.configAuthProcess ? "none" : "azureauth",
                        azureAuthDiscovery: { selected: "x" },
                    },
                    remote: state.remote === undefined
                        ? { isAzureDevOps: state.isAzureDevOps !== false }
                        : state.remote,
                    connections: state.connections === undefined ? [connection] : state.connections,
                    hasDefaultConnection: Boolean(state.hasDefaultConnection),
                    branch: state.branch || "",
                    project: "Project",
                    repositoryId: "repo-id",
                    pullRequestReference: Boolean(state.pullRequestReference),
                    workItemReference: Boolean(state.workItemReference),
                    azureDevOpsMcpAvailable: Boolean(state.azureDevOpsMcpAvailable),
                    extensionVersion: "test",
                },
            });
            return state.holdConfig ? state.holdConfig.then(() => response) : response;
        }
        if (path.includes("/api/auth/status")) {
            state.authStatusRequests = (state.authStatusRequests || 0) + 1;
            const response = json(state.authStatus || {
                authProcess: { provider: "azureauth", mode: "silent", status: "succeeded", output: "Authenticated with AzureAuth." },
                auth: { isAuthenticated: true, authType: "azureauth", azureAuthDiscovery: { selected: "x" } },
            });
            return state.holdAuthStatus ? state.holdAuthStatus.then(() => response) : response;
        }
        if (path.includes("/api/current-pull-request")) {
            return json({
                pullRequest: state.leadPr || null,
                sourceRefName: `refs/heads/${state.branch || "feature"}`,
                canCreatePullRequest: false,
                isDefaultBranch: Boolean(state.defaultBranch),
                repository: { name: "repo" },
                relatedWorkItems: {
                    workItems: (state.relatedWorkItems || []).map((id) => ({
                        id,
                        title: `WI ${id}`,
                        type: "Task",
                        state: "Active",
                    })),
                    error: state.relatedWorkItemsError || "",
                },
                development: {
                    pipelineRuns: state.pipelineRuns || [],
                    error: state.pipelineRunsError || "",
                },
            });
        }
        if (path.includes("/api/current-work-item")) {
            state.currentWorkItemCalls = (state.currentWorkItemCalls || 0) + 1;
            return json({ workItem: { id: 900, type: "Bug", title: "Referenced item", relations: state.relations || [] } });
        }
        if (path.includes("/api/organizations")) {
            return json({ organizations: (state.organizations || []).map((name) => ({ name, id: name })), error: "" });
        }
        if (path.includes("/api/projects")) {
            return json({ projects: (state.projects || []).map((name) => ({ name, id: name })) });
        }
        if (path.includes("/api/repositories")) {
            return json({ repositories: (state.repositories || []).map((name) => ({ name, id: name })) });
        }
        if (path.includes("/api/connection")) {
            state.savedConnections = [...(state.savedConnections || []), options.body ? JSON.parse(options.body) : { method: options.method }];
            if (state.connectionSaveError) {
                return { ok: false, json: async () => ({ error: "azure_devops_connection_write_failed", message: state.connectionSaveError }) };
            }
            state.connections = [{ ...connection, source: "default", isRemote: false, isDefault: true }];
            return json({ connections: state.connections });
        }
        if (path.includes("/api/home")) {
            state.homeRequests = (state.homeRequests || 0) + 1;
            const response = json({
                connections: (state.homeConnections || [connection]).map((entry) => ({
                    ...entry,
                    myPullRequests: { pullRequests: (entry.prs || state.homePrs || []).map((id) => ({ id, title: `PR ${id}`, status: "active", creationDate: new Date().toISOString() })) },
                    // An organization-scope list spans projects, so a row may carry
                    // one of its own; entries are either a bare id or [id, project].
                    myWorkItems: { workItems: (entry.workItems || state.homeWorkItems || []).map((entryId) => {
                        const [id, project] = Array.isArray(entryId) ? entryId : [entryId, ""];
                        return { id, title: `WI ${id}`, type: "Task", state: "Active", project };
                    }) },
                })),
            });
            return state.holdHome ? state.holdHome.then(() => response) : response;
        }
        if (path.includes("/api/fix-comment")) {
            state.fixRequests = [...(state.fixRequests || []), JSON.parse(options.body)];
            return json({ queued: true });
        }
        if (path.includes("/api/new-session-branch")) {
            state.newBranchRequests = (state.newBranchRequests || 0) + 1;
            return json({ queued: true });
        }
        if (path.includes("/api/work-item-search")) {
            state.workItemSearches = [...(state.workItemSearches || []), path];
            return json({
                workItems: (state.searchWorkItems || []).map((id) => ({
                    id, title: `WI ${id}`, type: "Task", state: "Active",
                })),
                error: state.workItemSearchError || "",
            });
        }
        if (path.includes("/api/identities")) {
            state.identityQueries = [...(state.identityQueries || []), path];
            return json({ identities: state.identities || [], error: state.identityError || "" });
        }
        const prThreadAction = path.match(/\/api\/pull-requests\/(\d+)\/threads\/(\d+)(\/comments)?/);
        if (prThreadAction) {
            state.prActions = [...(state.prActions || []), {
                id: Number(prThreadAction[1]),
                action: `threads/${prThreadAction[2]}${prThreadAction[3] || ""}`,
                method: options.method,
                body: options.body ? JSON.parse(options.body) : {},
            }];
            if (state.prActionError) {
                return { ok: false, json: async () => ({ error: "azure_devops_request_failed", message: state.prActionError }) };
            }
            Object.assign(state, state.afterAction || {});
            return json({ pullRequest: makePullRequest(state, Number(prThreadAction[1])) });
        }
        const prAction = path.match(/\/api\/pull-requests\/(\d+)\/([a-z-]+(?:\/[a-z-]+)?)/);
        if (prAction) {
            state.prActions = [...(state.prActions || []), {
                id: Number(prAction[1]),
                action: prAction[2],
                method: options.method,
                body: options.body ? JSON.parse(options.body) : {},
            }];
            if (state.prActionError) {
                return { ok: false, json: async () => ({ error: "azure_devops_request_failed", message: state.prActionError }) };
            }
            Object.assign(state, state.afterAction || {});
            return json({
                pullRequest: makePullRequest(state, Number(prAction[1])),
                relatedWorkItems: {
                    workItems: (state.prWorkItems || []).map((id) => ({ id, title: `WI ${id}`, type: "Task", state: "Active" })),
                    error: "",
                },
            });
        }
        const pr = path.match(/\/api\/pull-requests\/(\d+)/);
        if (pr) {
            const id = Number(pr[1]);
            state.pullRequestRequests = [...(state.pullRequestRequests || []), path];
            if (state.pullRequestError) {
                return {
                    ok: false,
                    json: async () => ({
                        error: "azure_devops_request_failed",
                        message: state.pullRequestError,
                    }),
                };
            }
            const body = json({
                pullRequest: makePullRequest(state, id),
                relatedWorkItems: {
                    workItems: (state.prWorkItems || []).map((workItemId) => ({
                        id: workItemId,
                        title: `WI ${workItemId}`,
                        type: "Task",
                        state: "Active",
                    })),
                    error: state.prWorkItemsError || "",
                },
            });
            const gate = state.hold?.[id];
            return gate ? gate.then(() => body) : body;
        }
        const wiComment = path.match(/\/api\/work-items\/(\d+)\/comments/);
        if (wiComment) {
            state.workItemComments = [...(state.workItemComments || []), {
                id: Number(wiComment[1]),
                method: options.method,
                body: options.body ? JSON.parse(options.body) : {},
            }];
            if (state.workItemCommentError) {
                return { ok: false, json: async () => ({ error: "azure_devops_request_failed", message: state.workItemCommentError }) };
            }
            return json({
                workItem: {
                    id: Number(wiComment[1]),
                    type: "Task",
                    title: `WI ${wiComment[1]}`,
                    commentCount: 1,
                    discussion: [{ id: 1, author: "Me", text: JSON.parse(options.body).content, format: "markdown" }],
                    relations: state.relations || [],
                },
            });
        }
        const wi = path.match(/\/api\/work-items\/(\d+)\/details/);
        if (wi) {
            const id = Number(wi[1]);
            state.workItemRequests = [...(state.workItemRequests || []), path];
            const response = json({
                workItem: {
                    id,
                    type: "Task",
                    title: `WI ${wi[1]}`,
                    commentCount: 0,
                    discussion: [],
                    relations: state.relations || [],
                },
            });
            const gate = state.holdWorkItems?.[id];
            return gate ? gate.then(() => response) : response;
        }
        throw new Error(`unexpected fetch: ${path}`);
    };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

async function boot(state = {}) {
    const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true });
    const { window } = dom;
    // app.mjs calls the bare global fetch, and Node's rejects relative URLs.
    const fetchImpl = makeFetch(state);
    window.fetch = fetchImpl;
    globalThis.fetch = fetchImpl;
    state.scrolls = [];
    window.scrollTo = (_x, y) => { state.scrolls.push(y); };
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.Headers = window.Headers;
    globalThis.Node = window.Node;
    globalThis.DOMParser = window.DOMParser;
    Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });

    await import(new URL(`./ui/app.mjs?v=${Math.random()}`, import.meta.url).href);
    await settle();
    return { window, state };
}

const bar = (w) => w.document.getElementById("viewTabs");
const tabEls = (w) => [...bar(w).querySelectorAll(".view-tab")];
const titles = (w) => tabEls(w).map((el) => el.querySelector(".view-tab-label").textContent);
const activeTitle = (w) => bar(w).querySelector(".view-tab.active .view-tab-label")?.textContent;
const visiblePanels = (w) => [...w.document.querySelectorAll("#homePanel, .tab-panel")].filter((p) => !p.hidden);
const marks = (w) => tabEls(w).map((el) => Boolean(el.querySelector(".view-tab-branch")));

async function openFromHome(w, label) {
    const link = [...w.document.querySelectorAll("#homeContent .home-row-link")]
        .find((node) => node.querySelector(".home-row-id")?.textContent === String(label));
    assert.ok(link, `no Home row for ${label}`);
    link.click();
    await settle();
}

async function clickTab(w, index) {
    tabEls(w)[index].querySelector(".view-tab-label").click();
    await settle();
}

async function closeTab(w, index) {
    const close = tabEls(w)[index].querySelector(".view-tab-close");
    assert.ok(close, `tab ${index} has no close control`);
    close.click();
    await settle();
}

test("startup paints a smooth loading spinner before configuration resolves", describeDom, async () => {
    const config = deferred();
    const { window } = await boot({ holdConfig: config.promise });

    const startup = window.document.getElementById("startupSplash");
    assert.equal(startup.hidden, false);
    assert.equal(startup.getAttribute("aria-busy"), "true");
    assert.equal(window.document.getElementById("startupTitle").textContent, "Preparing Azure DevOps");
    assert.ok(startup.querySelector(".loading-spinner-large .loading-spinner-svg"));
    assert.ok(startup.querySelector(".loading-spinner-track"));
    assert.ok(startup.querySelector(".loading-spinner-arc"));
    assert.equal(window.document.getElementById("signInSplash").hidden, true);
    assert.equal(window.document.getElementById("canvasContent").hidden, true);
    assert.match(styles, /@keyframes loading-spinner-rotate/);
    assert.match(styles, /@keyframes loading-spinner-dash/);
    assert.match(styles, /prefers-reduced-motion:\s*reduce/);

    config.resolve();
    await settle();
});

test("silent AzureAuth has a truthful animated startup state without flashing sign-in", describeDom, async () => {
    const auth = deferred();
    const { window, state } = await boot({
        configAuthProcess: {
            provider: "azureauth",
            mode: "silent",
            status: "running",
            output: "Authenticating with AzureAuth.",
        },
        holdAuthStatus: auth.promise,
    });

    assert.equal(window.document.getElementById("startupTitle").textContent, "Signing in");
    assert.equal(window.document.getElementById("startupDetail").textContent, "Restoring the Azure DevOps session.");
    assert.ok(window.document.querySelector("#startupSplash .loading-spinner-svg"));
    assert.equal(window.document.getElementById("signInSplash").hidden, true);
    assert.equal(window.document.getElementById("canvasContent").hidden, true);
    assert.equal(state.authStatusRequests, 1);

    auth.resolve();
    await settle();
    assert.equal(window.document.getElementById("startupSplash").hidden, true);
    assert.equal(window.document.getElementById("signInSplash").hidden, true);
    assert.equal(window.document.getElementById("canvasContent").hidden, false);
    assert.deepEqual(titles(window), ["Home"]);
});

test("failed silent AzureAuth ends at the sign-in chooser", describeDom, async () => {
    const { window } = await boot({
        configAuthProcess: {
            provider: "azureauth",
            mode: "silent",
            status: "running",
            output: "Authenticating with AzureAuth.",
        },
        authStatus: {
            authProcess: {
                provider: "azureauth",
                mode: "silent",
                status: "failed",
                output: "Automatic AzureAuth sign-in was unavailable.",
            },
            auth: {
                isAuthenticated: false,
                authType: "none",
                azureAuthDiscovery: { selected: "x" },
            },
        },
    });

    assert.equal(window.document.getElementById("startupSplash").hidden, true);
    assert.equal(window.document.getElementById("signInSplash").hidden, false);
    assert.equal(window.document.getElementById("canvasContent").hidden, true);
    assert.equal(window.document.getElementById("signInAgencyButton").hidden, false);
    assert.equal(
        window.document.getElementById("signInAgencyButton").textContent,
        "Agency (AzureAuth)",
    );
    assert.doesNotMatch(
        window.document.getElementById("authOutput").textContent,
        /canvas|azureauth|saved connection state/i,
    );

    window.document.getElementById("signInMicrosoftButton").click();
    assert.equal(
        window.document.getElementById("authOutput").textContent,
        "Complete sign-in in the browser, then return here.",
    );
    assert.doesNotMatch(
        window.document.getElementById("authOutput").textContent,
        /provider|status|canvas|azureauth|saved connection state|\byou(?:r|'re)?\b/i,
    );
});

test("Home starts as the visible, stable first tab", describeDom, async () => {
    const { window } = await boot();
    assert.deepEqual(titles(window), ["Home"]);
    assert.equal(bar(window).hidden, false);
    assert.equal(visiblePanels(window).length, 1);
});

test("Home shows animated progress for exactly as long as its data is unresolved", describeDom, async () => {
    const home = deferred();
    const { window } = await boot({ holdHome: home.promise });

    const loading = window.document.querySelector(".home-loading-state");
    assert.ok(loading);
    assert.equal(loading.getAttribute("aria-busy"), "true");
    assert.equal(loading.querySelector(".loading-title")?.textContent, "Loading your Azure DevOps work");
    assert.equal(loading.querySelector(".loading-detail")?.textContent, "Fetching pull requests and work items.");
    assert.ok(loading.querySelector(".loading-spinner-large .loading-spinner-svg"));

    home.resolve();
    await settle();
    assert.equal(window.document.querySelector(".home-loading-state"), null);
    assert.ok(window.document.querySelector(".home-active-work"));
});

test("Home remains visible with a saved connection and no Azure DevOps remote", describeDom, async () => {
    const { window } = await boot({ isAzureDevOps: false });
    assert.deepEqual(titles(window), ["Home"]);
    assert.equal(bar(window).hidden, false);
    assert.equal(window.document.querySelector(".home-current-session"), null);
    assert.equal(window.document.querySelector(".home-active-work .home-group-title")?.textContent, "My active work");
});

test("Home without a session branch shows assigned work and can ask chat to create one", describeDom, async () => {
    const { window, state } = await boot({ homePrs: [101], homeWorkItems: [400] });
    assert.equal(window.document.querySelector(".home-title"), null);
    assert.deepEqual(
        [...window.document.querySelectorAll(".home-group-title")].map((node) => node.textContent),
        ["My current session", "My active work"],
    );
    assert.deepEqual(
        [...window.document.querySelectorAll(".home-section-title")].map((node) => node.textContent),
        ["Branch", "Pull request", "Related work items", "Development", "Active pull requests", "Open work items"],
    );
    const button = window.document.querySelector(".home-new-branch");
    assert.equal(button?.textContent, "New branch for current session");

    button.click();
    await settle();

    assert.equal(state.newBranchRequests, 1);
    assert.equal(button.textContent, "Request sent");
    assert.equal(window.document.querySelector(".home-action-status")?.textContent, "Sent to chat.");
    assert.equal(state.homeRequests, 1);
});

test("Home separates current session cards from active work", describeDom, async () => {
    const { window, state } = await boot({
        branch: "feature",
        leadPr: { id: 101, title: "Branch PR" },
        relatedWorkItems: [400],
        pipelineRuns: [{
            id: 700,
            pipeline: "Canvas CI",
            name: "20260810.7",
            status: "succeeded",
            changedDate: new Date().toISOString(),
            webUrl: "https://dev.azure.com/example/Project/_build/results?buildId=700",
        }],
        homePrs: [102],
        homeWorkItems: [401],
    });
    assert.equal(window.document.querySelector(".home-title"), null);
    assert.deepEqual(
        [...window.document.querySelectorAll(".home-group-title")].map((node) => node.textContent),
        ["My current session", "My active work"],
    );
    assert.deepEqual(
        [...window.document.querySelectorAll(".home-section-title")].map((node) => node.textContent),
        ["Branch", "Pull request", "Related work items", "Development", "Active pull requests", "Open work items"],
    );
    assert.equal(window.document.querySelector(".home-branch-name")?.textContent, "feature");
    assert.deepEqual(
        [...window.document.querySelectorAll(".home-row-id")].map((node) => node.textContent),
        ["!101", "400", "#700", "!102", "401"],
    );
    assert.equal(window.document.querySelector(".home-new-branch"), null);
    assert.equal(state.homeRequests, 1);
});

test("Home shows only the Branch card for the default branch", describeDom, async () => {
    const { window } = await boot({
        branch: "main",
        defaultBranch: true,
        homePrs: [102],
        homeWorkItems: [401],
    });
    assert.deepEqual(
        [...window.document.querySelectorAll(".home-current-session .home-section-title")]
            .map((node) => node.textContent),
        ["Branch"],
    );
    assert.deepEqual(
        [...window.document.querySelectorAll(".home-active-work .home-section-title")]
            .map((node) => node.textContent),
        ["Active pull requests", "Open work items"],
    );
    assert.equal(window.document.querySelector(".home-branch-name")?.textContent, "main");
});

test("several pull requests open as separate tabs", describeDom, async () => {
    const { window } = await boot({ homePrs: [101, 102, 103] });
    await openFromHome(window, "!101");
    await clickTab(window, 0);
    await openFromHome(window, "!102");
    await clickTab(window, 0);
    await openFromHome(window, "!103");

    assert.deepEqual(titles(window), ["Home", "PR !101", "PR !102", "PR !103"], "each pull request gets its own tab");
    assert.equal(activeTitle(window), "PR !103", "the newest tab takes focus");
    assert.equal(bar(window).hidden, false);
    assert.equal(visiblePanels(window).length, 1, "exactly one panel is visible at a time");
});

test("pull request loading preserves the final page structure with labeled skeletons", describeDom, async () => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const { window } = await boot({ homePrs: [101], hold: { 101: held } });

    await openFromHome(window, "!101");
    const skeleton = window.document.querySelector(".pr-skeleton");
    assert.ok(skeleton);
    assert.equal(skeleton.getAttribute("aria-busy"), "true");
    assert.equal(skeleton.querySelector(".loading-title")?.textContent, "Loading pull request !101");
    assert.ok(skeleton.querySelector(".loading-spinner-compact .loading-spinner-svg"));
    assert.ok(skeleton.querySelector(".pr-skeleton-layout"));
    assert.ok(skeleton.querySelectorAll(".loading-skeleton-card").length >= 4);

    release();
    await settle();
    assert.equal(window.document.querySelector(".pr-skeleton"), null);
    assert.ok(window.document.querySelector(".pr-summary"));
});

test("work item loading uses animated progress and a stable detail skeleton", describeDom, async () => {
    const workItem = deferred();
    const { window } = await boot({
        homeWorkItems: [401],
        holdWorkItems: { 401: workItem.promise },
    });

    await openFromHome(window, "401");
    const skeleton = window.document.querySelector(".work-item-skeleton");
    assert.ok(skeleton);
    assert.equal(skeleton.getAttribute("aria-busy"), "true");
    assert.equal(skeleton.querySelector(".loading-title")?.textContent, "Loading work item 401");
    assert.ok(skeleton.querySelector(".loading-spinner-compact .loading-spinner-svg"));
    assert.ok(skeleton.querySelector(".work-item-skeleton-layout"));
    assert.ok(skeleton.querySelectorAll(".loading-skeleton-card").length >= 6);

    workItem.resolve();
    await settle();
    assert.equal(window.document.querySelector(".work-item-skeleton"), null);
    assert.ok(window.document.querySelector(".work-item"));
});

test("pull request load failures explain the problem and expose a retry", describeDom, async () => {
    const { window } = await boot({ homePrs: [101], pullRequestError: "The project is temporarily unavailable." });
    await openFromHome(window, "!101");

    const state = window.document.querySelector(".pr-error-state");
    assert.equal(state?.getAttribute("role"), "alert");
    assert.equal(state?.querySelector(".pr-load-state-title")?.textContent, "Pull request could not load");
    assert.equal(state?.querySelector(".pr-load-state-message")?.textContent, "The project is temporarily unavailable.");
    assert.equal(state?.querySelector(".retry-button")?.textContent, "Retry");
});

test("pull request comments use a Primer ActionMenu filter", describeDom, async () => {
    const { window } = await boot({ homePrs: [101] });
    await openFromHome(window, "!101");

    const actionMenu = window.document.querySelector(".timeline-filter-control");
    const trigger = actionMenu?.querySelector(".primer-action-menu-trigger");
    assert.equal(window.document.querySelector(".timeline-header .discussion-title")?.textContent, "Activity");
    assert.equal(window.document.querySelector(".timeline-header .primer-counter")?.textContent, "0");
    assert.equal(actionMenu?.dataset.component, "ActionMenu");
    assert.equal(trigger?.dataset.component, "ActionMenu.Button");
    assert.ok(trigger?.classList.contains("primer-button"));
    assert.equal(trigger?.getAttribute("aria-label"), "Filter comments: All");
    assert.equal(trigger?.textContent, "All (0)");
    assert.equal(window.document.querySelector(".timeline-filter-select"), null);
    assert.equal(window.document.querySelector(".timeline-filter-label"), null);
    assert.equal(actionMenu?.querySelector(".primer-action-menu-overlay")?.dataset.component, "ActionMenu.Overlay");
    assert.equal(actionMenu?.querySelector(".primer-action-list")?.dataset.component, "ActionList");
    assert.doesNotMatch(styles, /\.timeline-filters\s*\{[^}]*border-bottom/);
    assert.match(styles, /button\.primer-action-list-button:focus-visible\s*\{[^}]*--color-focus-outline/);
    assert.match(styles, /button\.primer-action-list-button\[aria-checked="true"\]\s*\{[^}]*--background-color-control-transparent-selected/);
    assert.match(styles, /button\.primer-action-list-button\[aria-checked="true"\]::before\s*\{[^}]*--background-color-accent-emphasis/);
    assert.equal(window.document.querySelector(".pr-status")?.textContent, "Active");
    assert.ok(window.document.querySelector(".pr-status")?.classList.contains("pr-status-info"));
    assert.equal(window.document.querySelector(".pr-status-icon"), null);
    assert.equal(window.document.querySelector(".pr-checks .section-title")?.textContent, "Checks");
    assert.equal(window.document.querySelector(".check-bubble"), null);
    assert.equal(window.document.querySelector(".check-indicator")?.tagName.toLowerCase(), "svg");
    assert.ok(window.document.querySelector(".pr-checks-link")?.classList.contains("primer-link"));
    assert.ok(window.document.querySelector(".pr-branch")?.classList.contains("primer-link"));
    assert.deepEqual(
        [...actionMenu.querySelectorAll(".primer-action-list-button")].map((item) => item.dataset.filter),
        ["all", "comments", "mine", "active", "resolved"],
    );
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    trigger.click();
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    assert.equal(actionMenu.querySelector(".primer-action-menu-overlay").hidden, false);
    window.document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(actionMenu.querySelector(".primer-action-menu-overlay").hidden, true);
    trigger.click();
    actionMenu.querySelector('[data-filter="active"]').click();
    await settle();
    assert.equal(
        window.document.querySelector(".timeline-filter-control .primer-action-menu-trigger")?.textContent,
        "Active comments (0)",
    );
});

test("pull request checks prioritize failures and keep ADO policy semantics", describeDom, async () => {
    const { window } = await boot({
        homePrs: [101],
        reviewers: [{ id: "r1", displayName: "Required Person", vote: 10, isRequired: true }],
        policyEvaluations: [
            { displayName: "Build validation", status: "rejected", description: "The build failed.", isRequired: true },
            { displayName: "Security scan", status: "running", description: "Scanning changed files.", isRequired: true },
            { displayName: "Deployment gate", status: "queued", isRequired: true },
            { displayName: "Manual validation", status: "notSet", description: "Use Queue in Azure DevOps to run this policy.", isRequired: true },
            { displayName: "Work item linking", status: "approved", isRequired: false },
            { displayName: "Experimental policy", status: "skipped", isRequired: false },
        ],
    });
    await openFromHome(window, "!101");

    const groups = [...window.document.querySelectorAll(".pr-check-group")];
    assert.deepEqual(
        groups.map((group) => group.className.split(" ").at(-1)),
        [
            "pr-check-group-failure",
            "pr-check-group-pending",
            "pr-check-group-not-run",
            "pr-check-group-success",
            "pr-check-group-neutral",
        ],
        "each ADO policy state is labeled precisely instead of treating unstarted checks as running",
    );
    assert.equal(groups[0].open, true);
    assert.ok(groups.slice(1).every((group) => !group.open), "every non-failure group starts collapsed");
    assert.equal(
        window.document.querySelector(".pr-check-group-not-run .pr-check-group-label")?.textContent,
        "Not run",
    );
    assert.deepEqual(
        [...window.document.querySelectorAll(".pr-check-group-not-run .check-name")].map((node) => node.textContent),
        ["Deployment gate", "Manual validation"],
        "ADO's raw queued status remains in the not-run bucket until execution begins",
    );
    assert.equal(
        window.document.querySelector(".pr-check-group-not-run .check-description")?.textContent,
        "Deployment gate not run",
    );
    assert.equal(window.document.querySelector(".pr-check-summary-text")?.textContent, "1 check needs attention");
    assert.equal(
        window.document.querySelector(".pr-check-group-failure .check-name")?.textContent,
        "Build validation",
    );
    const icon = window.document.querySelector(".pr-check-group-success .check-indicator");
    assert.equal(icon?.tagName.toLowerCase(), "svg", "ADO policy state uses a circled status icon");
    assert.equal(icon?.getAttribute("viewBox"), "0 0 16 16");
    assert.ok(icon?.querySelector("path")?.getAttribute("d"), "the icon is a real path, not a decorative color block");
});

test("ADO queued build evaluations are presented as not run until execution begins", describeDom, async () => {
    const { window } = await boot({
        homePrs: [101],
        reviewers: [{ id: "r1", displayName: "Required Person", vote: 10, isRequired: true }],
        policyEvaluations: [
            { displayName: "Client Validation", status: "queued", isRequired: true },
        ],
    });
    await openFromHome(window, "!101");

    assert.equal(window.document.querySelector(".pr-check-group-queued"), null);
    const group = window.document.querySelector(".pr-check-group-not-run");
    assert.equal(group?.open, false);
    assert.equal(group?.querySelector(".check-name")?.textContent, "Client Validation");
    assert.equal(group?.querySelector(".check-description")?.textContent, "Client Validation not run");
    assert.equal(window.document.querySelector(".pr-check-summary-text")?.textContent, "1 check not run");
});

test("a pull request comment draft survives timeline filter changes", describeDom, async () => {
    const { window } = await boot({ homePrs: [101] });
    await openFromHome(window, "!101");
    const body = window.document.querySelector(".timeline > .comment-composer .comment-composer-body");
    body.textContent = "Do not lose this draft";
    body.dispatchEvent(new window.Event("input", { bubbles: true }));

    const menu = window.document.querySelector(".timeline-filter-control");
    menu.querySelector(".primer-action-menu-trigger").click();
    menu.querySelector('[data-filter="active"]').click();
    await settle();

    assert.equal(
        window.document.querySelector(".timeline > .comment-composer .comment-composer-body").textContent,
        "Do not lose this draft",
    );
});

test("pull request status uses Azure DevOps semantic status mappings", describeDom, async () => {
    for (const [status, label, tone] of [
        ["active", "Active", "info"],
        ["completed", "Completed", "success"],
        ["abandoned", "Abandoned", "neutral"],
    ]) {
        const { window } = await boot({ homePrs: [101], prStatus: status });
        await openFromHome(window, "!101");
        const badge = window.document.querySelector(".pr-status");
        assert.ok(
            badge?.classList.contains(`pr-status-${tone}`),
            `${status} uses the ${tone} status token`,
        );
        assert.equal(badge?.textContent, label);
        assert.equal(badge?.querySelector("svg"), null);
        window.close();
    }
    assert.match(styles, /\.pr-status-info\s*\{[^}]*--pr-status-text-color: var\(--text-color-default/);
    assert.match(styles, /\.pr-status-info\s*\{[^}]*--pr-status-background-color: var\(--true-color-blue-muted/);
    assert.match(styles, /\.pr-status-info\s*\{[^}]*--pr-status-border-color: var\(--true-color-blue/);
    assert.match(styles, /\.pr-status-success\s*\{[^}]*--text-color-success/);
    assert.match(styles, /\.pr-status-success\s*\{[^}]*--background-color-success-muted/);
    assert.match(styles, /\.pr-status-neutral\s*\{[^}]*--background-color-neutral-muted/);
    assert.doesNotMatch(styles, /--component-status-info/);
    assert.match(styles, /\.pr-status\s*\{[^}]*color: var\(--pr-status-text-color/);
    assert.match(styles, /\.pr-status\s*\{[^}]*line-height: 20px/);
    assert.match(styles, /\.pr-status\s*\{[^}]*display: inline-block[^}]*vertical-align: baseline/);
});

test("the pull request header gives the merge summary a full row below title actions", describeDom, async () => {
    const { window } = await boot({ homePrs: [101] });
    await openFromHome(window, "!101");
    const header = window.document.querySelector(".pr-header");
    const copy = header?.querySelector(".pr-header-copy");
    const titleRow = copy?.querySelector(".pr-title-row");
    assert.equal(header?.firstElementChild, copy);
    assert.equal(copy?.firstElementChild, titleRow);
    assert.equal(titleRow?.firstElementChild?.className, "pr-title");
    assert.equal(header?.lastElementChild?.className, "pr-merge-summary", "the merge summary spans the row below the title and actions");
    assert.deepEqual(
        [...header.querySelector(".pr-merge-summary").children].map((node) => node.className),
        ["pr-identity-summary", "pr-branch-flow"],
        "metadata and branch flow wrap as deliberate groups",
    );
    assert.ok(header.querySelector(".pr-identity-summary .pr-proposal"));
    assert.equal(header.querySelectorAll(".pr-branch-flow .pr-branch").length, 2);
    assert.equal(window.document.querySelector(".pr-open-button"), null, "the external link moved into the actions menu");
    assert.match(styles, /\.pr-title \{[^}]*font-size: var\(--text-title-large, 24px\)/);
    assert.equal(window.document.querySelector(".pr-description-header")?.textContent, "Description");
    assert.equal(window.document.querySelector(".pr-description-author"), null);
    assert.equal(window.document.querySelector(".pr-description-metadata"), null);
    const viewInAdo = window.document.querySelector('.pr-state-control [data-action="view-in-ado"]');
    assert.equal(viewInAdo?.textContent, "View pull request in Azure DevOps");
    assert.match(styles, /\.pr-title\s*\{[^}]*font-size: var\(--text-title-medium/);
    assert.match(styles, /@container \(max-width: 520px\)/);
    assert.match(styles, /@container \(max-width: 520px\)[\s\S]*?\.pr-proposal \{ flex-basis: 100%; \}/);
    assert.match(styles, /@container \(max-width: 520px\)[\s\S]*?\.pr-branch-flow \{ flex-wrap: nowrap; \}/);
    assert.match(styles, /\.pr-header \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto/);
    assert.match(styles, /\.pr-merge-summary \{[^}]*grid-column: 1 \/ -1/);
});

test("code comment threads use one file header and send the root comment for fixing", describeDom, async () => {
    const publishedDate = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    const authorImageUrl = "https://dev.azure.com/example/_api/_common/identityImage?id=123";
    const { window, state } = await boot({
        homePrs: [101],
        commentThreads: [{
            id: 1,
            status: "active",
            isResolvable: true,
            updatedDate: publishedDate,
            filePath: "/.github/workflows/azure-blob-previews.yml",
            fileName: "azure-blob-previews.yml",
            lineNumber: 108,
            target: [],
            source: [
                { lineNumber: 106, text: "steps:", isSelected: false },
                { lineNumber: 107, text: "  - script: build-preview", isSelected: false },
                { lineNumber: 108, text: "# Keep content-hashed assets from earlier PR builds until the PR closes.", isSelected: true },
                { lineNumber: 109, text: "  - script: publish-preview", isSelected: false },
                { lineNumber: 110, text: "    condition: succeeded()", isSelected: false },
            ],
            diff: [
                { type: "context", lineNumber: 106, text: "steps:", isSelected: false },
                { type: "context", lineNumber: 107, text: "  - script: build-preview", isSelected: false },
                { type: "deletion", lineNumber: 108, text: "# Remove previews after each build.", isSelected: false },
                { type: "addition", lineNumber: 108, text: "# Keep content-hashed assets from earlier PR builds until the PR closes.", isSelected: true },
                { type: "context", lineNumber: 109, text: "  - script: publish-preview", isSelected: false },
                { type: "context", lineNumber: 110, text: "    condition: succeeded()", isSelected: false },
            ],
            comments: [
                { id: 1, author: "Build Service", publishedDate, text: "System update.", isSystem: true, webUrl: "https://dev.azure.com/example/comments/1" },
                { id: 2, author: "Ada Lovelace", authorImageUrl, publishedDate, text: "Please update this.", webUrl: "https://dev.azure.com/example/comments/2" },
                { id: 3, author: "Grace Hopper", publishedDate, text: "Please also update this.", webUrl: "https://dev.azure.com/example/comments/3" },
                { id: 4, author: "Build Service", publishedDate, text: "System update.", isSystem: true, webUrl: "https://dev.azure.com/example/comments/4" },
            ],
        }],
    });
    await openFromHome(window, "!101");
    assert.deepEqual(
        [...window.document.querySelectorAll(".comment-header-meta")].map((node) => node.textContent),
        ["Build Service · 7h ago", "Ada Lovelace · 7h ago", "Grace Hopper · 7h ago", "Build Service · 7h ago"],
    );
    assert.equal(window.document.querySelectorAll(".comment-header").length, 1, "a code thread has one gray file header");
    assert.equal(
        window.document.querySelector(".comment-file-reference")?.textContent,
        ".github/workflows/azure-blob-previews.yml:L108",
    );
    assert.equal(window.document.querySelector(".comment-header .comment-header-author"), null);
    assert.equal(window.document.querySelectorAll(".comment-byline").length, 4);
    assert.ok([...window.document.querySelectorAll(".comment-post")].every((post) => !post.querySelector(".comment-header")));
    const diffRow = window.document.querySelector(".comment-diff-row");
    assert.ok(diffRow?.classList.contains("context"));
    assert.equal(diffRow?.querySelector(".comment-diff-line-number")?.textContent, "106");
    assert.equal(diffRow?.querySelector(".comment-diff-sign")?.textContent, "");
    const selectedDiffRow = window.document.querySelector(".comment-diff-row.addition");
    assert.equal(selectedDiffRow?.querySelector(".comment-diff-line-number")?.textContent, "108");
    assert.equal(selectedDiffRow?.querySelector(".comment-diff-sign")?.textContent, "+");
    assert.equal(selectedDiffRow?.querySelector(".comment-diff-code")?.textContent, "# Keep content-hashed assets from earlier PR builds until the PR closes.");
    const deletedDiffRow = window.document.querySelector(".comment-diff-row.deletion");
    assert.equal(deletedDiffRow?.querySelector(".comment-diff-sign")?.textContent, "-");
    assert.equal(deletedDiffRow?.querySelector(".comment-diff-code")?.textContent, "# Remove previews after each build.");
    assert.equal(window.document.querySelectorAll(".comment-diff-row.context").length, 4);
    const openLinks = [...window.document.querySelectorAll(".comment-open-button")];
    assert.equal(openLinks.length, 1);
    assert.equal(openLinks[0].closest(".comment-header")?.classList.contains("comment-code-header"), true);
    assert.equal(openLinks[0].getAttribute("aria-label"), "Open comment thread in Azure DevOps");
    assert.ok(openLinks.every((node) => node.querySelector("svg")));
    const activePill = window.document.querySelector(".comment-status-pill");
    assert.equal(activePill?.textContent, "Active");
    assert.equal(activePill?.closest(".comment-header"), openLinks[0].closest(".comment-header"));
    assert.equal(activePill?.nextElementSibling, openLinks[0], "the Active pill precedes the thread-level open action");
    assert.equal(window.document.querySelector(".comment-actions"), null);
    assert.ok(!window.document.querySelector(".comment-thread")?.textContent.includes("go to comment"));
    const avatar = window.document.querySelector(".comment-avatar-image");
    assert.ok(avatar?.src.includes("/api/avatar?"));
    assert.ok(avatar?.src.includes(encodeURIComponent(authorImageUrl)));
    assert.ok(avatar?.src.includes("nonce=n"));
    const fix = window.document.querySelector(".comment-fix-button");
    assert.equal(fix?.textContent, "Fix");
    assert.equal(fix?.disabled, false);
    assert.ok(fix?.classList.contains("primer-button"));
    const fixIcon = fix?.querySelector(".comment-fix-icon");
    assert.equal(fixIcon?.tagName.toLowerCase(), "svg");
    assert.equal(fixIcon?.getAttribute("aria-hidden"), "true");
    assert.equal(fixIcon?.querySelectorAll("path").length, 2);
    fix.click();
    await settle();
    assert.deepEqual(state.fixRequests, [{ threadId: 1, commentId: 2 }]);
    assert.equal(fix.textContent, "Sent");
    assert.equal(fix.disabled, true);
    assert.equal(window.document.querySelector(".comment-reply-button")?.disabled, false);
    assert.equal(window.document.querySelector(".comment-status-button")?.disabled, false);
    assert.match(styles, /\.comment-header\s*\{[^}]*padding: var\(--base-size-4/);
    assert.match(styles, /\.comment-header\s*\{[^}]*align-items: center/);
    assert.match(styles, /\.comment-header\s*\{[^}]*background: var\(--background-color-muted/);
    assert.match(styles, /\.comment-status-pill\s*\{[^}]*border: 1px solid var\(--true-color-blue/);
    assert.match(styles, /\.comment-status-pill\s*\{[^}]*color: var\(--text-color-default/);
    assert.match(styles, /\.comment-status-pill\s*\{[^}]*background: var\(--true-color-blue-muted/);
    assert.match(styles, /\.comment-status-pill\s*\{[^}]*font-weight: var\(--font-weight-semibold/);
    assert.match(styles, /\.comment-byline\s*\{[^}]*background: transparent/);
    assert.match(styles, /\.comment-diff-row\.addition\s*\{[^}]*--background-color-diffBlob-addLine/);
    assert.match(styles, /\.comment-diff-row\.deletion\s*\{[^}]*--background-color-diffBlob-delLine/);
    assert.match(styles, /\.comment-diff-row\.addition \.comment-diff-sign\s*\{[^}]*--text-color-diffBlob-addSign/);
    assert.match(styles, /button\.comment-fix-button\s*\{[^}]*gap: 6px/);
    assert.match(styles, /\.primer-button\s*\{[^}]*border-radius: 6px/);
    assert.match(styles, /\.primer-button\s*\{[^}]*font-family: var\(--font-sans/);
    assert.match(styles, /\.primer-button\s*\{[^}]*--text-color-button-default-rest/);
    assert.match(styles, /\.primer-button\s*\{[^}]*--background-color-button-default-rest/);
    assert.match(styles, /\.primer-button\s*\{[^}]*--border-color-button-default-rest/);
    assert.match(styles, /\.pr-title\s*\{[^}]*--font-sans-display/);
    assert.doesNotMatch(styles, /--fontStack-sansSerif|--button-default-(?:fgColor|bgColor|borderColor)/);
});

test("non-active comment threads do not show the Fix action", describeDom, async () => {
    const { window } = await boot({
        homePrs: [101],
        commentThreads: [{
            id: 1,
            status: "fixed",
            isResolvable: true,
            comments: [
                { id: 1, author: "Ada Lovelace", text: "Resolved.", webUrl: "https://dev.azure.com/example/comments/1" },
                { id: 2, author: "Grace Hopper", text: "Thanks.", webUrl: "https://dev.azure.com/example/comments/2" },
            ],
        }],
    });
    await openFromHome(window, "!101");
    assert.equal(window.document.querySelector(".comment-fix-button"), null);
    assert.equal(window.document.querySelector(".comment-status-pill"), null);
    assert.equal(window.document.querySelectorAll(".comment-header").length, 1);
    assert.equal(window.document.querySelectorAll(".comment-byline").length, 1);
    assert.equal(window.document.querySelector(".comment-post + .comment-post .comment-header"), null);
    assert.equal(window.document.querySelectorAll(".comment-open-button").length, 1);
    assert.ok(window.document.querySelector(".comment-header-actions > .comment-open-button"));
});

test("pull request discussions add top-level comments and reply to existing threads", describeDom, async () => {
        const { window, state } = await boot({
            homePrs: [101],
            commentThreads: [{
                id: 7,
                status: "active",
                isResolvable: true,
                comments: [{ id: 1, author: "Ada", text: "Please review this." }],
            }],
        });
        await openFromHome(window, "!101");

        const topLevel = window.document.querySelector(".timeline > .comment-composer");
        topLevel.querySelector(".comment-composer-body").textContent = "Top-level feedback";
        topLevel.querySelector(".comment-submit").click();
        await settle();
        assert.deepEqual(state.prActions.at(-1), {
            id: 101,
            action: "comments",
            method: "POST",
            body: { content: "Top-level feedback" },
        });

        window.document.querySelector(".comment-reply-button").click();
        const reply = window.document.querySelector(".comment-thread > .comment-composer");
        reply.querySelector(".comment-composer-body").textContent = "A threaded reply";
        reply.querySelector(".comment-submit").click();
        await settle();
        assert.deepEqual(state.prActions.at(-1), {
            id: 101,
            action: "threads/7/comments",
            method: "POST",
            body: { parentCommentId: 1, content: "A threaded reply" },
        });
});

test("pull request discussions resolve active threads and reopen resolved threads", describeDom, async () => {
        const active = await boot({
            homePrs: [101],
            commentThreads: [{
                id: 7,
                status: "active",
                isResolvable: true,
                comments: [{ id: 1, author: "Ada", text: "Please review this." }],
            }],
        });
        await openFromHome(active.window, "!101");
        active.window.document.querySelector(".comment-status-button").click();
        await settle();
        assert.deepEqual(active.state.prActions.at(-1), {
            id: 101,
            action: "threads/7",
            method: "PATCH",
            body: { status: "fixed" },
        });

        const resolved = await boot({
            homePrs: [102],
            commentThreads: [{
                id: 8,
                status: "fixed",
                isResolvable: true,
                comments: [{ id: 1, author: "Ada", text: "Resolved." }],
            }],
        });
        await openFromHome(resolved.window, "!102");
        assert.equal(resolved.window.document.querySelector(".comment-status-button").textContent, "Reopen");
        resolved.window.document.querySelector(".comment-status-button").click();
        await settle();
        assert.deepEqual(resolved.state.prActions.at(-1), {
            id: 102,
            action: "threads/8",
            method: "PATCH",
            body: { status: "active" },
        });
});

test("pull request mentions render as named identities after refresh", describeDom, async () => {
        const { window } = await boot({
            homePrs: [101],
            commentThreads: [{
                id: 7,
                status: "active",
                isResolvable: true,
                comments: [{
                    id: 1,
                    author: "Me",
                    text: "Keep `@<mention-id>` literal, but ask @<MENTION-ID>.",
                    mentionIdentities: [{ id: "mention-id", displayName: "Ada $&_* Lovelace" }],
                }],
            }],
        });
        await openFromHome(window, "!101");
        const mention = window.document.querySelector('.comment-post-content a[data-vss-mention="version:2.0,mention-id"]');
        assert.equal(mention?.textContent, "@Ada $&_* Lovelace");
        assert.equal(window.document.querySelector(".comment-post-content code")?.textContent, "@<mention-id>");
});

test("work item discussions add a flat comment and refresh the count", describeDom, async () => {
        const { window, state } = await boot({ homeWorkItems: [42] });
        await openFromHome(window, "42");
        const composer = window.document.querySelector(".work-item-discussion > .comment-composer");
        composer.querySelector(".comment-composer-body").textContent = "Work item follow-up";
        composer.querySelector(".comment-submit").click();
        await settle();

        assert.deepEqual(state.workItemComments, [{
            id: 42,
            method: "POST",
            body: { content: "Work item follow-up" },
        }]);
        assert.equal(window.document.querySelector(".work-item-discussion .primer-counter").textContent, "1");
});

test("file-level comments do not claim that a code preview failed", describeDom, async () => {
    const { window } = await boot({
        homePrs: [101],
        commentThreads: [{
            id: 1,
            status: "active",
            isResolvable: true,
            isTimelineEvent: false,
            filePath: "/src/file-level.js",
            fileName: "file-level.js",
            lineNumber: 0,
            source: [],
            target: [],
            codeError: "",
            comments: [{ id: 1, author: "Ada Lovelace", text: "This applies to the whole file." }],
        }],
    });
    await openFromHome(window, "!101");
    assert.equal(window.document.querySelector(".comment-file-reference")?.textContent, "src/file-level.js");
    assert.equal(window.document.querySelector(".comment-diff"), null);
    assert.equal(window.document.querySelector(".comment-code-unavailable"), null);
    assert.match(window.document.querySelector(".comment-thread")?.textContent || "", /This applies to the whole file/);
});

test("bot review comments remain cards while canonical lifecycle messages remain events", describeDom, async () => {
    const publishedDate = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { window } = await boot({
        homePrs: [101],
        commentThreads: [
            {
                id: 1,
                status: "active",
                isResolvable: true,
                isTimelineEvent: false,
                updatedDate: publishedDate,
                comments: [{
                    id: 1,
                    author: "Review Bot",
                    publishedDate,
                    text: "Automated review found a possible regression.",
                }],
            },
            {
                id: 2,
                status: "unknown",
                isResolvable: false,
                isTimelineEvent: true,
                updatedDate: publishedDate,
                comments: [{
                    id: 2,
                    author: "Project Collection Service Accounts",
                    publishedDate,
                    text: "Reviewer approved.",
                }],
            },
        ],
    });
    await openFromHome(window, "!101");
    assert.match(window.document.querySelector(".comment-thread")?.textContent || "", /Automated review found a possible regression/);
    assert.match(window.document.querySelector(".timeline-event")?.textContent || "", /Reviewer approved/);
    assert.equal(window.document.querySelector(".timeline-event")?.textContent.includes("Automated review"), false);
});

test("pull request Markdown preserves collapsible details and leaves table headers uncolored", describeDom, async () => {
    const { window } = await boot({
        homePrs: [101],
        prDescription: [
            "<details>",
            '<summary><a href="https://example.com/deployment">Deployment details</a></summary>',
            "",
            "| Environment | Result |",
            "| --- | --- |",
            "| Preview | Ready |",
            "",
            "</details>",
        ].join("\n"),
    });
    await openFromHome(window, "!101");
    const details = window.document.querySelector(".pr-description details");
    const summary = details?.querySelector("summary");
    assert.ok(details, "details markup remains a native collapsible element");
    assert.equal(summary?.textContent, "Deployment details");
    assert.equal(details.open, false);
    const summaryLink = summary.querySelector("a");
    let followedSummaryLink = false;
    summaryLink.addEventListener("click", (event) => {
        event.preventDefault();
        followedSummaryLink = true;
    });
    summaryLink.click();
    assert.equal(followedSummaryLink, true, "links in disclosure labels remain interactive");
    assert.equal(details.open, false, "following a summary link does not toggle the disclosure");
    summary.click();
    assert.equal(details.open, true);
    assert.ok(details.querySelector("table"), "Markdown inside the details element is retained");
    assert.doesNotMatch(styles, /\.rich-text th\s*\{[^}]*background/);
    assert.doesNotMatch(styles, /section,\s*details\s*\{/);
    for (const [, rule] of styles.matchAll(/[^{}]*\.rich-text details[^{}]*\{([^}]*)\}/g)) {
        assert.doesNotMatch(rule, /\b(?:background|border|padding)(?:-[a-z-]+)?\s*:/);
    }
});

test("timeline events use Primer medium body typography", describeDom, async () => {
    const { window } = await boot({
        homePrs: [101],
        creationDate: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    await openFromHome(window, "!101");
    assert.ok(window.document.querySelector(".timeline-event"));
    assert.ok(window.document.querySelector(".timeline-event-marker"));
    assert.equal(window.document.querySelector(".timeline-event svg"), null);
    assert.match(styles, /\.timeline-event\s*\{[^}]*font-size: var\(--text-body-medium/);
    assert.match(styles, /\.timeline-entries::before\s*\{/);
});

test("draft pull requests retain their active status and show a draft badge", describeDom, async () => {
    const { window } = await boot({ homePrs: [101], prStatus: "active", prDraft: true });
    await openFromHome(window, "!101");
    assert.equal(window.document.querySelector(".pr-status")?.textContent, "Active");
    assert.equal(window.document.querySelector(".draft-badge")?.textContent, "Draft");
});

test("reopening an open pull request focuses it rather than duplicating it", describeDom, async () => {
    const { window } = await boot({ homePrs: [101, 102] });
    await openFromHome(window, "!101");
    await clickTab(window, 0);
    await openFromHome(window, "!102");
    await clickTab(window, 0);
    await openFromHome(window, "!101");

    assert.deepEqual(titles(window), ["Home", "PR !101", "PR !102"], "no duplicate tab was created");
    assert.equal(activeTitle(window), "PR !101");
});

test("tabs close from the X, and Home has none", describeDom, async () => {
    const { window } = await boot({ homePrs: [101, 102] });
    await openFromHome(window, "!101");
    await clickTab(window, 0);
    await openFromHome(window, "!102");

    assert.equal(tabEls(window)[0].querySelector(".view-tab-close"), null, "Home cannot be closed");
    await closeTab(window, 1);
    assert.deepEqual(titles(window), ["Home", "PR !102"]);
});

test("closing the focused tab focuses the tab that takes its place", describeDom, async () => {
    const { window } = await boot({ homePrs: [101, 102, 103] });
    await openFromHome(window, "!101");
    await clickTab(window, 0);
    await openFromHome(window, "!102");
    await clickTab(window, 0);
    await openFromHome(window, "!103");

    await clickTab(window, 2); // focus !102
    assert.equal(activeTitle(window), "PR !102");
    await closeTab(window, 2);

    assert.deepEqual(titles(window), ["Home", "PR !101", "PR !103"]);
    assert.equal(activeTitle(window), "PR !103", "focus moved to the neighbour");
    assert.equal(visiblePanels(window).length, 1, "the closed tab's panel is gone, one remains visible");
});

test("closing a background tab leaves focus alone", describeDom, async () => {
    const { window } = await boot({ homePrs: [101, 102] });
    await openFromHome(window, "!101");
    await clickTab(window, 0);
    await openFromHome(window, "!102");
    assert.equal(activeTitle(window), "PR !102");

    await closeTab(window, 1); // close !101 while !102 is focused
    assert.deepEqual(titles(window), ["Home", "PR !102"]);
    assert.equal(activeTitle(window), "PR !102", "focus stayed on the tab the user was in");
});

test("the branch pull request is marked", describeDom, async () => {
    const { window } = await boot({ branch: "feature", leadPr: { id: 101, title: "Branch PR" } });
    await openFromHome(window, "!101");

    assert.deepEqual(marks(window), [false, true], "the branch pull request carries the marker");
    const badge = tabEls(window)[1].querySelector(".view-tab-branch");
    assert.match(badge.getAttribute("aria-label"), /current branch/i, "the marker is announced, not colour-only");
});

test("switching tabs preserves what each tab already rendered", describeDom, async () => {
    const { window } = await boot({ homePrs: [101, 102] });

    await openFromHome(window, "!101");
    await clickTab(window, 0);
    await openFromHome(window, "!102");

    await clickTab(window, 1);
    assert.equal(activeTitle(window), "PR !101");
    assert.deepEqual(titles(window), ["Home", "PR !101", "PR !102"], "switching tabs changed nothing else");
    assert.equal(visiblePanels(window).length, 1);

    await clickTab(window, 2);
    assert.equal(activeTitle(window), "PR !102");
    assert.equal(visiblePanels(window).length, 1, "each tab keeps its own panel across switches");
});

test("following a link inside a work item opens it in its own tab", describeDom, async () => {
    const relations = [{
        name: "Child",
        links: [{ id: 501, project: "Other Project", label: "Task 501", title: "Related", state: "Active" }],
    }];
    const { window, state } = await boot({ homeWorkItems: [400], relations });

    await openFromHome(window, "400");
    assert.equal(activeTitle(window), "Task 400");

    const related = [...window.document.querySelectorAll(".tab-panel button")]
        .find((node) => node.textContent.includes("501"));
    assert.ok(related, "the related work item should be clickable");
    related.click();
    await settle();

    assert.deepEqual(titles(window), ["Home", "Task 400", "Task 501"], "the link must not take over the tab it was followed from");
    assert.equal(activeTitle(window), "Task 501", "the newly opened item takes focus");
    assert.match(state.workItemRequests.at(-1), /workItemProject=Other\+Project/);
});

test("walking a chain of linked work items keeps every item open", describeDom, async () => {
    // Each item links onward, so following the chain is the case that previously
    // collapsed into a single tab.
    const relations = [{
        name: "Child",
        links: [
            { id: 501, label: "Task 501", title: "First", state: "Active" },
            { id: 502, label: "Task 502", title: "Second", state: "Active" },
        ],
    }];
    const { window } = await boot({ homeWorkItems: [400], relations });

    await openFromHome(window, "400");
    for (const id of [501, 502]) {
        const link = [...window.document.querySelectorAll(".tab-panel:not([hidden]) button")]
            .find((node) => node.textContent.includes(String(id)));
        assert.ok(link, `expected a link to ${id}`);
        link.click();
        await settle();
    }

    assert.deepEqual(titles(window), ["Home", "Task 400", "Task 501", "Task 502"]);
    assert.equal(visiblePanels(window).length, 1, "still exactly one panel visible");
});

test("a canvas opened on a work item keeps Home behind it", describeDom, async () => {
    const { window, state } = await boot({ workItemReference: true });
    assert.equal(state.currentWorkItemCalls, 1, "the id is not known client-side, so it is fetched by reference");
    assert.deepEqual(titles(window), ["Home", "Bug 900"]);
    assert.equal(activeTitle(window), "Bug 900");
    assert.equal(bar(window).hidden, false);
});

test("a canvas opened on a pull request keeps Home behind it and claims nothing about the branch", describeDom, async () => {
    const { window } = await boot({ pullRequestReference: true, leadPr: { id: 777, title: "Referenced" } });
    assert.deepEqual(titles(window), ["Home", "PR !777"]);
    assert.equal(activeTitle(window), "PR !777");
    assert.deepEqual(marks(window), [false, false], "a referenced pull request is not asserted to be the branch's");
});

test("a slow tab load does not scroll whichever tab the user switched to", describeDom, async () => {
    // !102 is held open so the user can switch away mid-load, which is a normal
    // interaction on a slow connection rather than a stress case.
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const state = { homePrs: [101, 102], hold: { 102: held } };
    const { window } = await boot(state);

    await openFromHome(window, "!101");
    await clickTab(window, 0);

    // Start !102, then return to !101 before !102 resolves.
    const link = [...window.document.querySelectorAll("#homeContent .home-row-link")]
        .find((n) => n.querySelector(".home-row-id")?.textContent === "!102");
    link.click();
    await settle();
    await clickTab(window, 1);
    assert.equal(activeTitle(window), "PR !101", "the user is looking at !101");

    state.scrolls.length = 0;
    release();
    await settle();

    assert.deepEqual(state.scrolls, [], "a load that finished for a tab the user left must not scroll the tab they are on");
    assert.equal(activeTitle(window), "PR !101", "focus is unchanged");
});

test("closing a tab mid-load discards its result", describeDom, async () => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const state = { homePrs: [101, 102], hold: { 102: held } };
    const { window } = await boot(state);

    await openFromHome(window, "!101");
    await clickTab(window, 0);
    const link = [...window.document.querySelectorAll("#homeContent .home-row-link")]
        .find((n) => n.querySelector(".home-row-id")?.textContent === "!102");
    link.click();
    await settle();
    assert.deepEqual(titles(window), ["Home", "PR !101", "PR !102"]);

    await closeTab(window, 2);
    assert.deepEqual(titles(window), ["Home", "PR !101"]);

    // The abandoned load now returns. It must not resurrect the tab or report success.
    release();
    await settle();
    assert.deepEqual(titles(window), ["Home", "PR !101"], "a closed tab stays closed when its load resolves");
    const entries = [...window.document.querySelectorAll("#logsList .log-entry")].map((n) => n.textContent);
    assert.ok(
        entries.some((line) => line.includes("Closed tab.")),
        "closing is expected to be logged",
    );
    assert.ok(
        !entries.some((line) => line.includes("Loaded pull request details") && line.includes("!102")),
        "a closed tab's load must not report success",
    );
});

test("middle-click closes a tab", describeDom, async () => {
    const { window } = await boot({ homePrs: [101, 102] });
    await openFromHome(window, "!101");
    await clickTab(window, 0);
    await openFromHome(window, "!102");
    assert.deepEqual(titles(window), ["Home", "PR !101", "PR !102"]);

    const target = tabEls(window)[1];
    target.dispatchEvent(new window.MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }));
    await settle();
    assert.deepEqual(titles(window), ["Home", "PR !102"], "middle-click closed the tab under the pointer");

    // Home is not closable, so middle-clicking it must do nothing.
    tabEls(window)[0].dispatchEvent(new window.MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }));
    await settle();
    assert.deepEqual(titles(window), ["Home", "PR !102"], "middle-click cannot close Home");
});

test("the tab bar is wired up for assistive technology", describeDom, async () => {
    const { window } = await boot({
        branch: "feature",
        leadPr: { id: 101, title: "Branch PR" },
        relatedWorkItems: [400],
    });
    await openFromHome(window, "!101");
    await clickTab(window, 0);
    await openFromHome(window, "400");

    const list = bar(window);
    // A tablist may only contain tabs; the wrappers that carry the close button
    // are presentational, so nothing else may sit directly inside it.
    for (const child of list.children) {
        assert.equal(child.getAttribute("role"), "presentation", "tab wrappers stay presentational");
        const tabRoles = [...child.children].filter((n) => n.getAttribute("role") === "tab");
        assert.equal(tabRoles.length, 1, "each wrapper holds exactly one tab");
    }

    for (const el of tabEls(window)) {
        const label = el.querySelector('[role="tab"]');
        const panel = window.document.getElementById(label.getAttribute("aria-controls"));
        assert.ok(panel, `aria-controls must resolve for ${label.textContent}`);
        assert.equal(panel.getAttribute("aria-labelledby"), label.id, "the panel names itself from its tab");
        assert.equal(label.getAttribute("aria-selected"), String(el.classList.contains("active")));
    }

    // The branch marker belongs to the tab's accessible name, not beside it.
    const branchTab = tabEls(window).find((el) => el.querySelector(".view-tab-branch"));
    assert.ok(branchTab, "the branch pull request is marked");
    assert.equal(branchTab.querySelector(".view-tab-branch").parentElement.getAttribute("role"), "tab");

    const close = branchTab.querySelector(".view-tab-close");
    assert.equal(close.getAttribute("role"), null, "the close button is not itself a tab");
    assert.match(close.getAttribute("aria-label"), /close/i);
    assert.match(styles, /\.view-tabs \{[^}]*overflow-x: auto[^}]*overflow-y: hidden/);
    assert.match(styles, /\.view-tabs \{[^}]*scrollbar-width: none/);
    assert.match(styles, /\.view-tabs:hover, \.view-tabs:focus-within \{ scrollbar-width: thin; \}/);
    assert.match(styles, /\.view-tabs::-webkit-scrollbar \{ width: 0; height: 0; \}/);
    assert.match(styles, /\.view-tab \{[^}]*flex: 0 0 auto/);
});

test("switching to a slow tab and away again does not scroll the tab left behind", describeDom, async () => {
    // Exercises the switch path specifically: the first test covers opening a new
    // tab, this one covers returning to one whose content has not loaded yet.
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const state = { homePrs: [101, 102], hold: { 102: held } };
    const { window } = await boot(state);

    await openFromHome(window, "!101");
    await clickTab(window, 0);
    const link = [...window.document.querySelectorAll("#homeContent .home-row-link")]
        .find((n) => n.querySelector(".home-row-id")?.textContent === "!102");
    link.click();
    await settle();

    // !102 is still loading. Leave it, come back to it, then leave again, so a
    // switch-initiated load is in flight for a tab that is no longer on screen.
    await clickTab(window, 1);
    await clickTab(window, 2);
    await clickTab(window, 1);
    assert.equal(activeTitle(window), "PR !101");

    state.scrolls.length = 0;
    release();
    await settle();

    assert.deepEqual(state.scrolls, [], "a switch-initiated load must not scroll once the user has moved on");
    assert.equal(activeTitle(window), "PR !101");
});

// --- Connections -----------------------------------------------------------
//
// The canvas used to stop at "Azure DevOps remote needed" whenever the session
// was not in an Azure DevOps repository. These cover what replaced it.

const panel = (w) => w.document.getElementById("connectionPanel");
const sectionTitles = (w) => [...w.document.querySelectorAll("#homeContent .home-section-title")].map((el) => el.textContent);

test("with no remote and nothing saved, the canvas asks for an organization instead of reporting a missing remote", describeDom, async () => {
    const { window } = await boot({ remote: { isAzureDevOps: false, remoteUrl: "https://github.com/owner/repo" }, connections: [] });
    assert.equal(panel(window).hidden, false, "the picker is the canvas when there is nothing to read from");
    assert.match(panel(window).textContent, /No Azure DevOps remote was detected/);
    assert.equal(
        window.document.querySelector("#homeContent .status")?.textContent,
        undefined,
        "no dead-end message is left behind the picker",
    );
});

test("the picker only requires an organization, and says why a project still matters", describeDom, async () => {
    const { window } = await boot({ remote: { isAzureDevOps: false }, connections: [], organizations: ["contoso", "fabrikam"] });
    await settle();
    const labels = [...panel(window).querySelectorAll(".connection-field-label")].map((el) => el.textContent);
    assert.deepEqual(labels, ["Organization", "Project", "Repository"]);
    assert.match(panel(window).textContent, /Required\./);
    assert.match(panel(window).textContent, /no organization-wide pull request list/);
    const organization = panel(window).querySelector('[role="combobox"]');
    organization.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const options = [...panel(window).querySelectorAll('[role="option"]')].map((el) => el.textContent);
    assert.ok(options.includes("contoso") && options.includes("fabrikam"), "known organizations are offered");
});

test("choosing an organization saves it and rebuilds the canvas", describeDom, async () => {
    const state = { remote: { isAzureDevOps: false }, connections: [], organizations: ["fabrikam"] };
    const { window } = await boot(state);
    await settle();
    const input = panel(window).querySelector(".connection-input");
    input.value = "fabrikam";
    input.dispatchEvent(new window.Event("change"));
    await settle();
    panel(window).querySelector("button[type=submit]").click();
    await settle();

    assert.deepEqual(state.savedConnections[0], { organization: "fabrikam", project: "", repositoryId: "", isDefault: false });
    assert.equal(panel(window).hidden, true, "the picker closes once there is a connection");
    assert.deepEqual(titles(window), ["Home"]);
});

test("the default toggle is what pins a connection", describeDom, async () => {
    const state = { remote: { isAzureDevOps: false }, connections: [], organizations: ["fabrikam"] };
    const { window } = await boot(state);
    await settle();
    const input = panel(window).querySelector(".connection-input");
    input.value = "fabrikam";
    input.dispatchEvent(new window.Event("change"));
    await settle();
    const toggle = panel(window).querySelector(".connection-toggle input");
    toggle.checked = true;
    toggle.dispatchEvent(new window.Event("change"));
    await settle();
    panel(window).querySelector("button[type=submit]").click();
    await settle();

    assert.equal(state.savedConnections[0].isDefault, true);
});

test("the footer opens the picker over a working canvas, and cancel returns to it", describeDom, async () => {
    const { window } = await boot({ homePrs: [101] });
    assert.equal(panel(window).hidden, true);
    window.document.getElementById("connectionsButton").click();
    await settle();
    assert.equal(panel(window).hidden, false);
    assert.match(panel(window).textContent, /Showing/, "the picker shows what the canvas is currently reading from");
    [...panel(window).querySelectorAll("button")].find((el) => el.textContent === "Cancel").click();
    await settle();
    assert.equal(panel(window).hidden, true);
    assert.ok(sectionTitles(window).includes("Active pull requests"), "the canvas underneath is untouched");
});

test("the current session group comes before active work", describeDom, async () => {
    const { window } = await boot({
        branch: "feature",
        leadPr: { id: 101, title: "PR 101", status: "active" },
    });
    assert.deepEqual(
        [...window.document.querySelectorAll(".home-group-title")].map((node) => node.textContent),
        ["My current session", "My active work"],
    );
    assert.deepEqual(
        [...window.document.querySelectorAll(".home-current-session .home-section-title")]
            .map((node) => node.textContent),
        ["Branch", "Pull request", "Related work items", "Development"],
    );
});

test("without an Azure DevOps remote there is no current session group, because there is no branch to match", describeDom, async () => {
    const { window } = await boot({
        remote: { isAzureDevOps: false },
        connections: [{ source: "default", organization: "fabrikam", project: "Project", isDefault: true, isRemote: false, requiresProject: false }],
        homePrs: [101],
    });
    assert.equal(window.document.querySelector(".home-current-session"), null);
    assert.ok(sectionTitles(window).includes("Active pull requests"));
});

test("two connections stack, most relevant first, and each is labelled", describeDom, async () => {
    const { window } = await boot({
        homeConnections: [
            { source: "remote", organization: "contoso", project: "Widgets", isRemote: true, isDefault: false, requiresProject: false, prs: [101], workItems: [11] },
            { source: "default", organization: "fabrikam", project: "Boxes", isRemote: false, isDefault: true, requiresProject: false, prs: [202], workItems: [22] },
        ],
    });
    const headings = [...window.document.querySelectorAll(".home-connection-name")].map((el) => el.textContent);
    assert.deepEqual(headings, ["contoso / Widgets", "fabrikam / Boxes"], "the remote's organization ranks above the default");
    const pills = [...window.document.querySelectorAll(".connection-pill")].map((el) => el.textContent);
    assert.deepEqual(pills, ["this repository", "default"]);
});

test("a single connection is not labelled, so the one-organization case reads as it always did", describeDom, async () => {
    const { window } = await boot({ homePrs: [101] });
    assert.equal(window.document.querySelectorAll(".home-connection-name").length, 0);
});

test("a row is fetched from the organization it was listed under", describeDom, async () => {
    const state = {
        homeConnections: [
            { source: "remote", organization: "contoso", project: "Widgets", isRemote: true, isDefault: false, requiresProject: false, prs: [101], workItems: [] },
            { source: "default", organization: "fabrikam", project: "Boxes", isRemote: false, isDefault: true, requiresProject: false, prs: [202], workItems: [] },
        ],
    };
    const { window } = await boot(state);
    await openFromHome(window, "!202");
    assert.match(state.pullRequestRequests.at(-1), /organization=fabrikam/);
    assert.match(state.pullRequestRequests.at(-1), /project=Boxes/);
    assert.deepEqual(titles(window), ["Home", "PR !202"]);
});

test("the same id in two organizations opens as two tabs, because they are two items", describeDom, async () => {
    const { window } = await boot({
        homeConnections: [
            { source: "remote", organization: "contoso", project: "Widgets", isRemote: true, isDefault: false, requiresProject: false, prs: [500], workItems: [] },
            { source: "default", organization: "fabrikam", project: "Boxes", isRemote: false, isDefault: true, requiresProject: false, prs: [500], workItems: [] },
        ],
    });
    const links = [...window.document.querySelectorAll("#homeContent .home-row-link")]
        .filter((node) => node.querySelector(".home-row-id")?.textContent === "!500");
    assert.equal(links.length, 2);
    links[0].click();
    await settle();
    links[1].click();
    await settle();
    assert.equal(titles(window).length, 3, "one Home and one tab per organization");
});

test("a connection with no project offers to pick one instead of showing an empty pull request list", describeDom, async () => {
    const { window } = await boot({
        remote: { isAzureDevOps: false },
        connections: [{ source: "default", organization: "fabrikam", project: "", isDefault: true, isRemote: false, requiresProject: true }],
        homeConnections: [
            { source: "default", organization: "fabrikam", project: "", isRemote: false, isDefault: true, requiresProject: true, prs: [], workItems: [11] },
        ],
    });
    assert.doesNotMatch(
        window.document.querySelector("#homeContent").textContent,
        /Azure DevOps lists pull requests by project/,
    );
    const choose = [...window.document.querySelectorAll("#homeContent button")].find((el) => el.textContent === "Choose a project");
    assert.ok(choose, "and there is a way to fix it from where the user noticed it");
    choose.click();
    await settle();
    assert.equal(panel(window).hidden, false);
});

test("an organization-scope work item row carries its own project to the detail request", describeDom, async () => {
    const state = {
        remote: { isAzureDevOps: false },
        connections: [{ source: "default", organization: "fabrikam", project: "", isDefault: true, isRemote: false, requiresProject: true }],
        homeConnections: [
            { source: "default", organization: "fabrikam", project: "", isRemote: false, isDefault: true, requiresProject: true, prs: [], workItems: [[4711, "Beta"]] },
        ],
    };
    const { window } = await boot(state);
    await openFromHome(window, "4711");
    const request = state.workItemRequests.at(-1);
    assert.match(request, /organization=fabrikam/);
    assert.match(request, /workItemProject=Beta/, "the connection has no project, so the row supplies one");
    assert.deepEqual(titles(window), ["Home", "Task 4711"]);
});

// Typing into a field commits on `input`, not on blur. Committing on blur would
// leave Save disabled until the user thought to blur, and clicking a disabled
// Save does not blur anything, so the picker would deadlock on first run.
function typeInto(window, index, value) {
    const input = [...panel(window).querySelectorAll(".connection-input")][index];
    input.value = value;
    input.dispatchEvent(new window.Event("input"));
    return input;
}

test("typing an organization enables Save without needing to leave the field", describeDom, async () => {
    const { window } = await boot({ remote: { isAzureDevOps: false }, connections: [] });
    await settle();
    const save = panel(window).querySelector("button[type=submit]");
    assert.equal(save.disabled, true, "there is nothing to save yet");
    typeInto(window, 0, "fabrikam");
    await settle();
    assert.equal(save.disabled, false, "the field has not been blurred, and Save is already usable");
});

test("patching the picker keeps the field the user is typing in alive", describeDom, async () => {
    const { window } = await boot({ remote: { isAzureDevOps: false }, connections: [], organizations: ["fabrikam"] });
    await settle();
    const before = panel(window).querySelector("button[type=submit]");
    const input = typeInto(window, 0, "fab");
    await settle();
    assert.equal(
        panel(window).querySelector(".connection-input"),
        input,
        "the organization field survives the update, so the caret and focus do not move",
    );
    assert.equal(
        panel(window).querySelector("button[type=submit]"),
        before,
        "and Save survives it too, so a click that starts on it can finish on it",
    );
});

test("a connection the canvas could not store is not treated as saved", describeDom, async () => {
    const state = {
        remote: { isAzureDevOps: false },
        connections: [],
        connectionSaveError: "Could not save the Azure DevOps connection: EACCES",
    };
    const { window } = await boot(state);
    await settle();
    typeInto(window, 0, "fabrikam");
    await settle();
    panel(window).querySelector("button[type=submit]").click();
    await settle();

    assert.equal(panel(window).hidden, false, "the picker stays open rather than looping back to an empty one");
    assert.match(panel(window).querySelector(".connection-error").textContent, /EACCES/);
    assert.equal(
        panel(window).querySelector(".connection-input").value,
        "fabrikam",
        "and what the user typed is still there to retry with",
    );
});

test("changing the organization clears a project that belonged to the previous one", describeDom, async () => {
    const state = { remote: { isAzureDevOps: false }, connections: [], projects: ["Widgets"] };
    const { window } = await boot(state);
    await settle();
    const organization = typeInto(window, 0, "contoso");
    organization.dispatchEvent(new window.Event("change"));
    await settle();
    typeInto(window, 1, "Widgets");
    await settle();

    organization.value = "fabrikam";
    organization.dispatchEvent(new window.Event("input"));
    organization.dispatchEvent(new window.Event("change"));
    await settle();
    assert.equal([...panel(window).querySelectorAll(".connection-input")][1].value, "");
});

test("the repository is saved even when the engine raises no input event for it", describeDom, async () => {
    // A value chosen from the datalist dropdown does not raise `input` in every
    // engine, and the field the user is looking at is the one that must win. The
    // draft is deliberately never told about this value.
    const state = {
        remote: { isAzureDevOps: false },
        connections: [{ source: "last-used", organization: "fabrikam", project: "widgets", repositoryId: "", isDefault: false, isRemote: false, requiresProject: false }],
        repositories: ["widgets-api", "other-repo"],
    };
    const { window } = await boot(state);
    window.document.getElementById("connectionsButton").click();
    await settle();
    const inputs = [...panel(window).querySelectorAll(".connection-input")];
    inputs[2].value = "other-repo";
    panel(window).querySelector("button[type=submit]").click();
    await settle();
    assert.equal(state.savedConnections.at(-1).repositoryId, "other-repo");
});

test("a changed field is saved when the engine raises change but not input", describeDom, async () => {
    const state = {
        remote: { isAzureDevOps: false },
        connections: [{ source: "last-used", organization: "fabrikam", project: "widgets", repositoryId: "widgets-api", isDefault: false, isRemote: false, requiresProject: false }],
    };
    const { window } = await boot(state);
    window.document.getElementById("connectionsButton").click();
    await settle();
    const inputs = [...panel(window).querySelectorAll(".connection-input")];
    inputs[2].value = "other-repo";
    inputs[2].dispatchEvent(new window.Event("change"));
    await settle();
    panel(window).querySelector("button[type=submit]").click();
    await settle();
    assert.equal(state.savedConnections.at(-1).repositoryId, "other-repo");
});

test("the missing-remote note is informational, and says what is actually missing", describeDom, async () => {
    const { window } = await boot({
        remote: { isAzureDevOps: false, remoteName: "origin", remoteUrl: "https://github.com/contoso/widgets.git" },
        connections: [{ source: "last-used", organization: "fabrikam", project: "Project", isDefault: false, isRemote: false, requiresProject: false }],
    });
    const note = window.document.getElementById("setupWarning");
    assert.equal(note.hidden, false);
    assert.equal(note.className, "notice", "not styled as a failure: the canvas works without a remote");
    assert.equal(note.getAttribute("role"), "status", "and not announced as an alert");
    assert.match(note.textContent, /no current branch pull request/i, "it explains the one thing that is missing");
    assert.ok(!/needed/i.test(note.textContent), "nothing is 'needed' any more");
    // A substring check rather than a regex: this asserts the remote is named, and
    // an unanchored host pattern is the kind of thing that is a real bug when it
    // guards something rather than describing it.
    assert.ok(
        note.textContent.includes("(github.com/contoso/widgets)"),
        "the actual remote, without the .git suffix",
    );
    assert.ok(!styles.includes(".warning {"), "the red banner style is gone with its last user");
});

test("the note stays silent when there is an Azure DevOps remote, or nothing to explain yet", describeDom, async () => {
    const withRemote = await boot({});
    assert.equal(withRemote.window.document.getElementById("setupWarning").hidden, true);

    const firstRun = await boot({ remote: { isAzureDevOps: false }, connections: [] });
    assert.equal(
        firstRun.window.document.getElementById("setupWarning").hidden,
        true,
        "the picker is already saying it; a note beside it would be noise",
    );
});

test("pull request review voting stays hidden while its feature flight is disabled", describeDom, async () => {
    const { window } = await boot({
        homePrs: [101],
        reviewers: [{ id: "me", displayName: "Me", uniqueName: "me@example.com", vote: 0, isRequired: true }],
    });
    await openFromHome(window, "!101");

    assert.equal(PULL_REQUEST_REVIEW_VOTING_ENABLED, false);
    assert.equal(window.document.querySelector(".pr-vote-control"), null);
});

test("a completed pull request offers no state change, only the link out", describeDom, async () => {
    const { window } = await boot({ homePrs: [101], prStatus: "completed" });
    await openFromHome(window, "!101");

    assert.equal(window.document.querySelector(".pr-state-control .pr-primary-button"), null, "nothing to do to a completed pull request");
    assert.ok(window.document.querySelector(".pr-state-menu-only"), "the menu stands alone without a primary");
    assert.deepEqual(
        [...window.document.querySelectorAll(".pr-state-control .primer-action-list-button")].map((item) => item.dataset.action),
        ["view-in-ado"],
    );
    assert.equal(window.document.querySelector(".pr-vote-control"), null);
    assert.equal(window.document.querySelector(".reviewer-picker"), null, "the roster is read-only once complete");
    assert.equal(window.document.querySelector(".pr-work-item-picker"), null);
});

test("an abandoned pull request reactivates from the primary", describeDom, async () => {
    const { window, state } = await boot({ homePrs: [101], prStatus: "abandoned" });
    await openFromHome(window, "!101");

    const control = window.document.querySelector(".pr-state-control");
    assert.equal(control.querySelector(".pr-primary-button")?.textContent, "Reactivate");
    assert.deepEqual(
        [...control.querySelectorAll(".primer-action-list-button")].map((item) => item.dataset.action),
        ["reactivate", "view-in-ado"],
    );
    control.querySelector(".pr-primary-button").click();
    await settle();
    assert.deepEqual(state.prActions, [{ id: 101, action: "status", method: "POST", body: { action: "reactivate" } }]);
});

test("complete leads the actions menu, with draft and abandon behind it", describeDom, async () => {
    const { window, state } = await boot({ homePrs: [101] });
    await openFromHome(window, "!101");

    const control = window.document.querySelector(".pr-state-control");
    assert.equal(control.querySelector(".pr-primary-button")?.textContent, "Complete");
    assert.deepEqual(
        [...control.querySelectorAll(".primer-action-list-button")].map((item) => item.dataset.action),
        ["complete", "mark-draft", "abandon", "view-in-ado"],
    );

    // Marking as draft is reversible, so it acts on the first click.
    control.querySelector('[data-action="mark-draft"]').click();
    await settle();
    assert.deepEqual(state.prActions, [{ id: 101, action: "draft", method: "POST", body: { isDraft: true } }]);
});

test("a draft pull request leads with publish", describeDom, async () => {
    const { window } = await boot({ homePrs: [101], prDraft: true });
    await openFromHome(window, "!101");

    const control = window.document.querySelector(".pr-state-control");
    assert.equal(control.querySelector(".pr-primary-button")?.textContent, "Publish");
    assert.deepEqual(
        [...control.querySelectorAll(".primer-action-list-button")].map((item) => item.dataset.action),
        ["publish", "abandon", "view-in-ado"],
    );
});

test("completing asks before it merges, and cancelling leaves the pull request alone", describeDom, async () => {
    const { window, state } = await boot({ homePrs: [101] });
    await openFromHome(window, "!101");

    window.document.querySelector(".pr-state-control .pr-primary-button").click();
    await settle();
    assert.match(
        window.document.querySelector(".pr-confirm-question")?.textContent || "",
        /Complete !101 and merge it into main\?/,
    );
    assert.equal(state.prActions, undefined, "nothing is sent before the confirmation");

    window.document.querySelector(".pr-confirm-cancel").click();
    await settle();
    assert.equal(window.document.querySelector(".pr-confirm"), null, "the action bar comes back");
    assert.equal(state.prActions, undefined);

    window.document.querySelector(".pr-state-control .pr-primary-button").click();
    await settle();
    window.document.querySelector(".pr-confirm-accept").click();
    await settle();
    assert.deepEqual(state.prActions, [{ id: 101, action: "complete", method: "POST", body: {} }]);
});

test("abandoning asks before it closes the pull request", describeDom, async () => {
    const { window, state } = await boot({ homePrs: [101] });
    await openFromHome(window, "!101");

    window.document.querySelector('.pr-state-control [data-action="abandon"]').click();
    await settle();
    assert.match(window.document.querySelector(".pr-confirm-question")?.textContent || "", /Abandon !101\?/);
    assert.equal(state.prActions, undefined);

    window.document.querySelector(".pr-confirm-accept").click();
    await settle();
    assert.deepEqual(state.prActions, [{ id: 101, action: "status", method: "POST", body: { action: "abandon" } }]);
});

test("reviewers are grouped by role, and the role changes from the row menu", describeDom, async () => {
    const { window, state } = await boot({
        homePrs: [101],
        reviewers: [
            { id: "r1", displayName: "Optional Person", uniqueName: "opt@example.com", vote: 0, isRequired: false },
            { id: "r2", displayName: "Required Person", uniqueName: "req@example.com", vote: 10, isRequired: true },
        ],
    });
    await openFromHome(window, "!101");

    const groups = [...window.document.querySelectorAll(".reviewer-group")];
    assert.deepEqual(groups.map((group) => group.dataset.role), ["required", "optional"]);
    assert.equal(groups[0].querySelector(".reviewer-group-title")?.textContent, "Required (1)");
    assert.equal(groups[1].querySelector(".reviewer-group-title")?.textContent, "Optional (1)");
    assert.equal(groups[0].querySelector(".reviewer-row")?.dataset.reviewerId, "r2");
    assert.equal(groups[1].querySelector(".reviewer-row")?.dataset.reviewerId, "r1");
    // The state a reviewer is in, not the action that would put them there.
    assert.equal(groups[0].querySelector(".reviewer-vote")?.textContent, "Approved");
    assert.equal(groups[1].querySelector(".reviewer-vote")?.textContent, "No vote");

    // The role is stated by the group, so the row menu only offers the change.
    const optionalRow = window.document.querySelector('.reviewer-row[data-reviewer-id="r1"]');
    assert.equal(optionalRow.querySelector('[data-role="required"]')?.textContent, "Make required");
    optionalRow.querySelector('[data-role="required"]').click();
    await settle();

    window.document
        .querySelector('.reviewer-row[data-reviewer-id="r2"] [data-action="remove"]')
        .click();
    await settle();

    assert.deepEqual(state.prActions, [
        { id: 101, action: "reviewers", method: "PUT", body: { reviewerId: "r1", isRequired: true } },
        { id: 101, action: "reviewers/remove", method: "POST", body: { reviewerId: "r2" } },
    ]);
});

test("each reviewer group adds its own reviewers, and the group decides the role", describeDom, async () => {
    const { window, state } = await boot({
        homePrs: [101],
        identities: [{ id: "r9", displayName: "New Person", uniqueName: "new@example.com" }],
    });
    await openFromHome(window, "!101");

    assert.equal(window.document.querySelector(".reviewer-add-role"), null, "the separate role switch is gone");
    const addButtons = [...window.document.querySelectorAll(".reviewer-add-button")];
    assert.deepEqual(addButtons.map((node) => node.dataset.role), ["required", "optional"]);

    // The picker stays out of the way until the group is asked for one.
    const requiredGroup = window.document.querySelector('.reviewer-group[data-role="required"]');
    assert.equal(requiredGroup.querySelector(".reviewer-picker")?.hidden, true);
    addButtons[0].click();
    await settle();
    assert.equal(requiredGroup.querySelector(".reviewer-picker")?.hidden, false);
    assert.equal(addButtons[0].getAttribute("aria-expanded"), "true");

    const input = requiredGroup.querySelector(".reviewer-picker-input");
    input.value = "new";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 350));
    requiredGroup.querySelector(".reviewer-picker-add").click();
    await settle();

    assert.deepEqual(state.prActions, [
        { id: 101, action: "reviewers", method: "PUT", body: { reviewerId: "r9", isRequired: true } },
    ], "adding from the required group makes the reviewer required");
});

test("adding from the optional group makes the reviewer optional", describeDom, async () => {
    const { window, state } = await boot({
        homePrs: [101],
        identities: [{ id: "r9", displayName: "New Person", uniqueName: "new@example.com" }],
    });
    await openFromHome(window, "!101");

    const optionalGroup = window.document.querySelector('.reviewer-group[data-role="optional"]');
    optionalGroup.querySelector(".reviewer-add-button").click();
    await settle();
    const input = optionalGroup.querySelector(".reviewer-picker-input");
    input.value = "new";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 350));
    optionalGroup.querySelector(".reviewer-picker-add").click();
    await settle();

    assert.deepEqual(state.prActions, [
        { id: 101, action: "reviewers", method: "PUT", body: { reviewerId: "r9", isRequired: false } },
    ]);
});

test("the reviewer picker searches identities and excludes reviewers already on the pull request", describeDom, async () => {
    const { window, state } = await boot({
        homePrs: [101],
        reviewers: [{ id: "r1", displayName: "Already There", vote: 0, isRequired: false }],
        identities: [
            { id: "r1", displayName: "Already There", uniqueName: "there@example.com" },
            { id: "r9", displayName: "New Person", uniqueName: "new@example.com" },
        ],
    });
    await openFromHome(window, "!101");

    const group = window.document.querySelector('.reviewer-group[data-role="optional"]');
    group.querySelector(".reviewer-add-button").click();
    await settle();
    const input = group.querySelector(".reviewer-picker-input");
    input.value = "per";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 350));

    const results = [...group.querySelectorAll(".reviewer-picker-add")];
    assert.deepEqual(results.map((node) => node.dataset.identityId), ["r9"]);
    assert.match(state.identityQueries.at(-1), /query=per/);

    results[0].click();
    await settle();
    assert.deepEqual(state.prActions, [
        { id: 101, action: "reviewers", method: "PUT", body: { reviewerId: "r9", isRequired: false } },
    ]);
});

test("a one-character reviewer search does not reach the server", describeDom, async () => {
    const { window, state } = await boot({ homePrs: [101] });
    await openFromHome(window, "!101");

    const input = window.document.querySelector('.reviewer-group[data-role="required"] .reviewer-picker-input');
    input.value = "a";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 350));

    assert.equal(state.identityQueries, undefined);
});

test("work items unlink from the list and link from the picker", describeDom, async () => {
    const { window, state } = await boot({ homePrs: [101], prWorkItems: [55], searchWorkItems: [77] });
    await openFromHome(window, "!101");

    assert.equal(window.document.querySelector(".pr-work-items .section-title")?.textContent, "Linked work items");
    assert.equal(window.document.querySelector(".pr-work-items .primer-counter")?.textContent, "1");
    const row = window.document.querySelector(".pr-work-item-row");
    assert.equal(row?.dataset.workItemId, "55");
    const type = row.querySelector(".pr-work-item-type");
    assert.equal(type?.textContent, "Task");
    assert.equal(type?.style.getPropertyValue("--work-item-type-color"), "#f2cb1d");
    assert.equal(workItemTypeColor({ type: "Issue" }), "#339947", "the built-in fallback matches ADO's default Issue color");
    assert.equal(
        workItemTypeColor({ type: "Issue", typeColor: "123456" }),
        "#123456",
        "the project process's type definition overrides the fallback",
    );
    assert.match(styles, /\.pr-work-item-type, \.pr-work-item-result-type \{[^}]*color: color-mix/);
    assert.doesNotMatch(styles, /\.pr-work-item-type::before/);
    const unlink = row.querySelector(".pr-work-item-unlink");
    assert.equal(unlink?.textContent, "");
    assert.equal(unlink?.getAttribute("aria-label"), "Unlink work item #55");
    assert.ok(unlink?.querySelector(".pr-work-item-unlink-icon"));
    assert.match(styles, /\.pr-work-item-unlink \{[^}]*opacity: 0/);
    assert.match(styles, /\.pr-work-item-unlink \{[^}]*width: 24px[^}]*min-height: 24px/);
    assert.match(styles, /\.pr-work-item-unlink-icon \{[^}]*width: 10px[^}]*height: 10px/);
    assert.match(styles, /\.pr-work-item-row:hover \.pr-work-item-unlink[^}]*opacity: 1/);
    unlink.click();
    await settle();

    const input = window.document.querySelector(".pr-work-item-picker-input");
    assert.equal(window.document.querySelector(".pr-work-item-picker-label")?.textContent, "Link");
    assert.equal(input?.placeholder, "Search by title or ID");
    input.value = "auth";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 350));
    const result = window.document.querySelector(".pr-work-item-picker-add");
    assert.equal(result?.dataset.workItemId, "77");
    result.click();
    await settle();

    assert.deepEqual(state.prActions, [
        { id: 101, action: "work-items/remove", method: "POST", body: { workItemId: 55 } },
        { id: 101, action: "work-items", method: "POST", body: { workItemId: 77 } },
    ]);
});

test("the work item picker suggests before any typing and hides what is already linked", describeDom, async () => {
    const { window, state } = await boot({ homePrs: [101], prWorkItems: [55], searchWorkItems: [55, 77] });
    await openFromHome(window, "!101");

    const input = window.document.querySelector(".pr-work-item-picker-input");
    assert.equal(input?.type, "search", "the picker searches rather than stepping through ids");
    input.dispatchEvent(new window.Event("focus", { bubbles: true }));
    await settle();

    assert.match(state.workItemSearches.at(-1), /query=(&|$)|work-item-search/);
    assert.deepEqual(
        [...window.document.querySelectorAll(".pr-work-item-picker-add")].map((node) => node.dataset.workItemId),
        ["77"],
        "the work item already linked is not offered again",
    );
});

test("a work item search that finds nothing says so rather than failing the view", describeDom, async () => {
    const { window } = await boot({ homePrs: [101], searchWorkItems: [] });
    await openFromHome(window, "!101");

    const input = window.document.querySelector(".pr-work-item-picker-input");
    input.value = "nothing matches this";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 350));

    assert.equal(
        window.document.querySelector(".pr-work-item-picker-empty")?.textContent,
        "No matching work items.",
    );
});

test("a linked work item opens in its own tab", describeDom, async () => {
    const { window } = await boot({ homePrs: [101], prWorkItems: [55] });
    await openFromHome(window, "!101");

    window.document.querySelector(".pr-work-item-title").click();
    await settle();

    assert.ok(titles(window).includes("Task 55"), `work item tab opened: ${titles(window).join(", ")}`);
});

test("reviewers and work items ride alongside the description rather than below it", describeDom, async () => {
    const { window } = await boot({ homePrs: [101], prWorkItems: [55] });
    await openFromHome(window, "!101");

    const body = window.document.querySelector(".pr-body");
    assert.ok(body?.classList.contains("has-sidebar"), "the pull request lays out with a sidebar");
    assert.deepEqual(
        [...body.children].map((node) => node.className.split(" ")[0]),
        ["pr-main-column", "pr-sidebar"],
        "the main column comes first, the sidebar alongside it",
    );

    const main = body.querySelector(".pr-main-column");
    const sidebar = body.querySelector(".pr-sidebar");
    assert.ok(main.querySelector(".pr-description"), "the description takes the width");
    assert.ok(main.querySelector(".timeline"), "the discussion stays with the description");
    assert.ok(main.querySelector(".pr-checks"), "checks stay in the main column");
    assert.deepEqual(
        [...main.children].map((node) => node.className.split(" ")[0]),
        ["pr-checks", "pr-description", "timeline"],
        "ADO readiness stays at the top, followed by description and discussion",
    );
    assert.ok(sidebar.querySelector(".pr-reviewers"), "reviewers are in the sidebar");
    assert.ok(sidebar.querySelector(".pr-work-items"), "linked work items are in the sidebar");
    assert.ok(sidebar.firstElementChild?.classList.contains("pr-reviewers"), "reviewers lead the sidebar");

    // The description must get the larger share, and the layout must collapse
    // rather than crush the sidebar on a narrow canvas.
    assert.match(styles, /\.pr-body\.has-sidebar\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(280px, 320px\)/);
    assert.match(styles, /@media \(max-width: 860px\)[^}]*\{[\s\S]*?\.pr-body\.has-sidebar \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    assert.match(styles, /@container \(max-width: 760px\)/);
});

test("editing a pull request gives the editor the full width", describeDom, async () => {
    const { window } = await boot({ homePrs: [101] });
    await openFromHome(window, "!101");

    window.document.querySelector(".pr-header-actions .inline-edit")?.click();
    await settle();

    const body = window.document.querySelector(".pr-body");
    assert.equal(body?.classList.contains("has-sidebar"), false, "no sidebar competes with the editor");
    assert.equal(window.document.querySelector(".pr-sidebar"), null);
    assert.equal(window.document.querySelector(".pr-actions"), null, "actions are hidden while editing");
});

test("the lifecycle decisions sit on the title's row, with the edit pencil beside them", describeDom, async () => {
    const { window } = await boot({ homePrs: [101] });
    await openFromHome(window, "!101");

    const header = window.document.querySelector(".pr-header");
    const actions = header?.querySelector(".pr-header-actions");
    assert.equal(header?.children[1], actions, "the actions occupy the title row's right column");
    assert.equal(header?.lastElementChild?.className, "pr-merge-summary", "the merge proposal follows on its own row");
    assert.equal(
        window.document.querySelector(".pr-title-row .inline-edit"),
        null,
        "the pencil no longer sits next to the title",
    );
    assert.deepEqual(
        [...actions.children].map((node) => node.className.split(" ")[0]),
        ["inline-edit", "pr-actions"],
        "the pencil comes first, then the decision buttons",
    );

    assert.equal(actions.querySelector(".pr-vote-control"), null, "review voting is feature-flagged off");
    const state = actions.querySelector(".pr-state-control .pr-primary-button");
    assert.ok(state?.classList.contains("primary"), "Complete is the emphasised button");
    assert.match(styles, /\.pr-split-button \.primer-button \{[^}]*min-height: 32px/);
    assert.match(styles, /\.pr-header-actions \{[^}]*grid-column: 2/);
    assert.match(styles, /\.pr-header-actions \{[^}]*justify-self: end/);
});

test("a caret-only trigger centres its caret instead of leaving it in the label column", describeDom, async () => {
    const { window } = await boot({ homePrs: [101] });
    await openFromHome(window, "!101");

    // The trigger is normally a two-column grid of label then caret. With no
    // label the caret would sit at the start of the stretched label column, which
    // reads as off-centre against the divider and the outer edge.
    const caret = window.document.querySelector(".pr-split-caret");
    assert.ok(caret, "the split button has a caret-only trigger");
    assert.equal(caret.querySelector(".primer-action-menu-trigger-label")?.textContent, "");
    assert.match(styles, /\.pr-split-button \.pr-split-caret \{[^}]*grid-template-columns: auto/);
    assert.match(styles, /\.pr-split-button \.pr-split-caret \{[^}]*justify-content: center/);
    assert.match(styles, /button\.reviewer-menu-trigger \{[^}]*grid-template-columns: auto/);
    assert.match(styles, /button\.reviewer-menu-trigger \{[^}]*justify-content: center/);
});

test("the setup notice does not have the view tabs pulled up into it", describeDom, async () => {
    const { window } = await boot({
        remote: { isAzureDevOps: false, remoteName: "origin", remoteUrl: "https://github.com/contoso/widgets.git" },
        connections: [{ source: "last-used", organization: "fabrikam", project: "Project", isDefault: false, isRemote: false, requiresProject: false }],
    });

    const note = window.document.getElementById("setupWarning");
    const bar = window.document.querySelector(".view-bar");
    assert.equal(note.hidden, false);
    assert.equal(note.nextElementSibling, bar, "the notice sits directly above the view bar");

    // The bar is pulled up by a negative top margin so the tabs sit flush with the
    // top of the canvas. That pull has to be cancelled when the notice is above
    // it, or the tabs overlap the notice.
    assert.match(styles, /\.view-bar \{[^}]*margin: -16px -16px 4px/);
    assert.match(styles, /#setupWarning:not\(\[hidden\]\) \+ \.view-bar \{ margin-top: 12px; \}/);
});

test("the reviewer and work item context uses clear bordered cards", describeDom, async () => {
    const { window } = await boot({ homePrs: [101], prWorkItems: [55] });
    await openFromHome(window, "!101");

    assert.equal(
        window.document.querySelector(".pr-reviewers-body")?.firstElementChild?.className,
        "reviewer-group",
    );
    assert.equal(window.document.querySelector(".pr-reviewers .section-title")?.textContent, "Reviewers");
    assert.equal(window.document.querySelector(".pr-work-items .section-title")?.textContent, "Linked work items");
    assert.match(styles, /\.pr-reviewers, \.pr-work-items \{[^}]*border: 1px/);
    assert.match(styles, /\.pr-reviewers, \.pr-work-items \{[^}]*border-radius: 8px/);
    assert.match(styles, /\.pr-context-heading \{[^}]*border-bottom: 1px/);
    assert.match(styles, /\.pr-reviewers-body \{[^}]*padding: 10px 12px 12px/);
    assert.match(styles, /\.pr-work-item-row \{[^}]*padding: 9px 12px/);
});

test("the reviewer row menu is a small ellipsis on the right, not a full-width button", describeDom, async () => {
    const { window } = await boot({
        homePrs: [101],
        currentUser: { id: "me", displayName: "Me" },
        reviewers: [{ id: "r1", displayName: "Carlo Rivera", uniqueName: "crivera@example.com", vote: 0, isRequired: false }],
    });
    await openFromHome(window, "!101");

    const row = window.document.querySelector('.reviewer-row[data-reviewer-id="r1"]');
    const trigger = row.querySelector(".reviewer-menu-trigger");
    assert.ok(trigger, "the row carries an overflow control");
    assert.equal(row.lastElementChild, row.querySelector(".reviewer-menu"), "it is the rightmost item in the row");
    assert.ok(trigger.querySelector(".reviewer-menu-icon"), "it is an ellipsis");
    assert.equal(trigger.querySelector(".primer-action-menu-caret"), null, "and not a caret");

    // Fixed width and its own grid column, so it cannot stretch across the row.
    assert.match(styles, /button\.reviewer-menu-trigger \{[^}]*width: 28px/);
    // Just the dots at rest. The selectors have to stay element-qualified to
    // outrank button.primer-action-menu-trigger, which would otherwise put the
    // control's border, background, and shadow back.
    assert.match(styles, /button\.reviewer-menu-trigger \{[^}]*border-color: transparent/);
    assert.match(styles, /button\.reviewer-menu-trigger \{[^}]*background: transparent/);
    assert.match(styles, /button\.reviewer-menu-trigger \{[^}]*box-shadow: none/);
    assert.match(styles, /button\.reviewer-menu-trigger:hover[^{]*\{[^}]*border-color: transparent/);
    assert.match(styles, /\.reviewer-row \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto/);
    assert.match(styles, /\.reviewer-row \.reviewer-menu \{ grid-area: 1 \/ 2; \}/);
});

test("a reviewer with no vote is not described with the action that would clear one", describeDom, async () => {
    const { window } = await boot({
        homePrs: [101],
        reviewers: [
            { id: "r1", displayName: "No Vote", vote: 0, isRequired: false },
            { id: "r2", displayName: "Rejector", vote: -10, isRequired: true },
            { id: "r3", displayName: "Waiter", vote: -5, isRequired: true },
        ],
    });
    await openFromHome(window, "!101");

    const voteOf = (id) => window.document
        .querySelector(`.reviewer-row[data-reviewer-id="${id}"] .reviewer-vote`)?.textContent;
    assert.equal(voteOf("r1"), "No vote", "a reviewer who has not voted is not labelled 'Reset feedback'");
    assert.equal(voteOf("r2"), "Rejected");
    assert.equal(voteOf("r3"), "Waiting for author");

    assert.equal(window.document.querySelector(".pr-vote-control"), null);
});

test("reviewer menus do not offer reset feedback while review voting is disabled", describeDom, async () => {
    const { window } = await boot({
        homePrs: [101],
        currentUser: { id: "me", displayName: "Me" },
        reviewers: [
            { id: "me", displayName: "Me", vote: 10, isRequired: true },
            { id: "r1", displayName: "Someone Else", vote: 10, isRequired: true },
        ],
    });
    await openFromHome(window, "!101");

    const items = (id) => [...window.document
        .querySelectorAll(`.reviewer-row[data-reviewer-id="${id}"] .primer-action-list-button`)]
        .map((node) => node.textContent);
    assert.deepEqual(items("me"), ["Make optional", "Remove"]);
    assert.deepEqual(items("r1"), ["Make optional", "Remove"]);
    assert.equal(window.document.querySelector('[data-action="reset"]'), null);
});

test("an action menu opens over its container instead of being clipped by it", describeDom, async () => {
    const { window } = await boot({
        homePrs: [101],
        reviewers: [{ id: "r1", displayName: "Carlo Rivera", vote: 0, isRequired: false }],
    });
    await openFromHome(window, "!101");

    // Fixed-position menus can escape the bordered card's clipping boundary.
    assert.match(styles, /\.pr-reviewers, \.pr-work-items \{[^}]*overflow: hidden/);
    assert.match(styles, /\.primer-action-menu-overlay \{[^}]*position: fixed/);

    const overlay = window.document.querySelector(".reviewer-menu .primer-action-menu-overlay");
    const trigger = window.document.querySelector(".reviewer-menu-trigger");
    const size = (node, width, height) => {
        Object.defineProperty(node, "offsetWidth", { value: width, configurable: true });
        Object.defineProperty(node, "offsetHeight", { value: height, configurable: true });
    };
    const viewport = (width, height) => {
        Object.defineProperty(window.document.documentElement, "clientWidth", { value: width, configurable: true });
        Object.defineProperty(window.document.documentElement, "clientHeight", { value: height, configurable: true });
    };
    const at = (rect) => { trigger.getBoundingClientRect = () => rect; };

    size(overlay, 180, 100);
    viewport(800, 600);

    // Room below: the menu hangs off the bottom of the trigger, right-aligned.
    at({ top: 100, bottom: 126, left: 600, right: 628, width: 28, height: 26 });
    trigger.click();
    assert.equal(overlay.hidden, false);
    assert.equal(overlay.style.top, "130px", "4px under the trigger");
    assert.equal(overlay.style.left, "448px", "right edge aligned to the trigger");

    // Near the bottom: it flips above rather than running off screen.
    trigger.click();
    at({ top: 540, bottom: 566, left: 600, right: 628, width: 28, height: 26 });
    trigger.click();
    assert.equal(overlay.style.top, "436px", "flipped above the trigger");

    // Hard against the right edge: pulled back to stay on screen.
    trigger.click();
    at({ top: 100, bottom: 126, left: 780, right: 808, width: 28, height: 26 });
    trigger.click();
    assert.equal(overlay.style.left, "612px", "clamped to the viewport margin");
});
