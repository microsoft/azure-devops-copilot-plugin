import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";

const DEFAULT_API_VERSION = "7.1";
const PREVIEW_API_VERSION = "7.1-preview";
const DEFAULT_STATUS = "active";
const DEFAULT_LIST_LIMIT = 5;
const AZUREAUTH_TIMEOUT_MINUTES = "15";
const DEFAULT_WIQL =
    "SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType], [System.AssignedTo], [System.ChangedDate] " +
    "FROM WorkItems WHERE [System.TeamProject] = @Project AND [System.State] <> 'Closed' ORDER BY [System.ChangedDate] DESC";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_EXTENSION_REPO_ROOT = resolve(EXTENSION_DIR, "..", "..", "..");
const EXTENSION_VERSION = loadExtensionVersion();
const servers = new Map();
const execFileAsync = promisify(execFile);
let azureAuthTokenCache = null;
let copilotSession;

function loadExtensionVersion() {
    try {
        const manifest = JSON.parse(
            readFileSync(join(PROJECT_EXTENSION_REPO_ROOT, ".claude-plugin", "plugin.json"), "utf8"),
        );
        const version = normalizeString(manifest?.version);
        return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version) ? version : "unknown";
    } catch {
        return "unknown";
    }
}

function normalizeString(value) {
    return typeof value === "string" ? value.trim() : "";
}

function encodePathPart(value) {
    return encodeURIComponent(value).replace(/%20/g, "%20");
}

function parseAzureDevOpsRemoteUrl(remoteUrl) {
    const trimmed = normalizeString(remoteUrl).replace(/\.git$/i, "");
    if (!trimmed) {
        return null;
    }

    const sshMatch = trimmed.match(/^(?:[^@]+@)?ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/(.+)$/i);
    if (sshMatch) {
        const [, organization, project, repository] = sshMatch;
        return {
            organization,
            project,
            repository,
            url: `https://dev.azure.com/${encodePathPart(organization)}/${encodePathPart(project)}/_git/${encodePathPart(repository)}`,
        };
    }

    try {
        const url = new URL(trimmed);
        if (url.hostname.toLowerCase() === "dev.azure.com") {
            const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
            const gitIndex = segments.findIndex((segment) => segment.toLowerCase() === "_git");
            if (gitIndex >= 1 && segments[gitIndex + 1]) {
                const organization = segments[0];
                const repository = segments[gitIndex + 1];
                const project = gitIndex >= 2 ? segments[1] : repository;
                return {
                    organization,
                    project,
                    repository,
                    url: `https://dev.azure.com/${encodePathPart(organization)}/${encodePathPart(project)}/_git/${encodePathPart(repository)}`,
                };
            }
        }

        if (url.hostname.toLowerCase().endsWith(".visualstudio.com")) {
            const organization = decodeURIComponent(url.hostname.slice(0, -".visualstudio.com".length));
            const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
            const gitIndex = segments.findIndex((segment) => segment.toLowerCase() === "_git");
            if (gitIndex >= 1 && segments[gitIndex + 1]) {
                const project = segments[0];
                const repository = segments[gitIndex + 1];
                return {
                    organization,
                    project,
                    repository,
                    url: `https://dev.azure.com/${encodePathPart(organization)}/${encodePathPart(project)}/_git/${encodePathPart(repository)}`,
                };
            }
        }
    } catch {
        return null;
    }

    return null;
}

async function detectAzureDevOpsRemote(workspacePath) {
    if (!workspacePath) {
        return null;
    }

    let stdout = "";
    try {
        ({ stdout } = await execFileAsync("git", ["remote", "-v"], {
            cwd: workspacePath,
            timeout: 10000,
            windowsHide: true,
        }));
    } catch {
        return null;
    }

    let firstFetchRemote = null;
    for (const line of stdout.split(/\r?\n/)) {
        const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
        if (!match || match[3] !== "fetch") {
            continue;
        }
        if (!firstFetchRemote) {
            firstFetchRemote = {
                remoteName: match[1],
                remoteUrl: match[2],
            };
        }
        const remote = parseAzureDevOpsRemoteUrl(match[2]);
        if (remote) {
            return {
                remoteName: match[1],
                remoteUrl: match[2],
                isAzureDevOps: true,
                ...remote,
            };
        }
    }

    return firstFetchRemote ? { ...firstFetchRemote, isAzureDevOps: false } : null;
}

async function detectAzureDevOpsRemoteFromWorkspace() {
    let sessionWorkingDirectory = "";
    try {
        const snapshot = await copilotSession?.rpc?.metadata?.snapshot?.();
        sessionWorkingDirectory = normalizeString(snapshot?.workingDirectory);
    } catch {
        sessionWorkingDirectory = "";
    }

    const candidatePaths = [
        sessionWorkingDirectory,
        copilotSession?.workspacePath,
        process.env.GITHUB_WORKSPACE,
        process.cwd(),
        PROJECT_EXTENSION_REPO_ROOT,
    ].filter(Boolean);
    const seen = new Set();

    for (const candidatePath of candidatePaths) {
        const resolvedPath = resolve(candidatePath);
        if (seen.has(resolvedPath)) {
            continue;
        }
        seen.add(resolvedPath);

        const remote = await detectAzureDevOpsRemote(resolvedPath);
        if (remote) {
            return {
                workspacePath: resolvedPath,
                ...remote,
            };
        }
    }

    return null;
}

async function getWorkspacePath() {
    const remote = await detectAzureDevOpsRemoteFromWorkspace();
    return remote?.workspacePath || copilotSession?.workspacePath || PROJECT_EXTENSION_REPO_ROOT;
}

async function getCurrentBranch() {
    const workspacePath = await getWorkspacePath();
    try {
        const { stdout } = await execFileAsync("git", ["branch", "--show-current"], {
            cwd: workspacePath,
            timeout: 10000,
            windowsHide: true,
        });
        return normalizeString(stdout);
    } catch {
        return "";
    }
}

async function getRemoteBranchState(branch) {
    const normalizedBranch = normalizeString(branch);
    if (!normalizedBranch) {
        return {
            checked: false,
            exists: null,
            remoteName: "",
            remoteUrl: "",
            sourceRefName: "",
        };
    }

    const remote = await detectAzureDevOpsRemoteFromWorkspace();
    if (!remote?.remoteName && !remote?.remoteUrl) {
        return {
            checked: false,
            exists: null,
            remoteName: "",
            remoteUrl: "",
            sourceRefName: branchRefName(normalizedBranch),
        };
    }

    const workspacePath = remote.workspacePath || await getWorkspacePath();
    const sourceRefName = branchRefName(normalizedBranch);
    const remoteSpecifier = remote.remoteName || remote.remoteUrl;
    try {
        const { stdout } = await execFileAsync("git", ["ls-remote", "--heads", remoteSpecifier, sourceRefName], {
            cwd: workspacePath,
            timeout: 15000,
            windowsHide: true,
        });
        return {
            checked: true,
            exists: Boolean(normalizeString(stdout)),
            remoteName: remote.remoteName || "",
            remoteUrl: remote.remoteUrl || "",
            sourceRefName,
        };
    } catch (error) {
        return {
            checked: false,
            exists: null,
            remoteName: remote.remoteName || "",
            remoteUrl: remote.remoteUrl || "",
            sourceRefName,
            error: normalizeString(error?.stderr) || normalizeString(error?.stdout) || normalizeString(error?.message),
        };
    }
}

function branchRefName(branch) {
    const normalized = normalizeString(branch);
    return normalized.startsWith("refs/heads/") ? normalized : `refs/heads/${normalized}`;
}

function base64Url(buffer) {
    return Buffer.from(buffer)
        .toString("base64")
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
}

async function readTokenCache() {
    return azureAuthTokenCache;
}

function parseJwtExpiry(accessToken) {
    const [, payload] = normalizeString(accessToken).split(".");
    if (!payload) {
        return null;
    }
    try {
        const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
        const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
        const exp = Number(decoded?.exp);
        return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
    } catch {
        return null;
    }
}

async function writeTokenCache(tokenResult) {
    const accessToken = normalizeString(tokenResult.accessToken ?? tokenResult.access_token);
    const cache = {
        accessToken,
        expiresAt: parseJwtExpiry(accessToken),
        source: normalizeString(tokenResult.source) || "azureauth",
        updatedAt: new Date().toISOString(),
    };
    if (!cache.accessToken) {
        throw new CanvasError("azure_devops_azureauth_token_empty", "AzureAuth returned an empty Azure DevOps token.");
    }
    azureAuthTokenCache = cache;
    return cache;
}

