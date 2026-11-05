import { renderPullRequest } from "./pull-request-view.mjs";
import { renderWorkItem } from "./work-item-view.mjs";
import { renderHome } from "./home-view.mjs";
import { renderConnectionPanel } from "./connection-view.mjs";
import { AGENCY_AUTH_ENABLED, normalizeFeatureFlags } from "../common.mjs";

const warning = document.getElementById("setupWarning");
const startupSplash = document.getElementById("startupSplash");
const startupTitle = document.getElementById("startupTitle");
const startupDetail = document.getElementById("startupDetail");
const signInSplash = document.getElementById("signInSplash");
const canvasContent = document.getElementById("canvasContent");
const homePanel = document.getElementById("homePanel");
const homeContent = document.getElementById("homeContent");
const tabPanels = document.getElementById("tabPanels");
const viewTabs = document.getElementById("viewTabs");
const viewBar = document.querySelector(".view-bar");
const authOutput = document.getElementById("authOutput");
const logsPanel = document.getElementById("logsPanel");
const connectionPanel = document.getElementById("connectionPanel");
const workItemDrawerScrim = document.getElementById("workItemDrawerScrim");
const workItemDrawer = document.getElementById("workItemDrawer");
const workItemDrawerContent = document.getElementById("workItemDrawerContent");
const workItemDrawerClose = document.getElementById("workItemDrawerClose");
const workItemDrawerExpand = document.getElementById("workItemDrawerExpand");
const connectionsButton = document.getElementById("connectionsButton");
const refreshButton = document.getElementById("refreshButton");
const signInMicrosoftButton = document.getElementById("signInMicrosoftButton");
const signInAgencyButton = document.getElementById("signInAgencyButton");
const signOutButton = document.getElementById("signOutButton");
const showLogsButton = document.getElementById("showLogsButton");
const copyLogsButton = document.getElementById("copyLogsButton");
const logsList = document.getElementById("logsList");
const copyLogsStatus = document.getElementById("copyLogsStatus");
const boardsFeatureFlag = document.getElementById("boardsFeatureFlag");
const delegationFeatureFlag = document.getElementById("delegationFeatureFlag");
const versionLabel = document.getElementById("versionLabel");

let apiNonce = "";
let currentConfig;
let branchPullRequestInfo = null;
let branchPullRequestId = 0;
let homeLoaded = false;
let logs = [];
let enabledFeatures = normalizeFeatureFlags();

// Tabs behave like browser tabs: every item opens in its own tab and is closed
// independently. A tab is { id, entry, panel, content, data, rendered, token,
// timelineFilter, scrollTop, closable, editMode, dirty }, where entry is the
// { view, id } it shows, editMode is whether the whole detail view is being
// edited, and dirty tracks whether anything in it has unsaved changes.
let tabs = [];
let activeTabId = "";
let tabSequence = 0;
let boardWorkItemDrawerState = null;
let boardDelegationSequence = 0;
const pendingBoardDelegations = new Map();
let workItemDrawerBackgroundState = null;

const focusableSelector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
].join(",");


function addLog(level, message, details = "") {
    logs.unshift({ time: new Date().toLocaleTimeString(), level, message, details });
    logs = logs.slice(0, 100);
    renderLogs();
}

function renderLogs() {
    logsList.replaceChildren();
    if (!logs.length) {
        logsList.append(element("div", "status", "No logs yet."));
        return;
    }
    for (const entry of logs) {
        const item = element("div", "log-entry");
        item.append(element("span", "status", `[${entry.time}] `), document.createTextNode(`${entry.level.toUpperCase()} ${entry.message}`));
        if (entry.details) item.append(document.createElement("br"), element("span", "status", entry.details));
        logsList.append(item);
    }
}

function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function closeIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("data-icon-source", "octicon");
    svg.setAttribute("data-icon-name", "x");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "12");
    svg.setAttribute("height", "12");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z");
    svg.append(path);
    return svg;
}

function loadingSpinner(compact = false) {
    const host = element("span", `loading-spinner ${compact ? "loading-spinner-compact" : "loading-spinner-large"}`);
    host.setAttribute("aria-hidden", "true");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("loading-spinner-svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    for (const className of ["loading-spinner-track", "loading-spinner-arc"]) {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.classList.add(className);
        circle.setAttribute("cx", "12");
        circle.setAttribute("cy", "12");
        circle.setAttribute("r", "9");
        svg.append(circle);
    }
    host.append(svg);
    return host;
}

function createLoadingState(title, detail = "", { compact = false, className = "" } = {}) {
    const state = element(
        "div",
        ["loading-state", compact ? "loading-state-compact" : "", className].filter(Boolean).join(" "),
    );
    state.setAttribute("role", "status");
    state.setAttribute("aria-live", "polite");
    state.setAttribute("aria-busy", "true");
    const copy = element("span", "loading-copy");
    copy.append(element("strong", "loading-title", title));
    if (detail) {
        copy.append(element("span", "loading-detail", detail));
    }
    state.append(loadingSpinner(compact), copy);
    return state;
}

function showLoading(container, title, detail = "", options = {}) {
    container.replaceChildren(createLoadingState(title, detail, options));
}

function showStartupLoading(title, detail = "") {
    startupTitle.textContent = title;
    startupDetail.textContent = detail;
    startupDetail.hidden = !detail;
    startupSplash.hidden = false;
    startupSplash.setAttribute("aria-busy", "true");
    signInSplash.hidden = true;
    canvasContent.hidden = true;
}

async function request(path, options = {}, includeNonce = true) {
    const headers = new Headers(options.headers || {});
    if (includeNonce && apiNonce) headers.set("X-Canvas-Nonce", apiNonce);
    const response = await fetch(path, { ...options, headers });
    let data;
    try {
        data = await response.json();
    } catch {
        throw new Error("The canvas received an invalid response.");
    }
    if (!response.ok) {
        // A newer sign-in may have replaced the rejected token while this request
        // was in flight. Only show the chooser if the server is still signed out.
        if (data.error === "azure_devops_authentication_rejected") {
            const status = await request("/api/auth/status");
            if (currentConfig) {
                currentConfig.auth = status.auth || currentConfig.auth;
            }
            if (status.auth?.isAuthenticated === false) {
                showSignInSplash();
            }
        }
        throw new Error(data.message || data.error || "Request failed.");
    }
    return data;
}

function setNotice(message) {
    warning.hidden = !message;
    warning.textContent = message || "";
}

// Not a failure any more, so not styled as one: the canvas works fine without an
// Azure DevOps remote. It is a note explaining the one thing that is genuinely
// missing without one, which is the current-branch pull request section.
function remoteNotice(config) {
    if (config?.remote?.isAzureDevOps || !(config?.connections || []).length) {
        return "";
    }
    const remoteName = normalizeRemoteName(config?.remote);
    return remoteName
        ? `No Azure DevOps remote in this workspace (${remoteName}), so there is no current branch pull request to show.`
        : "No Azure DevOps remote in this workspace, so there is no current branch pull request to show.";
}

function normalizeRemoteName(remote) {
    const url = remote?.remoteUrl || "";
    // Just the host and path, so the note stays a note rather than a wrapped URL.
    try {
        const parsed = new URL(url);
        return `${parsed.hostname}${parsed.pathname.replace(/\.git$/, "")}`;
    } catch {
        return "";
    }
}

function showStatus(container, message, retry) {
    container.replaceChildren(element("div", "status", message));
    if (retry) {
        const button = element("button", "secondary retry-button", "Retry");
        button.addEventListener("click", retry);
        container.append(button);
    }
}

function skeletonLine(className = "") {
    return element("span", ["loading-skeleton-line", className].filter(Boolean).join(" "));
}

function skeletonCard(lineClasses = []) {
    const card = element("div", "loading-skeleton-card");
    lineClasses.forEach((className) => card.append(skeletonLine(className)));
    return card;
}

function showPullRequestLoading(container, id) {
    const shell = element("div", "pr-skeleton");
    shell.setAttribute("aria-busy", "true");
    shell.append(createLoadingState(`Loading pull request !${id}`, "", {
        compact: true,
    }));
    const visual = element("div", "pr-skeleton-visual");
    visual.setAttribute("aria-hidden", "true");
    const header = element("div", "pr-skeleton-header");
    header.append(
        skeletonLine("pr-skeleton-title"),
        skeletonLine("pr-skeleton-meta"),
    );
    const layout = element("div", "pr-skeleton-layout");
    const main = element("div", "pr-skeleton-main");
    main.append(
        skeletonCard(["loading-skeleton-short", "loading-skeleton-long", "loading-skeleton-medium"]),
        skeletonCard(["loading-skeleton-medium", "loading-skeleton-long", "loading-skeleton-short"]),
        skeletonCard(["loading-skeleton-short", "loading-skeleton-long"]),
    );
    const sidebar = element("div", "pr-skeleton-sidebar");
    sidebar.append(
        skeletonCard(["loading-skeleton-short", "loading-skeleton-medium", "loading-skeleton-medium"]),
        skeletonCard(["loading-skeleton-short", "loading-skeleton-long"]),
    );
    layout.append(main, sidebar);
    visual.append(header, layout);
    shell.append(visual);
    container.replaceChildren(shell);
}

function showWorkItemLoading(container, id) {
    const shell = element("div", "work-item-skeleton");
    shell.setAttribute("aria-busy", "true");
    shell.append(createLoadingState(id ? `Loading work item ${id}` : "Loading work item", "", {
        compact: true,
    }));
    const visual = element("div", "work-item-skeleton-visual");
    visual.setAttribute("aria-hidden", "true");
    const header = element("div", "work-item-skeleton-header");
    header.append(
        skeletonLine("work-item-skeleton-title"),
        skeletonLine("work-item-skeleton-meta"),
    );
    const facts = element("div", "work-item-skeleton-facts");
    for (let index = 0; index < 4; index += 1) {
        facts.append(skeletonCard(["loading-skeleton-short", "loading-skeleton-medium"]));
    }
    const layout = element("div", "work-item-skeleton-layout");
    const main = element("div", "work-item-skeleton-main");
    main.append(
        skeletonCard(["loading-skeleton-short", "loading-skeleton-long", "loading-skeleton-medium"]),
        skeletonCard(["loading-skeleton-short", "loading-skeleton-long", "loading-skeleton-long"]),
    );
    const sidebar = element("div", "work-item-skeleton-sidebar");
    sidebar.append(
        skeletonCard(["loading-skeleton-short", "loading-skeleton-medium", "loading-skeleton-medium"]),
        skeletonCard(["loading-skeleton-short", "loading-skeleton-long"]),
    );
    layout.append(main, sidebar);
    visual.append(header, facts, layout);
    shell.append(visual);
    container.replaceChildren(shell);
}