async function clearTokenCache() {
    const hadTokenCache = Boolean(azureAuthTokenCache);
    azureAuthTokenCache = null;
    return hadTokenCache;
}

function azureAuthTokenArgs() {
    return ["ado", "token", "--output", "token", "--timeout", AZUREAUTH_TIMEOUT_MINUTES, "--prompt-hint", "azure-devops-canvas"];
}

function managedAzureAuthDiscovery() {
    const roots = [];
    if (process.platform === "win32") {
        const localAppData = normalizeString(process.env.LOCALAPPDATA) || join(homedir(), "AppData", "Local");
        roots.push(join(localAppData, "Programs", "AzureAuth"));
    } else {
        roots.push(join(homedir(), ".azureauth"));
    }
    const executableName = process.platform === "win32" ? "azureauth.exe" : "azureauth";
    const candidates = [];
    const rootDetails = [];

    for (const root of roots) {
        const rootDetail = { path: root, exists: existsSync(root), error: "" };
        rootDetails.push(rootDetail);
        if (!rootDetail.exists) {
            continue;
        }
        try {
            if (existsSync(join(root, executableName))) {
                candidates.push({ path: join(root, executableName), version: null });
            }
            for (const entry of readdirSync(root, { withFileTypes: true })) {
                if (entry.isDirectory()) {
                    const candidate = join(root, entry.name, executableName);
                    if (existsSync(candidate)) {
                        candidates.push({ path: candidate, version: entry.name });
                    }
                }
            }
        } catch (error) {
            const errorCode = normalizeString(error?.code);
            rootDetail.error = errorCode
                ? `Unable to inspect the Agency-managed AzureAuth directory (${errorCode}).`
                : "Unable to inspect the Agency-managed AzureAuth directory.";
        }
    }

    const sortedCandidates = candidates
        .sort((left, right) => {
            const versionOrder = (right.version || "").localeCompare(left.version || "", undefined, {
                numeric: true,
                sensitivity: "base",
            });
            return versionOrder || left.path.localeCompare(right.path, undefined, { sensitivity: "base" });
        })
        .map(({ path }) => path);
    return {
        roots: rootDetails,
        candidates: sortedCandidates,
        selected: sortedCandidates[0] || "",
    };
}

function azureAuthDiscoveryTrace(discovery = managedAzureAuthDiscovery()) {
    const managedRoot =
        process.platform === "win32"
            ? normalizeString(process.env.LOCALAPPDATA) || join(homedir(), "AppData", "Local")
            : homedir();
    return {
        roots: discovery.roots.map(({ path, ...detail }) => ({
            ...detail,
            path: relative(managedRoot, path),
        })),
        candidates: discovery.candidates.map((path) => relative(managedRoot, path)),
        selected: discovery.selected ? relative(managedRoot, discovery.selected) : "",
    };
}

function azureAuthExecutable(discovery = managedAzureAuthDiscovery()) {
    const managedExecutable = discovery.selected;
    if (!managedExecutable) {
        throw new CanvasError(
            "azure_devops_azureauth_not_found",
            "Agency-managed AzureAuth executable was not found.",
        );
    }
    return managedExecutable;
}

async function acquireAzureAuthToken(executable = azureAuthExecutable()) {
    const args = azureAuthTokenArgs();
    try {
        const { stdout } = await execFileAsync(executable, args, {
            timeout: (Number(AZUREAUTH_TIMEOUT_MINUTES) + 1) * 60 * 1000,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
        });
        return normalizeString(stdout);
    } catch (error) {
        const detail =
            normalizeString(error?.stderr) ||
            normalizeString(error?.stdout) ||
            normalizeString(error?.code) ||
            "AzureAuth token acquisition failed.";
        throw new CanvasError(
            "azure_devops_azureauth_failed",
            `${detail} Verify the Agency-managed AzureAuth installation is available.`,
        );
    }
}

async function getAzureAuthAccessToken() {
    const cache = await readTokenCache();
    if (cache?.accessToken && (!cache.expiresAt || Number(cache.expiresAt) > Date.now())) {
        return {
            accessToken: cache.accessToken,
            source: cache.source || "azureauth",
            expiresAt: cache.expiresAt,
        };
    }

    const refreshedCache = await writeTokenCache({
        accessToken: await acquireAzureAuthToken(),
        source: "azureauth",
    });
    return {
        accessToken: refreshedCache.accessToken,
        source: refreshedCache.source,
        expiresAt: refreshedCache.expiresAt,
    };
}

async function getAuthState() {
    const cache = await readTokenCache();
    if (cache?.accessToken && (!cache.expiresAt || Number(cache.expiresAt) > Date.now())) {
        return {
            isAuthenticated: true,
            authType: "azureauth",
            source: cache.source || "azureauth",
            expiresAt: cache.expiresAt,
            azureAuthDiscovery: azureAuthDiscoveryTrace(),
        };
    }
    return {
        isAuthenticated: false,
        authType: "none",
        source: "",
        azureAuthDiscovery: azureAuthDiscoveryTrace(),
    };
}

async function startInteractiveAuth(entry) {
    if (entry.authProcess?.status === "running") {
        return entry.authProcess;
    }

    const azureAuthDiscovery = managedAzureAuthDiscovery();
    const authProcess = {
        provider: "azureauth",
        status: "running",
        output: "Requesting an Azure DevOps token via AzureAuth. Complete any AzureAuth prompt, then return to this canvas.",
        startedAt: new Date().toISOString(),
        completedAt: "",
        azureAuthDiscovery: azureAuthDiscoveryTrace(azureAuthDiscovery),
    };
    entry.authProcess = authProcess;

    const complete = (status, output, extra = {}) => {
        authProcess.status = status;
        authProcess.output = output;
        authProcess.completedAt = new Date().toISOString();
        Object.assign(authProcess, extra);
    };

    try {
        const azureAuthPath = azureAuthExecutable(azureAuthDiscovery);
        const cache = await writeTokenCache({
            accessToken: await acquireAzureAuthToken(azureAuthPath),
            source: "azureauth",
        });
        complete("succeeded", "AzureAuth acquired an Azure DevOps token.", {
            expiresAt: cache.expiresAt,
        });
    } catch (error) {
        const message = error instanceof CanvasError ? error.message : error?.message || "AzureAuth sign-in failed.";
        complete("failed", message, { error: errorPayload(error) });
    }

    return authProcess;
}

async function signOutAuth(entry) {
    const clearedTokenCache = await clearTokenCache();
    const authProcess = {
        provider: "azureauth",
        status: "succeeded",
        output: "Cleared the canvas token cache. AzureAuth sign-in state is managed outside this canvas.",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        clearedTokenCache,
    };
    entry.authProcess = authProcess;

    return authProcess;
}

async function getEffectiveConfig(overrides = {}) {
    const remote = await detectAzureDevOpsRemoteFromWorkspace();
    return {
        organization: remote?.isAzureDevOps ? normalizeString(remote.organization) : "",
        project: remote?.isAzureDevOps ? normalizeString(remote.project) : "",
        repositoryId: remote?.isAzureDevOps ? normalizeString(remote.repository) : "",
        apiVersion: DEFAULT_API_VERSION,
        remote,
    };
}

function parseOrganization(value) {
    const organization = normalizeString(value);
    if (!organization) {
        throw new CanvasError(
            "azure_devops_missing_organization",
            "Azure DevOps remote needed to determine the organization.",
        );
    }

    if (/^https?:\/\//i.test(organization)) {
        const url = new URL(organization);
        const hostname = url.hostname.toLowerCase();
        if (hostname === "dev.azure.com") {
            const [org] = url.pathname.split("/").filter(Boolean);
            if (!org) {
                throw new CanvasError("azure_devops_invalid_organization", "Organization URL must include the organization name.");
            }
            return { org, baseUrl: `${url.protocol}//${url.hostname}/${encodeURIComponent(org)}` };
        }
        if (hostname.endsWith(".visualstudio.com")) {
            const org = url.hostname.slice(0, -".visualstudio.com".length);
            return { org, baseUrl: `https://${org}.visualstudio.com` };
        }
        throw new CanvasError("azure_devops_invalid_organization", "Organization URL must use dev.azure.com or *.visualstudio.com.");
    }

    return { org: organization, baseUrl: `https://dev.azure.com/${encodeURIComponent(organization)}` };
}

function requireProject(config) {
    const project = normalizeString(config.project);
    if (!project) {
        throw new CanvasError(
            "azure_devops_missing_project",
            "Azure DevOps remote needed to determine the project.",
        );
    }
    return project;
}