function showPullRequestError(container, message, retry) {
    const state = element("section", "pr-load-state pr-error-state");
    state.setAttribute("role", "alert");
    state.append(
        element("h2", "pr-load-state-title", "Pull request could not load"),
        element("p", "pr-load-state-message", message),
    );
    const button = element("button", "secondary retry-button", "Retry");
    button.addEventListener("click", retry);
    state.append(button);
    container.replaceChildren(state);
}

// --- Tabs ------------------------------------------------------------------

function activeTab() {
    return tabs.find((tab) => tab.id === activeTabId) || null;
}

// Guards the two paths that throw away rendered tabs: closing one, and refreshing
// the whole canvas. An editor with unsaved text is the only state in the canvas
// that cannot be recovered by reloading.
function confirmDiscard(candidates) {
    if (!candidates.some((tab) => tab.dirty)) {
        return true;
    }
    try {
        return window.confirm("Discard unsaved changes?");
    } catch {
        // A webview without a dialog implementation should not silently discard
        // the user's text, so the operation is refused instead.
        return false;
    }
}

function tabEntry(tab) {
    return tab?.entry || null;
}

// Ids are compared without coercing a missing or non-numeric id to 0, which is
// the id the reference-opened tab uses: collapsing onto it would focus that tab
// instead of opening the link that was clicked. The organization is part of the
// identity because two organizations can each have an item 4711. Pull request
// IDs are organization-wide, so project names and GUIDs must not split one PR
// into duplicate tabs. Organization-scope work-item rows carry their project
// separately because their connection itself has no project.
function sameEntry(left, right) {
    if (!left || !right || left.view !== right.view) {
        return false;
    }
    const leftId = Number(left.id);
    const rightId = Number(right.id);
    const sameId = left.view === "board"
        ? String(left.id || "") === String(right.id || "")
        : Number.isFinite(leftId) && Number.isFinite(rightId) && leftId === rightId;
    const sameOrganization = (left.organization || "").toLowerCase() ===
        (right.organization || "").toLowerCase();
    if (!sameId || !sameOrganization) {
        return false;
    }
    if (left.view === "pull-request") {
        return true;
    }
    const leftProject = left.view === "work-item" ? left.workItemProject || left.project : left.project;
    const rightProject = right.view === "work-item" ? right.workItemProject || right.project : right.project;
    return (leftProject || "").toLowerCase() === (rightProject || "").toLowerCase();
}

// Every data request names the connection it belongs to, and the server checks
// the name against the connections it resolved.
function connectionQuery(entry, extra = {}) {
    const params = new URLSearchParams();
    if (entry?.organization) params.set("organization", entry.organization);
    if (entry?.project) params.set("project", entry.project);
    if (entry?.pullRequestProject) params.set("pullRequestProject", entry.pullRequestProject);
    if (entry?.pullRequestRepositoryId) params.set("pullRequestRepositoryId", entry.pullRequestRepositoryId);
    for (const [key, value] of Object.entries(extra)) {
        if (value) params.set(key, value);
    }
    const query = params.toString();
    return query ? `?${query}` : "";
}

function entryForConnection(view, id, connection, extra = {}) {
    return {
        view,
        id: view === "board" ? String(id || "") : Number(id),
        organization: connection?.organization || "",
        project: connection?.project || "",
        ...extra,
    };
}

function tabTitle(tab) {
    const entry = tabEntry(tab);
    if (entry.view === "home") {
        return "Home";
    }
    if (entry.view === "pull-request") {
        return `PR !${tab.data?.id || entry.id}`;
    }
    if (entry.view === "board") {
        return tab.data?.name || entry.name || "Board";
    }
    return tab.data ? `${tab.data.type} ${tab.data.id}` : `Work item ${entry.id}`;
}

// The pull request for the checked-out branch is the one the user is most likely
// working in, so it stays identifiable once several are open.
function isBranchPullRequestTab(tab) {
    const entry = tabEntry(tab);
    return Boolean(branchPullRequestId) && entry?.view === "pull-request" && Number(entry.id) === branchPullRequestId;
}

function renderTabBar() {
    viewTabs.replaceChildren();
    for (const tab of tabs) {
        const isActive = tab.id === activeTabId;
        // The wrapper is presentational so the tablist still contains only tabs;
        // the close button is a separate control rather than part of the tab.
        const item = element("div", `view-tab${isActive ? " active" : ""}`);
        item.setAttribute("role", "presentation");

        const label = element("button", "view-tab-label", tabTitle(tab));
        label.type = "button";
        label.id = `${tab.id}-tab`;
        label.setAttribute("role", "tab");
        label.setAttribute("aria-selected", String(isActive));
        label.setAttribute("aria-controls", tab.panel.id);
        label.title = tab.data?.title || tabTitle(tab);
        label.addEventListener("click", () => activateTab(tab.id));
        // The marker lives inside the tab so the tablist contains only tabs, and
        // so it becomes part of the tab's accessible name rather than a stray
        // image beside it.
        if (isBranchPullRequestTab(tab)) {
            const badge = element("span", "view-tab-branch");
            badge.setAttribute("role", "img");
            badge.setAttribute("aria-label", "current branch");
            label.append(badge);
        }
        tab.panel.setAttribute("aria-labelledby", label.id);
        item.append(label);

        if (tab.closable) {
            const close = element("button", "view-tab-close");
            close.type = "button";
            close.setAttribute("aria-label", `Close ${tabTitle(tab)}`);
            close.append(closeIcon());
            close.title = `Close ${tabTitle(tab)}`;
            close.addEventListener("click", (event) => {
                event.stopPropagation();
                closeTab(tab.id);
            });
            item.append(close);
        }

        viewTabs.append(item);
    }
    // Home is the stable entry point for this canvas, so keep the tab strip
    // visible even before another item has been opened.
    viewTabs.hidden = tabs.length === 0;
}

function createTab(entry, { closable = true } = {}) {
    tabSequence += 1;
    const tab = {
        id: `tab-${tabSequence}`,
        entry,
        data: null,
        rendered: null,
        token: 0,
        timelineFilter: "all",
        scrollTop: 0,
        editMode: false,
        dirty: false,
        delegationPending: false,
        delegationStatus: "",
        delegationError: "",
        closable,
        panel: null,
        content: null,
    };
    if (entry.view === "home") {
        tab.panel = homePanel;
        tab.content = homeContent;
    } else {
        // Each item tab owns its DOM so switching tabs does not discard what was
        // already rendered, and so scroll position can be restored per tab.
        tab.panel = element("section", "tab-panel");
        tab.panel.id = `${tab.id}-panel`;
        tab.panel.setAttribute("role", "tabpanel");
        tab.panel.setAttribute("aria-live", "polite");
        tab.panel.hidden = true;
        tab.content = element("div", entry.view === "board" ? "board-tab-content" : "cards");
        if (entry.view === "board") {
            tab.panel.classList.add("board-panel");
        }
        tab.panel.append(tab.content);
        tabPanels.append(tab.panel);
    }
    tabs.push(tab);
    return tab;
}

function showActivePanel() {
    for (const tab of tabs) {
        tab.panel.hidden = tab.id !== activeTabId;
    }
}

async function activateTab(id) {
    if (id === activeTabId) {
        return;
    }
    if (boardWorkItemDrawerState?.tab?.id === activeTabId && !closeBoardWorkItemDrawer()) {
        return;
    }
    const outgoing = activeTab();
    if (outgoing) {
        outgoing.scrollTop = window.scrollY;
    }
    activeTabId = id;
    renderTabBar();
    showActivePanel();
    const tab = activeTab();
    if (!tab) {
        return;
    }
    await applyTab(tab);
    // The load may have outlived the switch, so only move the viewport if this
    // tab is still the one on screen.
    if (tab.id === activeTabId) {
        window.scrollTo(0, tab.scrollTop || 0);
    }
}

function closeTab(id) {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index === -1 || !tabs[index].closable) {
        return;
    }
    if (!confirmDiscard([tabs[index]])) {
        return;
    }
    const [closed] = tabs.splice(index, 1);
    releaseBoardTab(closed);
    // Invalidates any load still in flight for this tab, so it cannot render into
    // a detached panel or report success for something the user closed.
    closed.token += 1;
    if (closed.panel !== homePanel) {
        closed.panel.remove();
    }
    addLog("trace", "Closed tab.", tabTitle(closed));
    if (activeTabId !== id) {
        renderTabBar();
        return;
    }
    // Focus the neighbour the closed tab occupied, falling back to its left.
    const next = tabs[index] || tabs[index - 1] || null;
    activeTabId = next?.id || "";
    renderTabBar();
    showActivePanel();
    if (next) {
        applyTab(next).then(() => {
            if (next.id === activeTabId) {
                window.scrollTo(0, next.scrollTop || 0);
            }
        });
    }
}

// Opening an item from Home or another tab gives it its own tab, matching the
// browser convention that an index opens results rather than replacing itself.
async function openEntry(entry) {
    const existing = tabs.find((tab) => sameEntry(tabEntry(tab), entry));
    if (existing) {
        if (entry.boardTabId && tabEntry(existing)?.boardTabId !== entry.boardTabId) {
            existing.entry = { ...tabEntry(existing), boardTabId: entry.boardTabId };
            if (existing.data && !existing.dirty) {
                renderWorkItemTab(existing);
            }
        }
        await activateTab(existing.id);
        return;
    }
    const outgoing = activeTab();
    if (outgoing) {
        outgoing.scrollTop = window.scrollY;
    }
    const tab = createTab(entry);
    activeTabId = tab.id;
    renderTabBar();
    showActivePanel();
    // Scrolled before the load so a slow fetch cannot yank the viewport of a tab
    // the user has since switched to.
    window.scrollTo(0, 0);
    await applyTab(tab);
}

async function applyTab(tab) {
    const entry = tabEntry(tab);
    if (!entry) {
        return;
    }
    if (entry.view === "home") {
        if (!homeLoaded) {
            await loadHome();
        }
        return;
    }
    if (sameEntry(tab.rendered, entry)) {
        return;
    }
    tab.token += 1;
    const token = tab.token;
    if (entry.view === "pull-request") {
        await loadPullRequestIntoTab(tab, entry.id, token);
    } else if (entry.view === "board") {
        await loadBoardIntoTab(tab, token);
    } else {
        await loadWorkItemIntoTab(tab, entry, token);
    }
    renderTabBar();
}

function releaseBoardToken(token) {
    if (!token) {
        return;
    }
    request(`/api/boards/${encodeURIComponent(token)}`, { method: "DELETE" })
        .catch((error) => addLog("error", "Failed to close board server.", error.message || ""));
}

function releaseBoardTab(tab) {
    if (tabEntry(tab)?.view === "board") {
        if (boardWorkItemDrawerState?.tab === tab) {
            closeBoardWorkItemDrawer(true);
        }
        for (const [requestId, pending] of pendingBoardDelegations) {
            if (pending.tab === tab) {
                clearTimeout(pending.timeout);
                pending.reject(new Error("The board was closed before delegation completed."));
                pendingBoardDelegations.delete(requestId);
            }
        }
        for (const workItemTab of tabs) {
            if (tabEntry(workItemTab)?.boardTabId !== tab.id) continue;
            workItemTab.entry = { ...tabEntry(workItemTab), boardTabId: "" };
            workItemTab.delegationPending = false;
            workItemTab.delegationStatus = "";
            workItemTab.delegationError = "";
            if (workItemTab.data && !workItemTab.dirty) {
                renderWorkItemTab(workItemTab);
            }
        }
        releaseBoardToken(tab.data?.token);
    }
}

async function loadBoardIntoTab(tab, token) {
    const entry = tabEntry(tab);
    showLoading(tab.content, `Opening ${entry.name || "board"}`, "Loading the favorited Azure DevOps board.");
    tab.rendered = null;
    try {
        const data = await request("/api/boards/open", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id: entry.id,
                organization: entry.organization,
                project: entry.project,
            }),
        });
        if (token !== tab.token) {
            releaseBoardToken(data.token);
            return;
        }
        tab.data = { ...data.board, token: data.token, path: data.path };
        tab.rendered = { ...entry };
        const frame = element("iframe", "board-frame");
        frame.title = `${data.board?.name || entry.name || "Azure DevOps"} board`;
        frame.src = data.path;
        tab.frame = frame;
        tab.content.replaceChildren(frame);
        addLog(
            "trace",
            "Opened favorite board.",
            [data.board?.organization, data.board?.project, data.board?.name].filter(Boolean).join("/"),
        );
    } catch (error) {
        if (token !== tab.token) {
            return;
        }
        tab.data = null;
        showStatus(tab.content, error.message || "Failed to open the Azure DevOps board.", () => applyTab(tab));
        addLog("error", "Failed to open favorite board.", error.message || "");
    }
}

function boardTabForMessage(event) {
    if (event.origin !== window.location.origin) {
        return null;
    }
    return tabs.find((tab) => (
        tabEntry(tab)?.view === "board" &&
        tab.frame?.contentWindow === event.source
    )) || null;
}

window.addEventListener("message", (event) => {
    if (event.data?.source !== "azure-devops-board") {
        return;
    }
    const tab = boardTabForMessage(event);
    if (!tab) {
        return;
    }
    if (event.data.type === "open-work-item") {
        void openBoardWorkItemDrawer(tab, {
            id: event.data.id,
            project: event.data.project || tabEntry(tab)?.project || "",
        });
        return;
    }
    if (event.data.type === "delegation-result") {
        const pending = pendingBoardDelegations.get(event.data.requestId);
        if (!pending || pending.tab !== tab || pending.source !== event.source) {
            return;
        }
        clearTimeout(pending.timeout);
        pendingBoardDelegations.delete(event.data.requestId);
        pending.resolve(event.data.result || { ok: false, error: "Delegation failed." });
    }
});

workItemDrawerExpand.addEventListener("click", () => {
    const state = boardWorkItemDrawerState;
    if (!state || !closeBoardWorkItemDrawer()) {
        return;
    }
    void openWorkItem({
        id: state.id,
        project: state.workItemProject || tabEntry(state.tab)?.project || "",
        boardTabId: state.tab.id,
    }, tabEntry(state.tab));
});
workItemDrawerClose.addEventListener("click", () => closeBoardWorkItemDrawer());
workItemDrawerScrim.addEventListener("click", () => closeBoardWorkItemDrawer());
window.addEventListener("keydown", (event) => {
    if (!boardWorkItemDrawerState) return;
    if (event.key === "Tab") {
        trapWorkItemDrawerFocus(event);
    } else if (event.key === "Escape") {
        event.preventDefault();
        closeBoardWorkItemDrawer();
    }
});

async function loadConfig() {
    const data = await request("/api/config", {}, false);
    apiNonce = data.apiNonce || "";
    if (!apiNonce) throw new Error("The canvas did not provide an API nonce.");
    currentConfig = data.config;
    enabledFeatures = normalizeFeatureFlags(currentConfig.featureFlags);
    if (boardsFeatureFlag && delegationFeatureFlag) {
        boardsFeatureFlag.checked = enabledFeatures.boards;
        delegationFeatureFlag.checked = enabledFeatures.delegation;
    }
    versionLabel.textContent = currentConfig.extensionVersion ? `v${currentConfig.extensionVersion}` : "";
    // A note rather than a warning: with a connection the canvas works fine
    // without an Azure DevOps remote, and it stays silent when there is nothing
    // to explain.
    setNotice(remoteNotice(currentConfig));
    addLog("trace", currentConfig.remote?.isAzureDevOps ? "Detected Azure DevOps remote." : "Azure DevOps remote not detected.", currentConfig.remote?.remoteUrl || "");
    return data;
}

function renderAuthOutput(process) {
    if (!process) {
        authOutput.hidden = true;
        authOutput.textContent = "";
        return;
    }
    let message = "Signing in...";
    if (process.provider === "canvas" && process.status === "succeeded") {
        message = "Signed out.";
    } else if (process.status === "succeeded") {
        message = "Signed in.";
    } else if (process.status === "failed") {
        message = "Sign-in didn't complete. Try again.";
    } else if (process.provider === "microsoft") {
        message = "Complete sign-in in the browser, then return here.";
    } else if (process.provider === "azureauth") {
        message = "Complete sign-in when prompted.";
    }
    authOutput.hidden = false;
    authOutput.textContent = message;
    authOutput.scrollTop = authOutput.scrollHeight;
}

function showSignInSplash() {
    // AzureAuth is an internal Microsoft tool, so the Agency option only works
    // where a managed install was discovered. Offering it elsewhere gives users
    // a button whose only outcome is azure_devops_azureauth_not_found. The
    // button starts hidden in the markup, so an unreachable config leaves it
    // hidden rather than briefly advertising an option that cannot work.
    signInAgencyButton.hidden =
        !AGENCY_AUTH_ENABLED || !currentConfig?.auth?.azureAuthDiscovery?.selected;
    startupSplash.hidden = true;
    startupSplash.setAttribute("aria-busy", "false");
    signInSplash.hidden = false;
    canvasContent.hidden = true;
    logsPanel.hidden = true;
}

function showCanvas() {
    startupSplash.hidden = true;
    startupSplash.setAttribute("aria-busy", "false");
    signInSplash.hidden = true;
    canvasContent.hidden = false;
}

// canvas-server.mjs gives AzureAuth 15 minutes plus a minute of process overhead,
// and the Microsoft flow self-fails after 5, so 16 minutes is the longest the
// server can report "running". The client polls past that ceiling so the server
// always reaches a terminal status first: a deadline at exactly the ceiling can
// expire in the same instant the server times out and report a false timeout for
// a sign-in that actually resolved.
const AUTH_SERVER_CEILING_MS = 16 * 60 * 1000;
const AUTH_POLL_LIMIT_MS = AUTH_SERVER_CEILING_MS + 60 * 1000;
const SILENT_AUTH_POLL_LIMIT_MS = 30 * 1000;
const AUTH_POLL_INTERVAL_MS = 750;

async function waitForAuthentication(onStatus = renderAuthOutput, pollLimitMs = AUTH_POLL_LIMIT_MS) {
    // Deadline-based rather than a fixed attempt count so request latency counts
    // against wall clock, and polled up front so an already-finished sign-in is
    // not held behind an interval that no longer has anything to wait for.
    const deadline = Date.now() + pollLimitMs;
    for (;;) {
        const data = await request("/api/auth/status");
        onStatus(data.authProcess);
        if (data.authProcess?.status !== "running") {
            return data;
        }
        if (Date.now() >= deadline) {
            throw new Error("Sign-in timed out. Try again.");
        }
        await new Promise((resolve) => setTimeout(resolve, AUTH_POLL_INTERVAL_MS));
    }
}

async function finishSilentAuthentication(authProcess) {
    if (authProcess?.mode !== "silent") {
        return;
    }
    showStartupLoading("Signing in", "Restoring the Azure DevOps session.");
    const data = authProcess.status === "running"
        ? await waitForAuthentication(() => {}, SILENT_AUTH_POLL_LIMIT_MS)
        : await request("/api/auth/status");
    if (data.auth) {
        currentConfig.auth = data.auth;
    }
    if (data.authProcess?.status === "succeeded") {
        addLog("trace", "Silent AzureAuth sign-in succeeded.");
    } else {
        addLog("trace", "Silent AzureAuth sign-in was unavailable; showing sign-in options.");
    }
}