async function makeAuthHeaders(extraHeaders = {}) {
    const token = await getAzureAuthAccessToken();
    return {
        Accept: "application/json",
        Authorization: `Bearer ${token.accessToken}`,
        ...extraHeaders,
    };
}

function buildApiUrl(config, path, params = {}, apiVersion = config.apiVersion || DEFAULT_API_VERSION) {
    const { baseUrl } = parseOrganization(config.organization);
    const url = new URL(path, `${baseUrl}/`);
    url.searchParams.set("api-version", apiVersion);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
            url.searchParams.set(key, String(value));
        }
    }
    return url;
}

async function fetchJson(config, path, options = {}) {
    const url = buildApiUrl(config, path, options.params, options.apiVersion);
    const response = await fetch(url, {
        method: options.method || "GET",
        headers: await makeAuthHeaders(options.headers),
        body: options.body,
    });
    const text = await response.text();
    let data = {};
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { message: text };
        }
    }
    if (!response.ok) {
        const message = data?.message || data?.error?.message || response.statusText || "Azure DevOps request failed.";
        throw new CanvasError("azure_devops_request_failed", `${response.status} ${message}`);
    }
    return data;
}

function fieldValue(workItem, fieldName) {
    const value = workItem?.fields?.[fieldName];
    if (value && typeof value === "object" && "displayName" in value) {
        return value.displayName;
    }
    return value ?? "";
}

function mapWorkItem(workItem) {
    return {
        id: workItem.id,
        url: workItem.url,
        type: fieldValue(workItem, "System.WorkItemType"),
        title: fieldValue(workItem, "System.Title"),
        state: fieldValue(workItem, "System.State"),
        assignedTo: fieldValue(workItem, "System.AssignedTo"),
        changedDate: fieldValue(workItem, "System.ChangedDate"),
    };
}

function mapPullRequest(pr, repositoryOverride = {}) {
    const id = pr.pullRequestId;
    const repository = { ...repositoryOverride, ...(pr.repository || {}) };
    const repositoryWebUrl = normalizeString(repository.webUrl);
    return {
        id,
        title: pr.title,
        status: pr.status,
        repository: repository.name || "",
        repositoryId: repository.id || "",
        sourceRefName: pr.sourceRefName || "",
        targetRefName: pr.targetRefName || "",
        createdBy: pr.createdBy?.displayName || "",
        creationDate: pr.creationDate || "",
        url: pr.url || "",
        webUrl: pr._links?.web?.href || (repositoryWebUrl && id ? `${repositoryWebUrl}/pullrequest/${id}` : ""),
    };
}