async function startAuth(provider) {
    signInMicrosoftButton.disabled = true;
    signInAgencyButton.disabled = true;
    const providerLabel = provider === "microsoft" ? "Microsoft" : "Agency";
    renderAuthOutput({ provider, status: "running", output: `Starting ${providerLabel} sign-in...` });
    addLog("trace", `Starting ${providerLabel} sign-in.`);
    try {
        let data = await request("/api/auth/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider }),
        });
        renderAuthOutput(data.authProcess);
        if (data.authProcess?.status === "running") {
            data = await waitForAuthentication();
        }
        if (data.authProcess?.status === "succeeded") {
            addLog("trace", `${providerLabel} sign-in succeeded.`);
            renderAuthOutput(null);
            await refresh();
            return;
        }
        addLog("error", `${providerLabel} sign-in did not complete successfully.`, data.authProcess?.output || "");
    } catch (error) {
        addLog("error", `${providerLabel} sign-in failed.`, error.message || "");
        renderAuthOutput({ provider, status: "failed", output: error.message || `${providerLabel} sign-in failed.` });
    } finally {
        signInMicrosoftButton.disabled = false;
        signInAgencyButton.disabled = false;
    }
}

async function signOut() {
    if (!confirmDiscard(tabs)) {
        return;
    }
    signOutButton.disabled = true;
    try {
        const data = await request("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        renderAuthOutput(data.authProcess);
        addLog("trace", "Signed out and cleared local preferences.");
        resetTabs();
        await refresh();
    } catch (error) {
        addLog("error", "Failed to sign out.", error.message || "");
    } finally {
        signOutButton.disabled = false;
    }
}

// Azure DevOps rejects edits to a completed or abandoned pull request, so the
// canvas does not offer them rather than surfacing a server error after the fact.
function canEditPullRequest(pr) {
    return String(pr?.status || "").toLowerCase() === "active";
}

function renderWorkItemTab(tab) {
    renderWorkItem(tab.content, tab.data, {
        avatarUrl: profileImageUrl,
        imageUrl: (url) => attachmentImageUrl(url, tabEntry(tab)),
        onOpenWorkItem: (item) => openWorkItem(item, tabEntry(tab)),
        onOpenPullRequest: (relation) => openPullRequestRelation(relation, tabEntry(tab)),
        canEdit: true,
        editMode: tab.editMode,
        onDirtyChange: (dirty) => {
            tab.dirty = dirty;
        },
        onEdit: () => setEditMode(tab, true, renderWorkItemTab),
        onCancelEdit: () => setEditMode(tab, false, renderWorkItemTab),
        // Keyboard submit from inside a field, so it goes through the same button
        // the user would otherwise click and inherits its busy and error handling.
        onSubmit: () => tab.content.querySelector(".editor-save")?.click(),
        onSave: (fields) => saveWorkItemFields(tab, fields),
        onAddComment: (content) => postWorkItemComment(tab, content),
        commentDraft: tab.commentDraft,
        onCommentDraftChange: (draft) => {
            tab.commentDraft = draft.content ? draft : null;
        },
        onSearchIdentities: (query) => request(
            `/api/identities${connectionQuery(tabEntry(tab), { query })}`,
        ),
        onDelegateLocal: enabledFeatures.delegation ? () => delegateWorkItemTab(tab, "local") : null,
        delegationPending: tab.delegationPending,
        delegationStatus: tab.delegationStatus,
        delegationError: tab.delegationError,
    });
}

function sourceBoardTab(tab) {
    const boardTabId = tabEntry(tab)?.boardTabId;
    if (!boardTabId) return null;
    return tabs.find((candidate) => candidate.id === boardTabId && tabEntry(candidate)?.view === "board") || null;
}

function renderBoardWorkItemDrawer() {
    const state = boardWorkItemDrawerState;
    if (!state?.data) {
        return;
    }
    const scrollTop = workItemDrawerContent.scrollTop;
    renderWorkItem(workItemDrawerContent, state.data, {
        avatarUrl: profileImageUrl,
        imageUrl: (url) => attachmentImageUrl(url, tabEntry(state.tab)),
        canEdit: true,
        editMode: state.editMode,
        onOpenWorkItem: (item) => openBoardWorkItemDrawer(state.tab, item),
        onOpenPullRequest: (relation) => {
            if (closeBoardWorkItemDrawer()) {
                void openPullRequestRelation(relation, tabEntry(state.tab));
            }
        },
        onDirtyChange: (dirty) => {
            if (boardWorkItemDrawerState !== state) return;
            state.dirty = dirty;
            state.tab.dirty = dirty;
        },
        onEdit: () => {
            if (boardWorkItemDrawerState !== state) return;
            state.editMode = true;
            state.dirty = false;
            state.tab.dirty = false;
            renderBoardWorkItemDrawer();
        },
        onCancelEdit: () => {
            if (boardWorkItemDrawerState !== state || (state.dirty && !confirmDiscard([state]))) return;
            state.editMode = false;
            state.dirty = false;
            state.tab.dirty = false;
            renderBoardWorkItemDrawer();
        },
        onSubmit: () => workItemDrawerContent.querySelector(".editor-save")?.click(),
        onSave: (fields) => saveBoardWorkItemDrawer(fields),
        onAddComment: (content) => postBoardWorkItemComment(content),
        commentDraft: state.commentDraft,
        onCommentDraftChange: (draft) => {
            if (boardWorkItemDrawerState === state) {
                state.commentDraft = draft.content ? draft : null;
            }
        },
        onSearchIdentities: (query) => request(
            `/api/identities${connectionQuery(tabEntry(state.tab), { query })}`,
        ),
        onDelegateLocal: enabledFeatures.delegation ? () => delegateBoardWorkItem("local") : null,
        delegationPending: state.delegationPending,
        delegationStatus: state.delegationStatus,
        delegationError: state.delegationError,
    });
    workItemDrawerContent.scrollTop = scrollTop;
}

async function loadBoardWorkItemDrawer(state) {
    const entry = tabEntry(state.tab);
    showWorkItemLoading(workItemDrawerContent, state.id);
    try {
        const data = await request(
            `/api/work-items/${encodeURIComponent(state.id)}/details${connectionQuery(entry, {
                workItemProject: state.workItemProject || entry?.project,
            })}`,
        );
        if (boardWorkItemDrawerState !== state) {
            return;
        }
        state.data = data.workItem;
        state.workItemProject = data.workItem?.project || state.workItemProject;
        renderBoardWorkItemDrawer();
        addLog("trace", "Loaded board work item details.", `${data.workItem.type} ${data.workItem.id}: ${data.workItem.title}`);
    } catch (error) {
        if (boardWorkItemDrawerState !== state) {
            return;
        }
        addLog("error", "Failed to load board work item details.", error.message || "");
        showStatus(
            workItemDrawerContent,
            error.message || "Unable to load the work item.",
            () => loadBoardWorkItemDrawer(state),
        );
    }
}

function workItemDrawerBackgroundElements() {
    return [
        startupSplash,
        signInSplash,
        ...[...canvasContent.children].filter((element) => (
            element !== workItemDrawerScrim && element !== workItemDrawer
        )),
        document.querySelector("footer"),
        logsPanel,
    ].filter(Boolean);
}

function setWorkItemDrawerBackgroundHidden(hidden) {
    if (hidden) {
        if (workItemDrawerBackgroundState) return;
        workItemDrawerBackgroundState = new Map();
        for (const element of workItemDrawerBackgroundElements()) {
            workItemDrawerBackgroundState.set(element, {
                inert: element.hasAttribute("inert"),
                ariaHidden: element.getAttribute("aria-hidden"),
            });
            element.setAttribute("inert", "");
            element.setAttribute("aria-hidden", "true");
        }
        return;
    }
    if (!workItemDrawerBackgroundState) return;
    for (const [element, state] of workItemDrawerBackgroundState) {
        if (!state.inert) element.removeAttribute("inert");
        if (state.ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", state.ariaHidden);
    }
    workItemDrawerBackgroundState = null;
}

function trapWorkItemDrawerFocus(event) {
    if (event.key !== "Tab" || !boardWorkItemDrawerState) return;
    const focusable = [...workItemDrawer.querySelectorAll(focusableSelector)]
        .filter((element) => !element.closest("[hidden]"));
    if (!focusable.length) {
        event.preventDefault();
        workItemDrawer.focus();
        return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const target = !workItemDrawer.contains(active)
        ? (event.shiftKey ? last : first)
        : event.shiftKey && active === first
            ? last
            : !event.shiftKey && active === last
                ? first
                : null;
    if (target) {
        event.preventDefault();
        target.focus();
    }
}

async function openBoardWorkItemDrawer(tab, workItem) {
    const item = typeof workItem === "object" && workItem ? workItem : { id: workItem };
    const id = Number(item.id);
    if (!Number.isInteger(id) || id <= 0 || tabEntry(tab)?.view !== "board") {
        return;
    }
    const previous = boardWorkItemDrawerState;
    if (previous?.dirty && (previous.id !== id || previous.tab !== tab) && !confirmDiscard([previous])) {
        return;
    }
    if (previous?.tab && previous.tab !== tab) {
        previous.tab.dirty = false;
    }
    const state = {
        tab,
        id,
        workItemProject: item.project || tabEntry(tab)?.project || "",
        data: null,
        editMode: false,
        dirty: false,
        commentDraft: null,
        delegationPending: false,
        delegationStatus: "",
        delegationError: "",
        returnFocus: previous?.returnFocus || document.activeElement,
    };
    boardWorkItemDrawerState = state;
    setWorkItemDrawerBackgroundHidden(true);
    workItemDrawerScrim.hidden = false;
    workItemDrawer.hidden = false;
    window.requestAnimationFrame(() => {
        if (boardWorkItemDrawerState !== state) return;
        workItemDrawerScrim.classList.add("open");
        workItemDrawer.classList.add("open");
        workItemDrawerClose.focus();
    });
    await loadBoardWorkItemDrawer(state);
}

function closeBoardWorkItemDrawer(force = false) {
    const state = boardWorkItemDrawerState;
    if (!state) {
        return true;
    }
    if (!force && state.dirty && !confirmDiscard([state])) {
        return false;
    }
    state.tab.dirty = false;
    boardWorkItemDrawerState = null;
    workItemDrawerScrim.classList.remove("open");
    workItemDrawer.classList.remove("open");
    setWorkItemDrawerBackgroundHidden(false);
    setTimeout(() => {
        if (boardWorkItemDrawerState) return;
        workItemDrawerScrim.hidden = true;
        workItemDrawer.hidden = true;
        workItemDrawerContent.replaceChildren();
    }, 180);
    state.returnFocus?.focus?.();
    return true;
}

async function saveBoardWorkItemDrawer(fields) {
    const state = boardWorkItemDrawerState;
    if (!state?.data) return;
    if (!fields.length) {
        state.editMode = false;
        state.dirty = false;
        state.tab.dirty = false;
        renderBoardWorkItemDrawer();
        return;
    }
    const entry = tabEntry(state.tab);
    const data = await request(
        `/api/work-items/${encodeURIComponent(state.id)}${connectionQuery(entry, {
            workItemProject: state.workItemProject || entry?.project,
        })}`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rev: state.data.rev, fields }),
        },
    );
    if (boardWorkItemDrawerState !== state) return;
    state.data = data.workItem;
    state.editMode = false;
    state.dirty = false;
    state.tab.dirty = false;
    renderBoardWorkItemDrawer();
    addLog("trace", "Saved board work item changes.", `Work item #${state.id}`);
}