function decodeHtmlEntities(value) {
    return String(value ?? "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
}

function stripHtml(value) {
    const withoutLinks = String(value ?? "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    const withLineBreaks = withoutLinks
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/div>/gi, "\n")
        .replace(/<\/li>/gi, "\n");
    const text = withLineBreaks.replace(/<[^>]*>/g, " ");
    return decodeHtmlEntities(text).replace(/\s+/g, " ").trim();
}

function mapPolicyEvaluation(evaluation, statusById = new Map()) {
    const configuration = evaluation?.configuration || {};
    const statusRecord = statusById.get(Number(evaluation?.context?.latestStatusId));
    const displayName =
        normalizeString(statusRecord?.context?.name) ||
        normalizeString(configuration.settings?.statusName) ||
        normalizeString(configuration.settings?.defaultDisplayName) ||
        normalizeString(configuration.settings?.displayName) ||
        normalizeString(configuration.type?.displayName) ||
        `Policy ${configuration.id || evaluation.policyEvaluationId || ""}`.trim();
    return {
        displayName,
        status: normalizeString(statusRecord?.state) || normalizeString(evaluation?.status) || "unknown",
        description: normalizeString(statusRecord?.description),
    };
}

async function getPullRequestStatuses(config, project, repositoryId, pullRequestId) {
    if (!repositoryId || !pullRequestId) {
        return [];
    }
    const data = await fetchJson(
        config,
        `${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullRequests/${encodeURIComponent(pullRequestId)}/statuses`,
        { apiVersion: PREVIEW_API_VERSION },
    );
    return data.value || [];
}

function buildPullRequestCommentUrl(pullRequestWebUrl, threadId, commentId) {
    const baseUrl = normalizeString(pullRequestWebUrl);
    if (!baseUrl || !threadId) {
        return "";
    }
    const url = new URL(baseUrl);
    url.searchParams.set("_a", "overview");
    url.searchParams.set("discussionId", String(threadId));
    if (commentId) {
        url.searchParams.set("commentId", String(commentId));
    }
    return url.toString();
}

function mapPullRequestComments(threads, pullRequestWebUrl) {
    return (threads || []).flatMap((thread) =>
        (thread.comments || [])
            .filter((comment) => !comment.isDeleted)
            .map((comment) => ({
                id: comment.id,
                threadId: thread.id,
                author: normalizeString(comment.author?.displayName) || "Unknown",
                text: stripHtml(comment.content) || "(No comment text)",
                webUrl: buildPullRequestCommentUrl(pullRequestWebUrl, thread.id, comment.id),
            })),
    );
}

async function getPullRequestThreads(config, project, repositoryId, pullRequestId) {
    if (!repositoryId || !pullRequestId) {
        return [];
    }
    const data = await fetchJson(
        config,
        `${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullRequests/${encodeURIComponent(pullRequestId)}/threads`,
        { apiVersion: "7.1-preview.1" },
    );
    return data.value || [];
}

async function getPullRequestPolicyEvaluations(config, project, repository, pullRequestId) {
    const projectId = normalizeString(repository?.project?.id);
    if (!projectId || !pullRequestId) {
        return [];
    }
    const statuses = await getPullRequestStatuses(config, project, repository.id, pullRequestId);
    const statusById = new Map(statuses.map((status) => [Number(status.id), status]));
    const artifactId = `vstfs:///CodeReview/CodeReviewId/${projectId}/${pullRequestId}`;
    const data = await fetchJson(config, `${encodeURIComponent(project)}/_apis/policy/evaluations`, {
        apiVersion: PREVIEW_API_VERSION,
        params: { artifactId },
    });
    return (data.value || []).map((evaluation) => mapPolicyEvaluation(evaluation, statusById));
}

function branchName(refName) {
    return normalizeString(refName).replace(/^refs\/heads\//, "");
}

function buildCreatePullRequestUrl(repository, branch) {
    const repositoryWebUrl = normalizeString(repository.webUrl);
    if (!repositoryWebUrl || !repository.id) {
        return "";
    }
    const url = new URL(`${repositoryWebUrl.replace(/\/$/, "")}/pullrequestcreate`);
    const sourceBranch = branchName(branch);
    if (sourceBranch) {
        url.searchParams.set("sourceRef", sourceBranch);
    }
    url.searchParams.set("targetRef", branchName(repository.defaultBranch) || "main");
    url.searchParams.set("sourceRepositoryId", repository.id);
    url.searchParams.set("targetRepositoryId", repository.id);
    return url.toString();
}

async function getConnectionUser(overrides = {}) {
    const config = await getEffectiveConfig(overrides);
    const data = await fetchJson(config, "_apis/connectionData", {
        apiVersion: PREVIEW_API_VERSION,
    });
    const user = data.authenticatedUser || data.authorizedUser || {};
    return {
        id: user.id || "",
        displayName: user.providerDisplayName || user.displayName || "",
        uniqueName: user.properties?.Account?.$value || user.uniqueName || "",
        raw: user,
    };
}

async function getCurrentBranchPullRequest(overrides = {}) {
    const config = await getEffectiveConfig(overrides);
    const project = requireProject(config);
    const repository = await resolveRepository({ ...overrides, config });
    const branch = normalizeString(overrides.branch) || await getCurrentBranch();
    if (!branch) {
        throw new CanvasError("azure_devops_missing_branch", "Could not determine the current git branch.");
    }
    const data = await fetchJson(config, `${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repository.id)}/pullrequests`, {
        apiVersion: PREVIEW_API_VERSION,
        params: {
            "searchCriteria.sourceRefName": branchRefName(branch),
            "searchCriteria.status": "all",
            $top: 10,
        },
    });
    const pullRequests = (data.value || []).map((pr) => mapPullRequest(pr, repository));
    const visiblePullRequests = pullRequests.filter((pr) => normalizeString(pr.status).toLowerCase() !== "abandoned");
    const remoteBranch = await getRemoteBranchState(branch);
    const selectedPullRequest =
        visiblePullRequests.find((pr) => normalizeString(pr.status).toLowerCase() === "active") ||
        visiblePullRequests[0] ||
        null;
    const pullRequest = selectedPullRequest
        ? {
            ...selectedPullRequest,
            policyEvaluations: await getPullRequestPolicyEvaluations(config, project, repository, selectedPullRequest.id),
            comments: mapPullRequestComments(
                await getPullRequestThreads(config, project, repository.id, selectedPullRequest.id),
                selectedPullRequest.webUrl,
            ),
        }
        : null;
    const canCreatePullRequest = !selectedPullRequest && visiblePullRequests.length === 0 && remoteBranch.exists !== false;
    return {
        branch,
        sourceRefName: branchRefName(branch),
        repositoryId: repository.id,
        repository,
        remoteBranch,
        canCreatePullRequest,
        createPullRequestUrl: canCreatePullRequest ? buildCreatePullRequestUrl(repository, branch) : "",
        pullRequest,
        pullRequests,
    };
}

async function resolveRepository(overrides = {}) {
    const config = overrides.config || await getEffectiveConfig(overrides);
    const project = requireProject(config);
    const repositoryIdentifier = normalizeString(overrides.repositoryId) || config.repositoryId;
    if (!repositoryIdentifier) {
        throw new CanvasError("azure_devops_missing_repository", "Set a repository or use an Azure DevOps git remote.");
    }
    const data = await fetchJson(config, `${encodeURIComponent(project)}/_apis/git/repositories`);
    const repositories = data.value || [];
    const match = repositories.find((repo) =>
        repo.id?.toLowerCase() === repositoryIdentifier.toLowerCase() ||
        repo.name?.toLowerCase() === repositoryIdentifier.toLowerCase() ||
        repo.remoteUrl?.replace(/\.git$/i, "").toLowerCase() === config.remote?.url?.toLowerCase() ||
        repo.webUrl?.replace(/\.git$/i, "").toLowerCase() === config.remote?.url?.toLowerCase()
    );
    if (!match) {
        throw new CanvasError(
            "azure_devops_repository_not_found",
            `Could not find repository "${repositoryIdentifier}" in ${config.organization}/${project}.`,
        );
    }
    return match;
}

async function createPullRequest(overrides = {}) {
    const config = await getEffectiveConfig(overrides);
    const project = requireProject(config);
    const repository = await resolveRepository({ ...overrides, config });
    const branch = normalizeString(overrides.branch) || await getCurrentBranch();
    if (!branch) {
        throw new CanvasError("azure_devops_missing_branch", "Could not determine the current git branch.");
    }
    const remoteBranch = await getRemoteBranchState(branch);
    if (remoteBranch.exists === false) {
        throw new CanvasError(
            "azure_devops_branch_not_on_remote",
            `Push ${remoteBranch.sourceRefName || branchRefName(branch)} to ${remoteBranch.remoteName || "the remote"} before creating a pull request.`,
        );
    }
    const targetRefName = normalizeString(overrides.targetRefName) || repository.defaultBranch || "refs/heads/main";
    const title = normalizeString(overrides.title) || branch.replace(/^.*\//, "").replace(/[-_]+/g, " ");
    const pr = await fetchJson(config, `${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repository.id)}/pullrequests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            sourceRefName: branchRefName(branch),
            targetRefName,
            title,
            description: normalizeString(overrides.description),
        }),
    });
    return {
        pullRequest: {
            ...mapPullRequest(pr, repository),
            policyEvaluations: await getPullRequestPolicyEvaluations(config, project, repository, pr.pullRequestId),
            comments: mapPullRequestComments(
                await getPullRequestThreads(config, project, repository.id, pr.pullRequestId),
                mapPullRequest(pr, repository).webUrl,
            ),
        },
        raw: pr,
    };
}

async function listMyPullRequests(overrides = {}) {
    const config = await getEffectiveConfig(overrides);
    const project = requireProject(config);
    const shouldScopeToRepository = Boolean(normalizeString(overrides.repositoryId) || config.repositoryId);
    const repository = shouldScopeToRepository ? await resolveRepository({ ...overrides, config }) : null;
    const status = normalizeString(overrides.status) || DEFAULT_STATUS;
    const user = await getConnectionUser(config);
    const path = repository
        ? `${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repository.id)}/pullrequests`
        : `${encodeURIComponent(project)}/_apis/git/pullrequests`;
    const data = await fetchJson(config, path, {
        apiVersion: PREVIEW_API_VERSION,
        params: {
            "searchCriteria.creatorId": user.id,
            "searchCriteria.status": status,
            $top: Math.max(1, Math.min(Number(overrides.top || DEFAULT_LIST_LIMIT), 100)),
        },
    });
    const pullRequests = (data.value || []).map((pr) => mapPullRequest(pr, repository || pr.repository));
    return { pullRequests, count: pullRequests.length, user, repository };
}

async function queryWorkItems(overrides = {}) {
    const config = await getEffectiveConfig(overrides);
    const project = requireProject(config);
    const top = Math.max(1, Math.min(Number(overrides.top || DEFAULT_LIST_LIMIT), 200));
    const wiql = normalizeString(overrides.wiql) || DEFAULT_WIQL;
    const queryResult = await fetchJson(config, `${encodeURIComponent(project)}/_apis/wit/wiql`, {
        method: "POST",
        params: { $top: top },
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: wiql }),
    });
    const ids = (queryResult.workItems || []).map((item) => item.id).slice(0, top);
    if (!ids.length) {
        return { workItems: [], count: 0, queryType: queryResult.queryType || "" };
    }

    const details = await fetchJson(config, `${encodeURIComponent(project)}/_apis/wit/workitems`, {
        params: {
            ids: ids.join(","),
            fields: [
                "System.Id",
                "System.WorkItemType",
                "System.Title",
                "System.State",
                "System.AssignedTo",
                "System.ChangedDate",
            ].join(","),
        },
    });
    const workItems = (details.value || []).map(mapWorkItem);
    return { workItems, count: workItems.length, queryType: queryResult.queryType || "" };
}

async function queryMyWorkItems(overrides = {}) {
    const state = normalizeString(overrides.state) || "Active";
    const top = Math.max(1, Math.min(Number(overrides.top || DEFAULT_LIST_LIMIT), 200));
    const wiql = state.toLowerCase() === "all"
        ? "SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType], [System.AssignedTo], [System.ChangedDate] FROM WorkItems WHERE [System.AssignedTo] = @Me ORDER BY [System.ChangedDate] DESC"
        : `SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType], [System.AssignedTo], [System.ChangedDate] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.State] = '${state.replaceAll("'", "''")}' ORDER BY [System.ChangedDate] DESC`;
    return queryWorkItems({ ...overrides, wiql, top });
}

async function getWorkItem(overrides = {}) {
    const config = await getEffectiveConfig(overrides);
    const project = requireProject(config);
    const id = Number(overrides.id);
    if (!Number.isInteger(id) || id <= 0) {
        throw new CanvasError("azure_devops_invalid_work_item_id", "Work item id must be a positive integer.");
    }
    const item = await fetchJson(config, `${encodeURIComponent(project)}/_apis/wit/workitems/${id}`, {
        params: {
            $expand: "Relations",
            fields: [
                "System.Id",
                "System.WorkItemType",
                "System.Title",
                "System.State",
                "System.AssignedTo",
                "System.Description",
                "System.ChangedDate",
                "System.CreatedDate",
            ].join(","),
        },
    });
    return { workItem: mapWorkItem(item), raw: item };
}

async function createWorkItem(overrides = {}) {
    const config = await getEffectiveConfig(overrides);
    const project = requireProject(config);
    const title = normalizeString(overrides.title);
    const type = normalizeString(overrides.type) || "Task";
    if (!title) {
        throw new CanvasError("azure_devops_missing_title", "Work item title is required.");
    }
    const patch = [{ op: "add", path: "/fields/System.Title", value: title }];
    if (normalizeString(overrides.description)) {
        patch.push({ op: "add", path: "/fields/System.Description", value: normalizeString(overrides.description) });
    }
    const item = await fetchJson(config, `${encodeURIComponent(project)}/_apis/wit/workitems/$${encodeURIComponent(type)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json-patch+json" },
        body: JSON.stringify(patch),
    });
    return { workItem: mapWorkItem(item), raw: item };
}

async function updateWorkItemFields(overrides = {}) {
    const config = await getEffectiveConfig(overrides);
    const project = requireProject(config);
    const id = Number(overrides.id);
    if (!Number.isInteger(id) || id <= 0) {
        throw new CanvasError("azure_devops_invalid_work_item_id", "Work item id must be a positive integer.");
    }
    const fields = overrides.fields && typeof overrides.fields === "object" ? overrides.fields : {};
    const patch = Object.entries(fields)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([fieldName, value]) => ({ op: "add", path: `/fields/${fieldName}`, value }));
    if (!patch.length) {
        throw new CanvasError("azure_devops_missing_fields", "At least one field must be provided.");
    }
    const item = await fetchJson(config, `${encodeURIComponent(project)}/_apis/wit/workitems/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json-patch+json" },
        body: JSON.stringify(patch),
    });
    return { workItem: mapWorkItem(item), raw: item };
}