async function postBoardWorkItemComment(content) {
    const state = boardWorkItemDrawerState;
    if (!state?.data) return;
    const entry = tabEntry(state.tab);
    const data = await request(
        `/api/work-items/${encodeURIComponent(state.id)}/comments${connectionQuery(entry, {
            workItemProject: state.workItemProject || entry?.project,
        })}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
        },
    );
    if (boardWorkItemDrawerState !== state) return;
    state.data = data.workItem;
    state.commentDraft = null;
    renderBoardWorkItemDrawer();
    addLog("trace", "Added a board work item comment.", `Work item #${state.id}`);
}

function sendBoardDelegation(boardTab, id, mode) {
    const frameWindow = boardTab.frame?.contentWindow;
    if (!frameWindow) {
        return Promise.reject(new Error("The board is not ready."));
    }
    boardDelegationSequence += 1;
    const requestId = `delegate-${boardDelegationSequence}`;
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            pendingBoardDelegations.delete(requestId);
            reject(new Error("Delegation did not finish in time."));
        }, 120_000);
        timeout.unref?.();
        pendingBoardDelegations.set(requestId, {
            tab: boardTab,
            source: frameWindow,
            resolve,
            reject,
            timeout,
        });
        frameWindow.postMessage({
            source: "azure-devops-canvas",
            type: "delegate-work-item",
            requestId,
            mode,
            id,
        }, window.location.origin);
    });
}

async function delegateBoardWorkItem(mode) {
    const state = boardWorkItemDrawerState;
    if (!state || state.delegationPending) return;
    state.delegationPending = true;
    state.delegationStatus = mode === "local" ? "Starting local delegation…" : "Starting cloud delegation…";
    state.delegationError = "";
    renderBoardWorkItemDrawer();
    try {
        const result = await sendBoardDelegation(state.tab, state.id, mode);
        if (boardWorkItemDrawerState !== state) return;
        state.delegationPending = false;
        if (result?.cancelled) {
            state.delegationStatus = "";
        } else if (!result?.ok) {
            state.delegationStatus = "";
            state.delegationError = result?.error || "Delegation failed.";
        } else {
            state.delegationStatus = mode === "local"
                ? "Delegated to a local Copilot session."
                : "Delegated to a Copilot cloud agent.";
            if (result.state && state.data) state.data.state = result.state;
        }
        if (["cloud_repo_missing", "repo_unreachable"].includes(result?.code)) {
            closeBoardWorkItemDrawer(true);
            return;
        }
        renderBoardWorkItemDrawer();
    } catch (error) {
        if (boardWorkItemDrawerState !== state) return;
        state.delegationPending = false;
        state.delegationStatus = "";
        state.delegationError = error.message || "Delegation failed.";
        renderBoardWorkItemDrawer();
    }
}

async function delegateWorkItemTab(tab, mode) {
    const boardTab = sourceBoardTab(tab);
    if (tab.delegationPending) return;
    tab.delegationPending = true;
    tab.delegationStatus = mode === "local" ? "Starting local delegation…" : "Starting cloud delegation…";
    tab.delegationError = "";
    renderWorkItemTab(tab);
    try {
        let result = boardTab
            ? await sendBoardDelegation(boardTab, tab.data.id, mode)
            : await sendWorkItemDelegation(tab, mode);
        if (!boardTab && ["in_flight", "already_linked"].includes(result?.code) && window.confirm(
            `#${tab.data.id} already has work in flight.\n\nStart another session anyway? Two agents editing the same code at once can overwrite each other's work.`,
        )) {
            result = await sendWorkItemDelegation(tab, mode, true);
        }
        if (!tabs.includes(tab) || (boardTab && sourceBoardTab(tab) !== boardTab)) return;
        tab.delegationPending = false;
        if (result?.cancelled) {
            tab.delegationStatus = "";
        } else if (!result?.ok) {
            tab.delegationStatus = "";
            tab.delegationError = result?.error || "Delegation failed.";
        } else {
            tab.delegationStatus = mode === "local"
                ? "Delegated to a local Copilot session."
                : "Delegated to a Copilot cloud agent.";
            if (result.state && tab.data) tab.data.state = result.state;
        }
        if (["cloud_repo_missing", "repo_unreachable"].includes(result?.code)) {
            if (boardTab) {
                await activateTab(boardTab.id);
            } else {
                renderWorkItemTab(tab);
            }
            return;
        }
        renderWorkItemTab(tab);
    } catch (error) {
        if (!tabs.includes(tab) || (boardTab && sourceBoardTab(tab) !== boardTab)) return;
        tab.delegationPending = false;
        tab.delegationStatus = "";
        tab.delegationError = error.message || "Delegation failed.";
        renderWorkItemTab(tab);
    }
}

function sendWorkItemDelegation(tab, mode, force = false) {
    const entry = tabEntry(tab);
    return request(
        `/api/work-items/${encodeURIComponent(tab.data.id)}/delegate${connectionQuery(entry, {
            workItemProject: tab.data.project || entry?.workItemProject || entry?.project,
        })}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode, force }),
        },
    );
}

async function postWorkItemComment(tab, content) {
    const entry = tabEntry(tab);
    const data = await request(
        `/api/work-items/${encodeURIComponent(tab.data.id)}/comments${connectionQuery(entry, { workItemProject: tab.data.project })}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
        },
    );
    tab.data = data.workItem;
    tab.commentDraft = null;
    renderWorkItemTab(tab);
    renderTabBar();
    addLog("trace", "Added a work item comment.", `Work item #${tab.data.id}`);
}

// Entering or leaving edit mode re-renders the whole detail view, so unsaved work
// is confirmed first.
function setEditMode(tab, editMode, render) {
    if (tab.editMode === editMode || (!editMode && !confirmDiscard([tab]))) {
        return;
    }
    tab.editMode = editMode;
    tab.dirty = false;
    render(tab);
}