async function listPullRequests(overrides = {}) {
    const config = await getEffectiveConfig(overrides);
    const project = requireProject(config);
    const shouldScopeToRepository = Boolean(normalizeString(overrides.repositoryId) || config.repositoryId);
    const repository = shouldScopeToRepository ? await resolveRepository({ ...overrides, config }) : null;
    const status = normalizeString(overrides.status) || DEFAULT_STATUS;
    const path = repository
        ? `${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repository.id)}/pullrequests`
        : `${encodeURIComponent(project)}/_apis/git/pullrequests`;
    const data = await fetchJson(config, path, {
        apiVersion: PREVIEW_API_VERSION,
        params: {
            "searchCriteria.status": status,
            $top: Math.max(1, Math.min(Number(overrides.top || DEFAULT_LIST_LIMIT), 100)),
        },
    });
    const pullRequests = (data.value || []).map((pr) => mapPullRequest(pr, repository || pr.repository));
    return { pullRequests, count: pullRequests.length, repository };
}

async function listRepositories(overrides = {}) {
    const config = await getEffectiveConfig(overrides);
    const project = requireProject(config);
    const data = await fetchJson(config, `${encodeURIComponent(project)}/_apis/git/repositories`);
    return {
        repositories: (data.value || []).map((repo) => ({
            id: repo.id,
            name: repo.name,
            defaultBranch: repo.defaultBranch || "",
            webUrl: repo.webUrl || "",
        })),
    };
}

function jsonResponse(res, statusCode, payload) {
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(payload));
}

function htmlResponse(res, html) {
    res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
    });
    res.end(html);
}

function notFound(res) {
    jsonResponse(res, 404, { error: "Not found" });
}

async function readRequestBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw) {
        return {};
    }
    try {
        return JSON.parse(raw);
    } catch {
        throw new CanvasError("azure_devops_invalid_json", "Request body is not valid JSON.");
    }
}

function errorPayload(error) {
    return {
        error: error instanceof CanvasError ? error.code : "azure_devops_unexpected_error",
        message: error?.message || "Unexpected Azure DevOps canvas error.",
    };
}

function headerValue(value) {
    if (Array.isArray(value)) {
        return normalizeString(value[0]);
    }
    return typeof value === "string" ? value.trim() : "";
}

function validateApiRequest(entry, req) {
    const expectedHost = entry.url ? new URL(entry.url).host : "";
    const actualHost = headerValue(req.headers.host);
    if (!expectedHost || actualHost !== expectedHost) {
        throw new CanvasError("azure_devops_invalid_host", "Rejected request with unexpected Host header.");
    }
    const actualNonce = headerValue(req.headers["x-canvas-nonce"]);
    if (!entry.apiNonce || actualNonce !== entry.apiNonce) {
        throw new CanvasError("azure_devops_invalid_nonce", "Rejected request with invalid API nonce.");
    }
}

async function handleApi(entry, req, res, url) {
    try {
        validateApiRequest(entry, req);
        if (req.method === "GET" && url.pathname === "/api/config") {
            const config = await getEffectiveConfig(entry.input);
            const auth = await getAuthState();
            const branch = await getCurrentBranch();
            jsonResponse(res, 200, {
                config: {
                    organization: config.organization,
                    project: config.project,
                    repositoryId: config.repositoryId,
                    apiVersion: config.apiVersion,
                    auth,
                    branch,
                    remote: config.remote || null,
                },
            });
            return;
        }
        if (req.method === "POST" && url.pathname === "/api/auth/start") {
            await readRequestBody(req);
            jsonResponse(res, 200, { authProcess: await startInteractiveAuth(entry) });
            return;
        }
        if (req.method === "POST" && url.pathname === "/api/auth/sign-out") {
            await readRequestBody(req);
            jsonResponse(res, 200, { authProcess: await signOutAuth(entry), auth: await getAuthState() });
            return;
        }
        if (req.method === "GET" && url.pathname === "/api/auth/status") {
            const authProcess = entry.authProcess || null;
            jsonResponse(res, 200, {
                authProcess,
                auth: authProcess?.status === "running" ? null : await getAuthState(),
            });
            return;
        }
        if (req.method === "POST" && url.pathname === "/api/test-error") {
            await readRequestBody(req);
            throw new CanvasError("azure_devops_test_error", "<b>Test error</b> & check escaping.");
        }
        if (req.method === "GET" && url.pathname === "/api/work-items") {
            const result = await queryWorkItems({
                ...entry.input,
                top: url.searchParams.get("top"),
                wiql: url.searchParams.get("wiql") || undefined,
            });
            jsonResponse(res, 200, result);
            return;
        }
        if (req.method === "GET" && url.pathname.startsWith("/api/work-items/")) {
            const id = url.pathname.split("/").pop();
            jsonResponse(res, 200, await getWorkItem({ ...entry.input, id }));
            return;
        }
        if (req.method === "GET" && url.pathname === "/api/current-pull-request") {
            jsonResponse(res, 200, await getCurrentBranchPullRequest(entry.input));
            return;
        }
        if (req.method === "POST" && url.pathname === "/api/current-pull-request") {
            const body = await readRequestBody(req);
            jsonResponse(res, 200, await createPullRequest({ ...entry.input, ...body }));
            return;
        }
        if (req.method === "GET" && url.pathname === "/api/repositories") {
            jsonResponse(res, 200, await listRepositories(entry.input));
            return;
        }
        notFound(res);
    } catch (error) {
        jsonResponse(res, error instanceof CanvasError ? 400 : 500, errorPayload(error));
    }
}