async function saveWorkItemFields(tab, fields) {
    // Nothing was touched, so there is nothing to write; leaving edit mode is the
    // whole of the save.
    if (!fields.length) {
        tab.editMode = false;
        tab.dirty = false;
        renderWorkItemTab(tab);
        return;
    }
    const entry = tabEntry(tab);
    const data = await request(`/api/work-items/${encodeURIComponent(tab.data.id)}${connectionQuery(entry, { workItemProject: tab.data.project })}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Every changed field goes in one patch, so the revision test covers the
        // whole edit rather than each field racing separately.
        body: JSON.stringify({ rev: tab.data.rev, fields }),
    });
    tab.data = data.workItem;
    tab.editMode = false;
    tab.dirty = false;
    // tab.rendered marks which entry the tab shows, which a save does not change;
    // the refreshed payload replaces the cached one in tab.data instead.
    renderWorkItemTab(tab);
    renderTabBar();
    addLog("trace", "Saved work item changes.", `${data.workItem.type} ${data.workItem.id}: ${fields.map((field) => field.name).join(", ")}`);
}

function loadedWorkItemTab(tab, workItem, entry) {
    tab.data = workItem;
    // A reference-opened tab has no id of its own, so the entry is adopted rather
    // than rebuilt; otherwise the rendered marker would never match the entry.
    tab.rendered = entry?.current
        ? entry
        : { ...entry, view: "work-item", id: Number(workItem.id) || 0 };
    tab.editMode = false;
    tab.dirty = false;
    renderWorkItemTab(tab);
}

async function loadWorkItemIntoTab(tab, entry, token) {
    const id = Number(entry.id) || 0;
    showWorkItemLoading(tab.content, id);
    // The panel now shows a placeholder, so nothing is rendered until this resolves.
    tab.rendered = null;
    try {
        // A canvas opened on a work item carries the reference server-side, so the
        // id is not known here until the item itself has been fetched.
        const data = await request(entry.current
            ? "/api/current-work-item"
            : `/api/work-items/${encodeURIComponent(id)}/details${connectionQuery(entry, { workItemProject: entry.workItemProject })}`);
        if (token !== tab.token) {
            return;
        }
        loadedWorkItemTab(tab, data.workItem, entry);
        addLog("trace", "Loaded work item details.", `${data.workItem.type} ${data.workItem.id}: ${data.workItem.title}`);
    } catch (error) {
        if (token !== tab.token) {
            return;
        }
        tab.data = null;
        tab.rendered = null;
        addLog("error", "Failed to load work item details.", error.message || "");
        showStatus(tab.content, error.message || "Unable to load the work item.", () => loadWorkItemIntoTab(tab, entry, tab.token));
    }
}

// Every item opens in its own tab, including links followed from inside another
// item, so any number of work items and pull requests can be open at once. A
// link followed from inside an item stays on that item's connection.
function openWorkItem(workItem, entry) {
    const item = typeof workItem === "object" && workItem
        ? workItem
        : { id: workItem };
    return openEntry(entryForConnection(
        "work-item",
        item.id,
        entry,
        {
            workItemProject: item.project || "",
            boardTabId: item.boardTabId || entry?.boardTabId || "",
        },
    ));
}

function profileImageUrl(imageUrl) {
    if (!imageUrl) {
        return "";
    }
    return `/api/avatar?${new URLSearchParams({ url: imageUrl, nonce: apiNonce })}`;
}

const ATTACHMENT_IMAGE_SOURCE =
    /^https:\/\/[^/]+\/(?:[^/]+\/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/_apis\/wit\/attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:[?#]|$)/i;

function attachmentImageUrl(imageUrl, entry) {
    if (!apiNonce || !ATTACHMENT_IMAGE_SOURCE.test(imageUrl)) return imageUrl;
    return `/api/attachment${connectionQuery(entry, { url: imageUrl, nonce: apiNonce })}`;
}

function renderPullRequestTab(tab) {
    tab.replyDrafts ||= {};
    renderPullRequest(tab.content, tab.data, {
        avatarUrl: profileImageUrl,
        imageUrl: (url) => attachmentImageUrl(url, tabEntry(tab)),
        timelineFilter: tab.timelineFilter,
        canEdit: canEditPullRequest(tab.data),
        editMode: tab.editMode,
        relatedWorkItems: tab.relatedWorkItems,
        commentDraft: tab.commentDraft,
        replyDrafts: tab.replyDrafts,
        onCommentDraftChange: (draft) => {
            tab.commentDraft = draft.content ? draft : null;
        },
        onReplyDraftChange: (threadId, draft) => {
            if (draft.content) tab.replyDrafts[threadId] = draft;
            else delete tab.replyDrafts[threadId];
        },
        // Azure DevOps rejects roster and link changes on a pull request that is
        // no longer active, so those controls follow the same gate as editing.
        canManageReviewers: canEditPullRequest(tab.data),
        canManageWorkItems: canEditPullRequest(tab.data),
        onDirtyChange: (dirty) => {
            tab.dirty = dirty;
        },
        onEdit: () => setEditMode(tab, true, renderPullRequestTab),
        onCancelEdit: () => setEditMode(tab, false, renderPullRequestTab),
        onSubmit: () => tab.content.querySelector(".editor-save")?.click(),
        onSave: (patch) => savePullRequest(tab, patch),
        onVote: (vote) => pullRequestAction(tab, "vote", "POST", { vote }, `Recorded the ${vote} vote.`),
        onAddComment: (content) => pullRequestAction(
            tab,
            "comments",
            "POST",
            { content },
            "Added a pull request comment.",
            {
                timelineFilter: "comments",
                beforeRender: () => { tab.commentDraft = null; },
            },
        ),
        onReplyComment: (threadId, parentCommentId, content) => pullRequestAction(
            tab,
            `threads/${threadId}/comments`,
            "POST",
            { parentCommentId, content },
            `Replied to discussion ${threadId}.`,
            {
                timelineFilter: "comments",
                beforeRender: () => { delete tab.replyDrafts[threadId]; },
            },
        ),
        onSetThreadStatus: (threadId, status) => pullRequestAction(
            tab,
            `threads/${threadId}`,
            "PATCH",
            { status },
            `${status === "fixed" ? "Resolved" : "Reopened"} discussion ${threadId}.`,
            { timelineFilter: status === "fixed" ? "resolved" : "active" },
        ),
        onFixComment: async (threadId, commentId) => {
            await request(
                `/api/pull-requests/${encodeURIComponent(tab.data.id)}/fix-comment${connectionQuery(tabEntry(tab))}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ threadId, commentId }),
                },
            );
            addLog("trace", `Sent discussion ${threadId} to Copilot for fixing.`);
        },
        onStateAction: (action) => pullRequestStateAction(tab, action),
        onSetReviewer: (reviewerId, isRequired) => pullRequestAction(
            tab,
            "reviewers",
            "PUT",
            { reviewerId, isRequired },
            `Updated reviewer ${reviewerId}.`,
        ),
        onRemoveReviewer: (reviewerId) => pullRequestAction(
            tab,
            "reviewers/remove",
            "POST",
            { reviewerId },
            `Removed reviewer ${reviewerId}.`,
        ),
        onLinkWorkItem: (workItemId) => pullRequestAction(
            tab,
            "work-items",
            "POST",
            { workItemId },
            `Linked work item #${workItemId}.`,
        ),
        onUnlinkWorkItem: (workItemId) => pullRequestAction(
            tab,
            "work-items/remove",
            "POST",
            { workItemId },
            `Unlinked work item #${workItemId}.`,
        ),
        onOpenWorkItem: (item) => openWorkItem(item, tabEntry(tab)),
        onViewInAzureDevOps: (url) => window.open(url, "_blank", "noopener,noreferrer"),
        onSearchIdentities: (query) => request(
            `/api/identities${connectionQuery(tabEntry(tab), { query })}`,
        ),
        onSearchWorkItems: (query) => request(
            `/api/work-item-search${connectionQuery(tabEntry(tab), { query })}`,
        ),
        onFilter: (filter) => {
            tab.timelineFilter = filter;
            renderPullRequestTab(tab);
        },
    });
}

// The state menu is three different routes wearing one label, because Azure
// DevOps models draft, abandon, and complete as separate operations.
function pullRequestStateAction(tab, action) {
    if (action === "mark-draft" || action === "publish") {
        return pullRequestAction(
            tab,
            "draft",
            "POST",
            { isDraft: action === "mark-draft" },
            action === "mark-draft" ? "Marked the pull request as a draft." : "Published the pull request.",
        );
    }
    if (action === "complete") {
        return pullRequestAction(tab, "complete", "POST", {}, "Completed the pull request.");
    }
    return pullRequestAction(tab, "status", "POST", { action }, `Set the pull request to ${action}.`);
}

// Every pull request action returns the refreshed pull request, so the tab is
// re-rendered from the server's answer rather than from an optimistic guess.
async function pullRequestAction(tab, path, method, body, logMessage, options = {}) {
    const data = await request(
        `/api/pull-requests/${encodeURIComponent(tab.data.id)}/${path}${connectionQuery(tabEntry(tab))}`,
        {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        },
    );
    tab.data = data.pullRequest || tab.data;
    if (data.relatedWorkItems) {
        tab.relatedWorkItems = data.relatedWorkItems;
    }
    if (options.timelineFilter) {
        tab.timelineFilter = options.timelineFilter;
    }
    options.beforeRender?.();
    renderPullRequestTab(tab);
    renderTabBar();
    addLog("trace", logMessage, `PR !${tab.data.id}`);
    return data;
}

async function savePullRequest(tab, patch) {
    if (!Object.keys(patch).length) {
        tab.editMode = false;
        tab.dirty = false;
        renderPullRequestTab(tab);
        return;
    }
    const data = await request(`/api/pull-requests/${encodeURIComponent(tab.data.id)}${connectionQuery(tabEntry(tab))}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
    });
    tab.data = data.pullRequest;
    tab.editMode = false;
    tab.dirty = false;
    renderPullRequestTab(tab);
    renderTabBar();
    addLog("trace", "Saved pull request changes.", `PR !${tab.data.id}: ${Object.keys(patch).join(", ")}`);
}

// Resolves the pull request the canvas should lead with. Without a pull request
// reference that is the checked-out branch's, which Home shows in its branch
// section and the tab bar marks; with one it is the referenced pull request,
// which says nothing about the branch, so no tab is marked in that case.
async function loadLeadPullRequest({ isReference }) {
    try {
        const data = await request("/api/current-pull-request");
        branchPullRequestInfo = {
            sourceRefName: data.sourceRefName || data.pullRequest?.sourceRefName || "",
            createPullRequestUrl: data.canCreatePullRequest ? data.createPullRequestUrl || "" : "",
            pullRequest: data.pullRequest || null,
            relatedWorkItems: data.relatedWorkItems || { workItems: [], count: 0, error: "" },
            development: data.development || { pipelineRuns: [], count: 0, error: "" },
            isDefaultBranch: Boolean(data.isDefaultBranch),
            repository: data.repository || null,
        };
        branchPullRequestId = isReference ? 0 : Number(data.pullRequest?.id) || 0;
        addLog(
            "trace",
            data.pullRequest ? "Loaded current pull request." : "No pull request for the current branch.",
            data.pullRequest ? `PR !${data.pullRequest.id}: ${data.pullRequest.title}` : data.sourceRefName || "",
        );
    } catch (error) {
        branchPullRequestId = 0;
        // Distinct from "no pull request yet": the check itself did not complete.
        branchPullRequestInfo = {
            sourceRefName: "",
            createPullRequestUrl: "",
            pullRequest: null,
            relatedWorkItems: { workItems: [], count: 0, error: "" },
            development: { pipelineRuns: [], count: 0, error: "" },
            isDefaultBranch: false,
            repository: null,
            error: error.message || "Unable to check for a pull request.",
        };
        addLog("error", "Failed to load current branch pull request.", error.message || "");
    }
}

async function requestNewSessionBranch() {
    const data = await request("/api/new-session-branch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
    });
    addLog("trace", "Sent a branch creation request to chat.");
    return data;
}

async function delegateHomeWorkItem(item, connection = null, force = false) {
    const entry = entryForConnection(
        "work-item",
        item.id,
        connection || defaultEntryConnection(),
        { workItemProject: item.project || "" },
    );
    let result = await request(
        `/api/work-items/${encodeURIComponent(item.id)}/delegate${connectionQuery(entry, {
            workItemProject: item.project || entry.project,
        })}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "local", force }),
        },
    );
    if (!force && ["in_flight", "already_linked"].includes(result?.code)) {
        if (!window.confirm(
            `#${item.id} already has work in flight.\n\nStart another session anyway? Two agents editing the same code at once can overwrite each other's work.`,
        )) {
            return { cancelled: true };
        }
        result = await delegateHomeWorkItem(item, connection, true);
    }
    if (result?.ok) {
        addLog("trace", "Sent a work item delegation request.", `Work item ${item.id}`);
    }
    return result;
}

async function loadHome() {
    if (!homeContent.querySelector(".home-loading-state")) {
        showLoading(
            homeContent,
            "Loading your Azure DevOps work",
            enabledFeatures.boards
                ? "Fetching pull requests, favorite boards, and work items."
                : "Fetching pull requests and work items.",
            { className: "home-loading-state" },
        );
    }
    try {
        const branchMode = Boolean(
            currentConfig.remote?.isAzureDevOps
            && currentConfig.branch
            && !currentConfig.pullRequestReference,
        );
        const data = await request("/api/home");
        homeLoaded = true;
        renderHome(homeContent, data, {
            // The branch section is about the checked-out repository, so it only
            // belongs on Home when that repository has an Azure DevOps remote.
            // A directly referenced pull request is not necessarily that branch.
            hasRemoteConnection: Boolean(
                currentConfig?.remote?.isAzureDevOps
                && !currentConfig.pullRequestReference,
            ),
            branchPullRequest: branchPullRequestInfo?.pullRequest || null,
            branchName: branchMode
                ? branchPullRequestInfo?.sourceRefName || currentConfig.branch
                : "",
            branchScope: branchPullRequestInfo?.repository?.name || currentConfig.repositoryId || "",
            relatedWorkItems: branchPullRequestInfo?.relatedWorkItems || { workItems: [], count: 0, error: "" },
            development: branchPullRequestInfo?.development || { pipelineRuns: [], count: 0, error: "" },
            isDefaultBranch: Boolean(branchPullRequestInfo?.isDefaultBranch),
            createPullRequestUrl: branchPullRequestInfo?.createPullRequestUrl || "",
            branchError: branchPullRequestInfo?.error || "",
            showNewBranchAction: !currentConfig.branch,
            onRetryBranch: refresh,
            onCreateBranch: requestNewSessionBranch,
            onOpenBoard: enabledFeatures.boards ? openHomeBoard : null,
            onOpenPullRequest: openPullRequest,
            onDelegateWorkItem: enabledFeatures.delegation ? delegateHomeWorkItem : null,
            onOpenWorkItem: openHomeWorkItem,
            onChooseProject: openConnectionPanel,
        });
        addLog(
            "trace",
            "Loaded Azure DevOps home overview.",
            [
                ...(data.connections || []).map((connection) =>
                    `${[connection.organization, connection.project].filter(Boolean).join("/")}: ${connection.myPullRequests?.pullRequests?.length || 0} pull requests, ${connection.myBoards?.boards?.length || 0} boards, ${connection.myWorkItems?.workItems?.length || 0} work items`),
                branchMode
                    ? `${branchPullRequestInfo?.relatedWorkItems?.workItems?.length || 0} related work items`
                    : "",
            ].filter(Boolean).join(", "),
        );
    } catch (error) {
        homeLoaded = false;
        addLog("error", "Failed to load the Azure DevOps home overview.", error.message || "");
        showStatus(homeContent, error.message || "Failed to load your Azure DevOps work.", loadHome);
    }
}

async function loadPullRequestIntoTab(tab, id, token) {
    showPullRequestLoading(tab.content, id);
    tab.rendered = null;
    const entry = tabEntry(tab);
    try {
        const data = await request(`/api/pull-requests/${encodeURIComponent(id)}${connectionQuery(entry)}`);
        if (token !== tab.token) {
            return;
        }
        tab.data = data.pullRequest;
        tab.relatedWorkItems = data.relatedWorkItems || { workItems: [], count: 0, error: "" };
        tab.rendered = { ...entry, view: "pull-request", id: Number(data.pullRequest?.id) || 0 };
        tab.timelineFilter = "all";
        tab.editMode = false;
        tab.dirty = false;
        renderPullRequestTab(tab);
        addLog("trace", "Loaded pull request details.", `PR !${tab.data.id}: ${tab.data.title}`);
    } catch (error) {
        if (token !== tab.token) {
            return;
        }
        tab.data = null;
        tab.rendered = null;
        addLog("error", "Failed to load pull request details.", error.message || "");
        showPullRequestError(
            tab.content,
            error.message || "Unable to load the pull request.",
            () => loadPullRequestIntoTab(tab, id, tab.token),
        );
    }
}

// Home is an index, so its rows open their own tabs rather than replacing Home.
// The row's connection travels with it: Home can list two organizations, and a
// row has to be fetched from the one it came from.
function openPullRequest(id, connection) {
    return openEntry(entryForConnection("pull-request", id, connection || defaultEntryConnection()));
}

function openPullRequestRelation(relation, connection) {
    return openEntry(entryForConnection(
        "pull-request",
        Number(relation.identifier),
        connection || defaultEntryConnection(),
        {
            pullRequestProject: relation.projectId || "",
            pullRequestRepositoryId: relation.repositoryId || "",
        },
    ));
}

// An organization-scope work item list spans projects, so the row carries the
// project the item actually lives in; the connection alone does not know it.
function openHomeWorkItem(workItem, connection) {
    return openEntry(entryForConnection(
        "work-item",
        workItem.id,
        connection || defaultEntryConnection(),
        { workItemProject: workItem.project || "" },
    ));
}

function openHomeBoard(board, connection) {
    return openEntry({
        ...entryForConnection("board", board.id, connection || defaultEntryConnection()),
        name: board.name || "Board",
    });
}

// A tab opened from somewhere other than a Home row - a link inside a pull
// request, or the canvas's own pull request reference - belongs to the canvas's
// primary connection.
function defaultEntryConnection() {
    return currentConfig?.connections?.[0] || null;
}

function resetTabs() {
    for (const tab of tabs) {
        releaseBoardTab(tab);
        if (tab.panel !== homePanel) {
            tab.panel.remove();
        }
    }
    tabs = [];
    activeTabId = "";
    homePanel.hidden = true;
    tabPanels.replaceChildren();
}

// Paints a canvas-level message into whichever panel is actually reachable.
// Writing it into a hidden panel leaves the user with a blank pane.
function showCanvasStatus(message, retry) {
    const tab = activeTab();
    if (tab && tab.panel !== homePanel) {
        showStatus(tab.content, message, retry);
        return;
    }
    resetTabs();
    homeLoaded = false;
    createTab({ view: "home" }, { closable: false });
    activeTabId = tabs[0].id;
    renderTabBar();
    showActivePanel();
    showStatus(homeContent, message, retry);
}

// --- Connections -----------------------------------------------------------

// The picker's own state, kept here rather than in the view so the view can be
// patched without owning what the user has typed. The view is built once per
// open and returns a handle that patches it; rebuilding it on every change
// would destroy the field being typed in and swallow clicks on Save.
let connectionState = null;
let connectionPanelView = null;

function renderConnections() {
    if (!connectionState || !connectionPanelView) {
        return;
    }
    connectionPanelView.update({
        ...connectionState,
        connections: currentConfig?.connections || [],
        hasDefault: Boolean(currentConfig?.hasDefaultConnection),
    });
}

// Organizations come from the accounts API, which some tenants refuse; the
// picker keeps working on typed names in that case, so the failure is shown as
// a hint next to the field rather than as an error.
async function loadConnectionOrganizations() {
    try {
        const data = await request("/api/organizations");
        // The picker may have been closed while this was in flight, and its state
        // is gone with it.
        if (!connectionState) {
            return;
        }
        connectionState.organizations = (data.organizations || []).map((entry) => entry.name);
        connectionState.organizationsError = data.error || "";
    } catch (error) {
        if (!connectionState) {
            return;
        }
        connectionState.organizations = [];
        connectionState.organizationsError = error.message || "";
    }
    renderConnections();
}

// Projects and repositories are both optional, so a failure to list them is not
// reported: the user can still type one, or leave it empty.
async function loadConnectionOptions() {
    const organization = connectionState.draft.organization;
    if (!organization) {
        connectionState.projects = [];
        connectionState.repositories = [];
        renderConnections();
        return;
    }
    connectionState.loading = "options";
    renderConnections();
    const query = new URLSearchParams({ organization });
    const [projectResult, repositoryResult] = await Promise.allSettled([
        request(`/api/projects?${query}`),
        request(`/api/repositories?${query}`),
    ]);
    // A slower request must not overwrite options for an organization the user
    // has since changed to, or for a picker they have since closed.
    if (!connectionState || connectionState.draft.organization !== organization) {
        return;
    }
    connectionState.projects = projectResult.status === "fulfilled"
        ? (projectResult.value.projects || []).map((project) => project.name)
        : [];
    connectionState.repositories = repositoryResult.status === "fulfilled"
        ? (repositoryResult.value.repositories || []).map((repository) => repository.name)
        : [];
    connectionState.loading = "";
    renderConnections();
}

function openConnectionPanel(connection) {
    const current = connection || currentConfig?.connections?.[0] || null;
    connectionState = {
        draft: {
            organization: current?.organization || "",
            project: current?.project || "",
            repositoryId: current?.repositoryId || "",
            isDefault: Boolean(current?.isDefault),
        },
        organizations: [],
        organizationsError: "",
        projects: [],
        repositories: [],
        loadedOptionsFor: "",
        loading: "",
        error: "",
        saving: false,
        firstRun: !(currentConfig?.connections || []).length,
    };
    connectionPanel.hidden = false;
    connectionsButton.setAttribute("aria-expanded", "true");
    connectionPanelView = renderConnectionPanel(connectionPanel, {
        ...connectionState,
        connections: currentConfig?.connections || [],
        hasDefault: Boolean(currentConfig?.hasDefaultConnection),
    }, {
        onDraftChange: (patch) => {
            // Typing only updates state and patches the panel: the dependent
            // lists wait for the organization field to settle.
            connectionState.draft = { ...connectionState.draft, ...patch };
            connectionState.error = "";
            renderConnections();
        },
        onOrganizationCommitted: (organization) => {
            if (connectionState.loadedOptionsFor === organization) {
                return;
            }
            connectionState.loadedOptionsFor = organization;
            // A project or repository from the previous organization is not a
            // valid choice in this one.
            connectionState.draft = { ...connectionState.draft, organization, project: "", repositoryId: "" };
            renderConnections();
            loadConnectionOptions();
        },
        onSave: saveConnection,
        onClearDefault: clearDefaultConnection,
        onCancel: closeConnectionPanel,
    });
    loadConnectionOrganizations();
    if (connectionState.draft.organization) {
        connectionState.loadedOptionsFor = connectionState.draft.organization;
        loadConnectionOptions();
    }
    // The panel claims to be a modal dialog, so focus moves into it rather than
    // staying on the footer control behind the overlay.
    (connectionPanel.querySelector("input, button") || connectionPanel).focus();
}