function renderHtml(instanceId, apiNonce) {
    const initialState = JSON.stringify({ instanceId, apiNonce });
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Azure DevOps</title>
  <style>
    :root {
      color-scheme: light dark;
    }
    body {
      margin: 0;
      background: var(--background-color-default, #ffffff);
      color: var(--text-color-default, #1f2328);
      font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--text-body-medium, 14px);
      line-height: var(--leading-body-medium, 20px);
    }
    header {
      padding: 16px;
      border-bottom: 1px solid var(--border-color-default, #d0d7de);
      display: flex;
      gap: 12px;
      justify-content: space-between;
      align-items: center;
    }
    .brand {
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .brand-logo {
      width: 24px;
      height: 24px;
      flex: 0 0 auto;
    }
    [hidden] {
      display: none !important;
    }
    h1, h2, h3 {
      margin: 0;
      font-weight: var(--font-weight-semibold, 600);
    }
    h1 {
      font-size: var(--text-title-medium, 20px);
      line-height: var(--leading-title-medium, 26px);
    }
    h2 {
      font-size: var(--text-title-small, 16px);
      line-height: var(--leading-title-small, 22px);
    }
    main {
      display: grid;
      gap: 16px;
      padding: 16px;
    }
    section, details {
      border: 1px solid var(--border-color-default, #d0d7de);
      border-radius: 10px;
      background: var(--background-color-muted, rgba(127, 127, 127, 0.05));
      padding: 12px;
    }
    details > summary {
      cursor: pointer;
      font-weight: var(--font-weight-semibold, 600);
    }
    form {
      display: grid;
      gap: 10px;
      margin-top: 12px;
    }
    label {
      display: grid;
      gap: 4px;
      color: var(--text-color-muted, #57606a);
      font-size: var(--text-body-small, 12px);
    }
    input, select, textarea, button {
      font: inherit;
    }
    input, select, textarea {
      box-sizing: border-box;
      width: 100%;
      color: var(--text-color-default, #1f2328);
      background: var(--background-color-default, #ffffff);
      border: 1px solid var(--border-color-default, #d0d7de);
      border-radius: 6px;
      padding: 8px;
    }
    textarea {
      min-height: 88px;
      resize: vertical;
      font-family: var(--font-mono, Consolas, monospace);
      font-size: var(--text-code-inline, 12px);
    }
    button {
      border: 1px solid var(--border-color-default, #d0d7de);
      border-radius: 6px;
      padding: 8px 10px;
      background: var(--background-color-accent-emphasis, #0969da);
      color: var(--color-white, #ffffff);
      cursor: pointer;
      font-weight: var(--font-weight-semibold, 600);
    }
    button.secondary {
      color: var(--text-color-default, #1f2328);
      background: var(--background-color-default, #ffffff);
    }
    button.active {
      color: var(--color-white, #ffffff);
      background: var(--background-color-accent-emphasis, #0969da);
    }
    a.button-link {
      display: inline-block;
      box-sizing: border-box;
      border: 1px solid var(--border-color-default, #d0d7de);
      border-radius: 6px;
      padding: 8px 10px;
      background: var(--background-color-accent-emphasis, #0969da);
      color: var(--color-white, #ffffff);
      font-weight: var(--font-weight-semibold, 600);
      text-decoration: none;
      justify-self: start;
    }
    .tabs, .subtabs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .tab-panel {
      display: grid;
      gap: 12px;
    }
    .tab-panel[hidden] {
      display: none;
    }
    .grid {
      display: grid;
      gap: 12px;
    }
    .content-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 16px;
      align-items: start;
    }
    .stacked-form {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .status {
      color: var(--text-color-muted, #57606a);
      font-size: var(--text-body-small, 12px);
    }
    .status-button {
      border: 0;
      padding: 0;
      background: transparent;
      color: var(--fgColor-accent, #0969da);
      cursor: pointer;
      font: inherit;
    }
    .warning {
      border-color: var(--true-color-red-muted, #ffebe9);
      background: var(--true-color-red-muted, #ffebe9);
      color: var(--true-color-red, #cf222e);
    }
    .cards {
      display: grid;
      gap: 8px;
    }
    .card {
      padding: 10px;
      border: 1px solid var(--border-color-default, #d0d7de);
      border-radius: 8px;
      background: var(--background-color-default, #ffffff);
    }
    .card-title {
      display: flex;
      gap: 8px;
      justify-content: space-between;
      align-items: baseline;
      font-weight: var(--font-weight-semibold, 600);
    }
    .meta {
      color: var(--text-color-muted, #57606a);
      font-size: var(--text-body-small, 12px);
      margin-top: 4px;
    }
    .policy-list {
      display: grid;
      gap: 4px;
      margin-top: 8px;
      max-height: calc(5 * 20px);
      overflow-y: auto;
      padding-right: 4px;
    }
    .comment-list {
      display: grid;
      gap: 6px;
      margin-top: 8px;
    }
    .comment-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
    }
    .comment-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .logs-list {
      display: grid;
      gap: 4px;
      font-family: var(--font-mono, Consolas, monospace);
      font-size: var(--text-code-inline, 12px);
    }
    .log-entry {
      white-space: pre-wrap;
      word-break: break-word;
    }
    .log-level {
      font-weight: var(--font-weight-semibold, 600);
      text-transform: uppercase;
    }
    .log-level-error {
      color: var(--true-color-red, #cf222e);
    }
    .log-level-warn {
      color: var(--fgColor-attention, #9a6700);
    }
    .coming-soon {
      padding: 12px;
      border: 1px dashed var(--border-color-default, #d0d7de);
      border-radius: 8px;
      background: var(--background-color-default, #ffffff);
    }
    .split {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
    }
    @media (max-width: 900px) {
      .content-grid {
        grid-template-columns: 1fr;
      }
    }
    a {
      color: var(--fgColor-accent, #0969da);
      text-decoration: none;
    }
    code {
      font-family: var(--font-mono, Consolas, monospace);
      font-size: var(--text-code-inline, 12px);
    }
    pre.auth-output {
      max-height: 220px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      margin: 8px 0 0;
      padding: 10px;
      border: 1px solid var(--border-color-default, #d0d7de);
      border-radius: 8px;
      background: var(--background-color-default, #ffffff);
      color: var(--text-color-default, #1f2328);
      font-family: var(--font-mono, Consolas, monospace);
      font-size: var(--text-code-inline, 12px);
    }
    footer {
      padding: 0 16px 16px;
    }
    .footer-note {
      color: var(--text-color-muted, #57606a);
      font-size: var(--text-body-small, 12px);
      text-align: center;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <img class="brand-logo" src="https://cdn.vsassets.io/ext/ms.vss-tfs-web/platform-content/ADO.C1K4lP.svg" alt="Azure DevOps" />
      <div>
        <h1>Azure DevOps</h1>
        <div class="status" id="connectionStatus">Loading configuration...</div>
      </div>
    </div>
    <button id="refreshButton">Refresh</button>
  </header>
  <main>
    <section class="warning" id="setupWarning" hidden></section>
    <nav class="tabs" aria-label="Azure DevOps sections">
      <button type="button" class="active" data-tab="pull-request">Pull Request</button>
      <button type="button" class="secondary" data-tab="pull-requests">Pull Requests</button>
      <button type="button" class="secondary" data-tab="work-items">Work Items</button>
    </nav>
    <section class="tab-panel" id="pull-request-panel">
      <div class="toolbar">
        <h2>Pull Request</h2>
        <button class="secondary" id="reloadCurrentPullRequest">Reload</button>
      </div>
      <div class="status" id="currentBranchContext">Loading branch context...</div>
      <div id="currentPullRequest" class="cards"></div>
      <a id="createPullRequestLink" class="button-link" href="#" target="_blank" rel="noopener noreferrer" hidden>Create pull request</a>
    </section>
    <section class="tab-panel" id="pull-requests-panel" hidden>
      <h2>Pull Requests</h2>
      <div class="coming-soon">
        <div class="status">Coming soon.</div>
      </div>
    </section>
    <section class="tab-panel" id="work-items-panel" hidden>
      <h2>Work Items</h2>
      <div class="coming-soon">
        <div class="status">Coming soon.</div>
      </div>
    </section>
    <details>
      <summary id="connectionSettingsSummary">Connection details</summary>
      <div class="grid">
        <div class="split">
          <label>Organization<input id="organization" readonly /></label>
          <label>Project<input id="project" readonly /></label>
          <label>Repository<input id="repositoryId" readonly /></label>
        </div>
        <div class="toolbar">
          <button type="button" class="secondary" id="signOutButton">Clear cached token</button>
          <button type="button" class="secondary" id="testErrorButton" hidden>Test error</button>
          <span class="status">Connection details come from the current Azure DevOps git remote. Clearing the cache only resets this canvas session.</span>
        </div>
        <pre class="auth-output" id="authOutput" hidden></pre>
      </div>
    </details>
    <details>
      <summary>Logs</summary>
      <div class="grid">
        <div class="toolbar">
          <button type="button" class="secondary" id="copyLogsButton">Copy</button>
          <button type="button" class="secondary" id="clearLogsButton">Clear</button>
          <span class="status" id="copyLogsStatus"></span>
        </div>
        <div class="logs-list" id="logsList"></div>
      </div>
    </details>
  </main>
  <footer>
    <div class="footer-note">
      Feedback? Bugs? Report via
      <a href="https://eng.ms/docs/coreai/devdiv/one-engineering-system-1es/1es-jacekcz/startrightgitops/agency/support/support" target="_blank" rel="noopener noreferrer">Agency support</a>
      <span> · v${EXTENSION_VERSION}</span>
    </div>
  </footer>
  <script>
    const state = ${initialState};
    const warning = document.getElementById("setupWarning");
    const statusText = document.getElementById("connectionStatus");
    const currentBranchContext = document.getElementById("currentBranchContext");
    const currentPullRequest = document.getElementById("currentPullRequest");
    const createPullRequestLink = document.getElementById("createPullRequestLink");
    const authOutput = document.getElementById("authOutput");
    const logsList = document.getElementById("logsList");
    const copyLogsStatus = document.getElementById("copyLogsStatus");
    let currentConfig = null;
    let autoAuthAttempted = false;
    let warningMessage = "";
    let logs = [];

    function timestamp() {
      return new Date().toLocaleTimeString();
    }

    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    function renderLogs() {
      logsList.innerHTML = "";
      copyLogsStatus.textContent = "";
      if (!logs.length) {
        const empty = document.createElement("div");
        empty.className = "status";
        empty.textContent = "No logs yet.";
        logsList.appendChild(empty);
        return;
      }
      for (const entry of logs) {
        const item = document.createElement("div");
        item.className = "log-entry";
        item.innerHTML =
          '<span class="status">[' + escapeHtml(entry.time) + ']</span> ' +
          '<span class="log-level log-level-' + escapeHtml(entry.level) + '">' + escapeHtml(entry.level).toUpperCase() + '</span> ' +
          '<span>' + escapeHtml(entry.message) + '</span>' +
          (entry.details ? '<br /><span class="status">' + escapeHtml(entry.details) + '</span>' : '');
        logsList.appendChild(item);
      }
    }

    function addLog(level, message, details) {
      logs.unshift({
        level: level === "error" ? "error" : level === "warn" ? "warn" : "trace",
        time: timestamp(),
        message,
        details: details || "",
      });
      logs = logs.slice(0, 100);
      renderLogs();
    }

    function formatLogsForClipboard() {
      if (!logs.length) {
        return "No logs yet.";
      }
      return logs
        .map((entry) => {
          return "[" + entry.time + "] " + entry.level.toUpperCase() + ": " + entry.message +
            (entry.details ? "\\n" + entry.details : "");
        })
        .join("\\n\\n");
    }

    async function copyLogs() {
      const content = formatLogsForClipboard();
      try {
        await navigator.clipboard.writeText(content);
        copyLogsStatus.textContent = "Copied.";
      } catch (error) {
        copyLogsStatus.textContent = "Copy failed.";
        addLog("error", "Failed to copy logs.", error.message || "");
      }
    }

    async function api(path, options) {
      const headers = { ...(options?.headers || {}), "X-Canvas-Nonce": state.apiNonce };
      const response = await fetch(path, { ...(options || {}), headers });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.error || "Request failed");
      }
      return data;
    }

    function setWarning(message) {
      warning.hidden = !message;
      warning.textContent = message || "";
      if (message && message !== warningMessage) {
        addLog("warn", message);
      }
      warningMessage = message || "";
    }

    function formatRemoteWarning(remote) {
      if (remote?.remoteUrl) {
        return "Azure DevOps remote needed, current remote: " + (remote.remoteName || "remote") + " (" + remote.remoteUrl + ")";
      }
      return "Azure DevOps remote needed. No git remote detected.";
    }

    function fillSettings(config) {
      document.getElementById("organization").value = config.organization || "";
      document.getElementById("project").value = config.project || "";
      document.getElementById("repositoryId").value = config.repositoryId || "";
      if (config.remote?.isAzureDevOps) {
        setWarning("");
      } else {
        setWarning(formatRemoteWarning(config.remote));
      }
      const authSummary = config.auth?.isAuthenticated
        ? "Auth: " + config.auth.authType + (config.auth.user ? " as " + config.auth.user : "")
        : "AzureAuth will run automatically when the current branch pull request is loaded";
      statusText.textContent = config.remote?.isAzureDevOps
        ? "Configured for " + config.organization + " / " + config.project + " · " + authSummary + " (" + state.instanceId + ")"
        : "Azure DevOps remote required.";
      currentConfig = config;
      if (config.auth?.isAuthenticated) {
        autoAuthAttempted = false;
      }
      addLog(
        "trace",
        config.remote?.isAzureDevOps
          ? "Detected Azure DevOps remote."
          : "Azure DevOps remote not detected.",
        config.remote?.remoteUrl || ""
      );
      if (config.auth?.azureAuthDiscovery) {
        addLog("trace", "AzureAuth discovery.", JSON.stringify(config.auth.azureAuthDiscovery));
      }
      currentBranchContext.textContent = config.branch
        ? "Current branch: " + config.branch + (config.remote?.repository ? " · Repo: " + config.remote.repository : "") +
          (!config.remote?.isAzureDevOps && config.remote?.remoteUrl ? " · Remote: " + config.remote.remoteUrl : "")
        : "Current branch unavailable.";
    }

    function renderAuthProcess(authProcess) {
      if (!authProcess) {
        authOutput.hidden = true;
        authOutput.textContent = "";
        return;
      }
      authOutput.hidden = false;
      const output = authProcess.output || "Starting interactive sign-in...";
      authOutput.innerHTML = escapeHtml("[" + authProcess.provider + " · " + authProcess.status + "]\\n" + output);
      authOutput.scrollTop = authOutput.scrollHeight;
    }

    async function startInteractiveAuth(options = {}) {
      addLog("trace", "Starting AzureAuth token acquisition.");
      renderAuthProcess({
        provider: "azureauth",
        status: "running",
        output: options.autoTriggered
          ? "Authenticating with AzureAuth for Azure DevOps access..."
          : "Authenticating with AzureAuth...",
      });
      currentPullRequest.innerHTML = '<div class="status">Authenticating with AzureAuth...</div>';
      try {
        const data = await api("/api/auth/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        renderAuthProcess(data.authProcess);
        if (data.authProcess?.azureAuthDiscovery) {
          addLog("trace", "AzureAuth discovery for token acquisition.", JSON.stringify(data.authProcess.azureAuthDiscovery));
        }
        setWarning("");
        if (data.authProcess?.status === "succeeded") {
          addLog("trace", "AzureAuth token acquisition succeeded.");
          autoAuthAttempted = false;
          renderAuthProcess(null);
          await refreshAll(false);
          return;
        }
        autoAuthAttempted = true;
        addLog("error", "AzureAuth did not complete successfully.", data.authProcess?.output || "");
        currentPullRequest.innerHTML = '<div class="status">AzureAuth did not complete successfully. Click Refresh to try again.</div>';
      } catch (error) {
        autoAuthAttempted = true;
        addLog("error", "AzureAuth failed.", error.message || "");
        currentPullRequest.innerHTML = '<div class="status">' + escapeHtml(error.message || "AzureAuth failed.") + '</div>';
      }
    }

    async function signOut() {
      const signOutButton = document.getElementById("signOutButton");
      signOutButton.disabled = true;
      try {
        const data = await api("/api/auth/sign-out", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        renderAuthProcess(data.authProcess);
        autoAuthAttempted = false;
        addLog("trace", "Cleared cached AzureAuth token.");
        hideCreatePullRequestAction();
        await loadConfig();
        renderAuthPrompt(
          currentPullRequest,
          "AzureAuth is required to load the current branch pull request. Click Refresh to try again."
        );
      } finally {
        signOutButton.disabled = false;
      }
    }

    async function triggerTestError() {
      try {
        await api("/api/test-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
      } catch (error) {
        addLog("error", "Triggered test error.", error.message || "");
        authOutput.hidden = false;
        authOutput.innerHTML = escapeHtml(error.message || "Test error.");
      }
    }

    function renderCards(container, items, emptyMessage, render) {
      container.innerHTML = "";
      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "status";
        empty.textContent = emptyMessage;
        container.appendChild(empty);
        return;
      }
      for (const item of items) {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = render(item);
        container.appendChild(card);
      }
    }

    function renderAuthPrompt(container, message) {
      hideCreatePullRequestAction();
      container.innerHTML = "";
      const wrapper = document.createElement("div");
      wrapper.className = "grid";

      const text = document.createElement("div");
      text.className = "status";
      text.textContent = message;
      wrapper.appendChild(text);

      container.appendChild(wrapper);
    }

    function hideCreatePullRequestAction() {
      createPullRequestLink.hidden = true;
      createPullRequestLink.removeAttribute("href");
    }

    function formatPolicyStatus(status) {
      const normalized = String(status ?? "").toLowerCase();
      if (normalized === "succeeded" || normalized === "successed") {
        return "✅";
      }
      return escapeHtml(status || "unknown");
    }

    async function loadConfig() {
      addLog("trace", "Loading canvas configuration.");
      const data = await api("/api/config");
      fillSettings(data.config);
    }

    function renderPullRequestCard(pr) {
      const url = pr.webUrl ? '<a href="' + escapeHtml(pr.webUrl) + '" target="_blank" rel="noopener noreferrer">Open</a>' : "";
      const policyLines = (pr.policyEvaluations || []).map((policy) =>
        '<div class="meta">' + escapeHtml(policy.displayName) + ': ' +
          escapeHtml(policy.description || policy.status) +
          (policy.description ? ' (' + formatPolicyStatus(policy.status) + ')' : '') +
          '</div>'
      ).join("");
      const policies = policyLines
        ? '<div class="policy-list">' + policyLines + '</div>'
        : '<div class="meta">No policy evaluations returned.</div>';
      const commentLines = (pr.comments || []).map((comment) =>
        '<div class="comment-row">' +
          '<div class="meta comment-text">' + escapeHtml(comment.author) + ': ' + escapeHtml(comment.text) + '</div>' +
          (comment.webUrl ? '<a href="' + escapeHtml(comment.webUrl) + '" target="_blank" rel="noopener noreferrer">Open</a>' : '') +
        '</div>'
      ).join("");
      const comments = '<details><summary>Comments (' + String((pr.comments || []).length) + ')</summary>' +
        ((pr.comments || []).length
          ? '<div class="comment-list">' + commentLines + '</div>'
          : '<div class="meta">No comments.</div>') +
        '</details>';
      return '<div class="card-title"><span>!' + escapeHtml(pr.id) + ' ' + escapeHtml(pr.title) + '</span><span>' + url + '</span></div>' +
        '<div class="meta">' + escapeHtml(pr.repository) + ' · ' + escapeHtml(pr.sourceRefName) + ' → ' + escapeHtml(pr.targetRefName) + ' · ' + escapeHtml(pr.status) + '</div>' +
        policies +
        comments;
    }

    async function loadCurrentPullRequest() {
      addLog("trace", "Loading current branch pull request.");
      currentPullRequest.innerHTML = '<div class="status">Loading current branch pull request...</div>';
      hideCreatePullRequestAction();
      try {
        const data = await api("/api/current-pull-request");
        if (data.pullRequest) {
          addLog("trace", "Loaded current branch pull request.", "PR #" + data.pullRequest.id + ": " + data.pullRequest.title);
          renderCards(currentPullRequest, [data.pullRequest], "No pull request found for the current branch.", renderPullRequestCard);
        } else {
          let message = 'No pull request found for ' + escapeHtml(data.sourceRefName || "the current branch") + '.';
          if (data.remoteBranch && data.remoteBranch.exists === false) {
            message += ' Push ' + escapeHtml(data.remoteBranch.sourceRefName || data.sourceRefName || "the current branch") +
              ' to ' + escapeHtml(data.remoteBranch.remoteName || "the remote") + ' before creating a pull request.';
          }
          addLog("trace", "No pull request found for the current branch.", data.sourceRefName || "");
          currentPullRequest.innerHTML = '<div class="status">' + message + '</div>';
          if (data.canCreatePullRequest && data.createPullRequestUrl) {
            createPullRequestLink.href = data.createPullRequestUrl;
            createPullRequestLink.hidden = false;
          }
        }
      } catch (error) {
        addLog("error", "Failed to load current branch pull request.", error.message || "");
        currentPullRequest.innerHTML = '<div class="status">' + escapeHtml(error.message) + '</div>';
      }
    }

    async function refreshAll() {
      addLog("trace", "Refreshing canvas.");
      const autoAuthenticate = arguments.length ? arguments[0] : true;
      hideCreatePullRequestAction();
      await loadConfig();
      if (!currentConfig.remote?.isAzureDevOps) {
        renderAuthPrompt(currentPullRequest, formatRemoteWarning(currentConfig.remote));
        return;
      }
      if (!currentConfig.auth?.isAuthenticated) {
        if (autoAuthenticate && !autoAuthAttempted) {
          autoAuthAttempted = true;
          await startInteractiveAuth({ autoTriggered: true });
          return;
        }
        renderAuthPrompt(
          currentPullRequest,
          "AzureAuth is required to load the current branch pull request. Click Refresh to try again."
        );
        return;
      }
      await loadCurrentPullRequest();
    }

    document.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", async () => {
        document.querySelectorAll("[data-tab]").forEach((tab) => {
          tab.classList.toggle("active", tab === button);
          tab.classList.toggle("secondary", tab !== button);
        });
        document.querySelectorAll(".tab-panel").forEach((panel) => {
          panel.hidden = panel.id !== button.dataset.tab + "-panel";
        });
      });
    });

    document.getElementById("connectionSettingsSummary").addEventListener("dblclick", () => {
      const testErrorButton = document.getElementById("testErrorButton");
      testErrorButton.hidden = !testErrorButton.hidden;
    });
    document.getElementById("refreshButton").addEventListener("click", refreshAll);
    document.getElementById("signOutButton").addEventListener("click", signOut);
    document.getElementById("testErrorButton").addEventListener("click", triggerTestError);
    document.getElementById("reloadCurrentPullRequest").addEventListener("click", loadCurrentPullRequest);
    document.getElementById("copyLogsButton").addEventListener("click", copyLogs);
    document.getElementById("clearLogsButton").addEventListener("click", () => {
      logs = [];
      renderLogs();
    });
    addLog("trace", "Azure DevOps canvas loaded.");
    refreshAll().catch((error) => {
      addLog("error", "Canvas startup failed.", error.message || "");
      statusText.textContent = "Failed to load configuration.";
      currentPullRequest.innerHTML = '<div class="status">' + escapeHtml(error.message || "Failed to load configuration.") + '</div>';
    });
  </script>
</body>
</html>`;
}

async function startServer(instanceId, input) {
    const entry = { input: input || {}, apiNonce: base64Url(randomBytes(24)) };
    const server = createServer(async (req, res) => {
        const url = new URL(req.url || "/", entry.url || "http://127.0.0.1/");
        if (url.pathname.startsWith("/api/")) {
            await handleApi(entry, req, res, url);
            return;
        }
        htmlResponse(res, renderHtml(instanceId, entry.apiNonce));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    entry.server = server;
    entry.url = `http://127.0.0.1:${port}/`;
    return entry;
}

const canvasInputSchema = {
    type: "object",
    additionalProperties: false,
    properties: {},
};

copilotSession = await joinSession({
    canvases: [
        createCanvas({
            id: "azure-devops",
            displayName: "Azure DevOps",
            description: "Browse and manage Azure DevOps work items and pull requests from a canvas.",
            inputSchema: canvasInputSchema,
            actions: [
                {
                    name: "get_detected_remote",
                    description: "Return the Azure DevOps git remote detected from the current workspace.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        properties: {},
                    },
                    handler: async () => ({ remote: await detectAzureDevOpsRemoteFromWorkspace() }),
                },
                {
                    name: "get_connection_settings",
                    description: "Return the effective Azure DevOps connection settings and authentication status without exposing secrets.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        properties: {},
                    },
                    handler: async (ctx) => {
                        const config = await getEffectiveConfig({ ...(servers.get(ctx.instanceId)?.input || {}), ...(ctx.input || {}) });
                        const auth = await getAuthState();
                        return {
                            config: {
                                organization: config.organization,
                                project: config.project,
                                repositoryId: config.repositoryId,
                                apiVersion: config.apiVersion,
                                auth,
                            },
                        };
                    },
                },
                {
                    name: "query_work_items",
                    description: "Run a WIQL query and return matching Azure DevOps work items.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            wiql: { type: "string" },
                            top: { type: "number", minimum: 1, maximum: 200 },
                        },
                    },
                    handler: async (ctx) => queryWorkItems({ ...(servers.get(ctx.instanceId)?.input || {}), ...(ctx.input || {}) }),
                },
                {
                    name: "get_work_item",
                    description: "Fetch a single Azure DevOps work item by id.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        required: ["id"],
                        properties: {
                            id: { type: "number", minimum: 1 },
                        },
                    },
                    handler: async (ctx) => getWorkItem({ ...(servers.get(ctx.instanceId)?.input || {}), ...(ctx.input || {}) }),
                },
                {
                    name: "get_current_branch_pull_request",
                    description: "Return pull request details for the current git branch.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            branch: { type: "string" },
                        },
                    },
                    handler: async (ctx) => getCurrentBranchPullRequest({ ...(servers.get(ctx.instanceId)?.input || {}), ...(ctx.input || {}) }),
                },
                {
                    name: "create_pull_request",
                    description: "Create an Azure DevOps pull request for the current git branch.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            branch: { type: "string" },
                            targetRefName: { type: "string" },
                            title: { type: "string" },
                            description: { type: "string" },
                        },
                    },
                    handler: async (ctx) => createPullRequest({ ...(servers.get(ctx.instanceId)?.input || {}), ...(ctx.input || {}) }),
                },
                {
                    name: "list_repositories",
                    description: "List Azure DevOps Git repositories for the configured project.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        properties: {},
                    },
                    handler: async (ctx) => listRepositories({ ...(servers.get(ctx.instanceId)?.input || {}), ...(ctx.input || {}) }),
                },
            ],
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(ctx.instanceId, ctx.input || {});
                    servers.set(ctx.instanceId, entry);
                } else {
                    entry.input = { ...entry.input, ...(ctx.input || {}) };
                }
                return {
                    title: "Azure DevOps",
                    status: "Current branch PR",
                    url: entry.url,
                };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry?.server) {
                    servers.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(() => resolve()));
                }
            },
        }),
    ],
});