function closeConnectionPanel() {
    connectionState = null;
    connectionPanelView = null;
    connectionPanel.replaceChildren();
    connectionPanel.hidden = true;
    connectionsButton.setAttribute("aria-expanded", "false");
    connectionsButton.focus();
}

async function saveConnection() {
    // Read from the fields rather than the draft, so what the user can see in the
    // form is what gets saved even if an engine did not raise the event the field
    // listens for.
    const draft = { ...connectionState.draft, ...connectionPanelView.read() };
    connectionState.draft = draft;
    connectionState.saving = true;
    connectionState.error = "";
    renderConnections();
    try {
        await request("/api/connection", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(draft),
        });
        addLog("trace", "Saved the Azure DevOps connection.", [draft.organization, draft.project].filter(Boolean).join("/"));
        closeConnectionPanel();
        // The connection decides what every other request resolves against, so
        // the canvas is rebuilt rather than patched in place.
        await refresh();
    } catch (error) {
        // The panel stays open with the draft intact: a connection that was not
        // stored must not look like one that was, or the canvas would send the
        // user back to an empty picker with nothing to explain it. Unless the
        // user closed the panel while the save was in flight, in which case the
        // failure only reaches the log.
        addLog("error", "Failed to save the Azure DevOps connection.", error.message || "");
        if (!connectionState) {
            return;
        }
        connectionState.saving = false;
        connectionState.error = error.message || "Could not save the connection.";
        renderConnections();
    }
}

async function clearDefaultConnection() {
    connectionState.saving = true;
    connectionState.error = "";
    renderConnections();
    try {
        await request("/api/connection", { method: "DELETE" });
        addLog("trace", "Cleared the default Azure DevOps connection.");
        closeConnectionPanel();
        await refresh();
    } catch (error) {
        addLog("error", "Failed to clear the default Azure DevOps connection.", error.message || "");
        if (!connectionState) {
            return;
        }
        connectionState.saving = false;
        connectionState.error = error.message || "Could not clear the default connection.";
        renderConnections();
    }
}

async function refresh() {
    // Refresh discards every open tab, so an editor with unsaved text is confirmed
    // before anything is torn down.
    if (!confirmDiscard(tabs)) {
        return;
    }
    refreshButton.disabled = true;
    addLog("trace", "Refreshing canvas.");
    showStartupLoading("Preparing Azure DevOps", "Checking connection and sign-in.");
    try {
        const configResponse = await loadConfig();
        await finishSilentAuthentication(configResponse.authProcess);
        homeLoaded = false;
        if (!currentConfig.auth?.isAuthenticated) {
            showSignInSplash();
            return;
        }
        showCanvas();
        // Refresh deliberately starts over: every open tab is discarded and the
        // canvas is rebuilt from the current config. Tabs are user-managed state,
        // so this is a real cost, but "refresh" here means reset rather than the
        // browser's reload-this-tab, and the footer control is the way back to a
        // known-good canvas when something is stale or wrong.
        resetTabs();
        branchPullRequestInfo = null;
        branchPullRequestId = 0;

        const isWorkItem = Boolean(currentConfig.workItemReference);
        const validReference = currentConfig.pullRequestReference || isWorkItem;
        // No Azure DevOps remote is no longer a dead end. Without a reference and
        // without a saved organization there is simply nothing to read from yet,
        // so the canvas asks for one instead of reporting a missing remote.
        if (!(currentConfig.connections || []).length && !validReference) {
            viewBar.hidden = true;
            resetTabs();
            openConnectionPanel();
            return;
        }
        closeConnectionPanel();
        viewBar.hidden = false;

        const isPullRequestReference = Boolean(currentConfig.pullRequestReference);
        // Put a real visible surface in place before resolving branch context. That
        // request is part of Home, and previously left the authenticated canvas
        // empty until it completed.
        const home = createTab({ view: "home" }, { closable: false });
        activeTabId = home.id;
        showLoading(
            homeContent,
            "Loading your Azure DevOps work",
            enabledFeatures.boards
                ? "Fetching pull requests, favorite boards, and work items."
                : "Fetching pull requests and work items.",
            { className: "home-loading-state" },
        );
        renderTabBar();
        showActivePanel();

        // Resolve branch context before building Home, including when the canvas
        // opens directly on a work item.
        if (isPullRequestReference || (currentConfig.remote?.isAzureDevOps && currentConfig.branch)) {
            await loadLeadPullRequest({ isReference: isPullRequestReference });
        } else {
            branchPullRequestInfo = null;
            branchPullRequestId = 0;
        }

        if (isWorkItem) {
            // Keep Home behind a directly opened work item, matching the pull
            // request flow and giving linked items a stable place to return to.
            // The id lives in the canvas input, so the server resolves it.
            await openEntry({ view: "work-item", id: 0, current: true });
            return;
        }

        const leadPullRequest = branchPullRequestInfo?.pullRequest;
        if (isPullRequestReference && leadPullRequest) {
            // Opened on a pull request: show it, with Home still available behind it.
            await openEntry(entryForConnection("pull-request", leadPullRequest.id, defaultEntryConnection()));
            return;
        }
        await loadHome();
    } catch (error) {
        addLog("error", "Canvas refresh failed.", error.message || "");
        showCanvas();
        viewBar.hidden = false;
        showCanvasStatus(error.message || "Failed to load configuration.", refresh);
    } finally {
        refreshButton.disabled = false;
    }
}

async function refreshActiveTab() {
    const tab = activeTab();
    if (!tab) {
        return refresh();
    }
    if (!confirmDiscard([tab])) {
        return;
    }
    refreshButton.disabled = true;
    addLog("trace", `Refreshing ${tabTitle(tab)}.`);
    try {
        const configResponse = await loadConfig();
        await finishSilentAuthentication(configResponse.authProcess);
        if (!currentConfig.auth?.isAuthenticated) {
            showSignInSplash();
            return;
        }
        showCanvas();
        const entry = tabEntry(tab);
        if (entry.view === "home") {
            homeLoaded = false;
            if (currentConfig.remote?.isAzureDevOps && currentConfig.branch && !currentConfig.pullRequestReference) {
                await loadLeadPullRequest({ isReference: false });
            }
            await loadHome();
            return;
        }
        tab.token += 1;
        const token = tab.token;
        if (entry.view === "pull-request") {
            await loadPullRequestIntoTab(tab, entry.id, token);
        } else {
            await loadWorkItemIntoTab(tab, entry, token);
        }
        renderTabBar();
        showActivePanel();
    } catch (error) {
        addLog("error", `Failed to refresh ${tabTitle(tab)}.`, error.message || "");
        showStatus(tab.content, error.message || `Failed to refresh ${tabTitle(tab)}.`, refreshActiveTab);
    } finally {
        refreshButton.disabled = false;
    }
}

showLogsButton.addEventListener("click", () => {
    logsPanel.hidden = !logsPanel.hidden;
    showLogsButton.textContent = logsPanel.hidden ? "show logs" : "hide logs";
    showLogsButton.setAttribute("aria-expanded", String(!logsPanel.hidden));
    if (!logsPanel.hidden) renderLogs();
});
async function updateFeatureFlags() {
    enabledFeatures = normalizeFeatureFlags({
        boards: boardsFeatureFlag?.checked,
        delegation: delegationFeatureFlag?.checked,
    });
    const data = await request("/api/feature-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(enabledFeatures),
    });
    enabledFeatures = normalizeFeatureFlags(data.featureFlags);
    if (currentConfig) currentConfig.featureFlags = enabledFeatures;
    homeLoaded = false;
    await loadHome();
    const tab = activeTab();
    if (tab && tabEntry(tab)?.view === "work-item" && tab.data) {
        renderWorkItemTab(tab);
    }
    if (boardWorkItemDrawerState?.data) {
        renderBoardWorkItemDrawer();
    }
}
boardsFeatureFlag?.addEventListener("change", () => {
    updateFeatureFlags().catch((error) => addLog("error", "Failed to update preview features.", error.message || ""));
});
delegationFeatureFlag?.addEventListener("change", () => {
    updateFeatureFlags().catch((error) => addLog("error", "Failed to update preview features.", error.message || ""));
});
copyLogsButton.addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(logs.map((entry) => `[${entry.time}] ${entry.level.toUpperCase()}: ${entry.message}${entry.details ? `\n${entry.details}` : ""}`).join("\n\n") || "No logs yet.");
        copyLogsStatus.textContent = "Copied.";
    } catch (error) {
        copyLogsStatus.textContent = "Copy failed.";
        addLog("error", "Failed to copy logs.", error.message || "");
    }
});
refreshButton.addEventListener("click", refreshActiveTab);
connectionsButton.addEventListener("click", () => {
    // With nothing configured the picker is the canvas, so the control focuses it
    // rather than closing it onto a blank pane.
    if (connectionState && !connectionState.firstRun) {
        closeConnectionPanel();
        return;
    }
    openConnectionPanel();
});
// Escape dismisses the dialog, except on first run where closing it would leave
// a blank canvas with nothing configured.
connectionPanel.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && connectionState && !connectionState.firstRun) {
        event.preventDefault();
        closeConnectionPanel();
    }
});
signInMicrosoftButton.addEventListener("click", () => startAuth("microsoft"));
if (AGENCY_AUTH_ENABLED) {
    signInAgencyButton.addEventListener("click", () => startAuth("agency"));
}
signOutButton.addEventListener("click", signOut);
// Middle-click closes a tab, matching the browser convention the tabs imitate.
viewTabs.addEventListener("auxclick", (event) => {
    if (event.button !== 1) {
        return;
    }
    const item = event.target.closest(".view-tab");
    const index = item ? [...viewTabs.children].indexOf(item) : -1;
    if (index >= 0 && tabs[index]) {
        event.preventDefault();
        closeTab(tabs[index].id);
    }
});

addLog("trace", "Azure DevOps canvas loaded.");
refresh().catch((error) => addLog("error", "Canvas startup failed.", error.message || ""));
