// Connection selection for the canvas: which Azure DevOps organization (and
// optionally project and repository) the canvas reads from.
//
// The canvas used to derive this solely from the session workspace's git remote,
// which meant it was unusable outside an Azure DevOps repository. A connection is
// now an explicit value with three possible sources, and the workspace remote is
// only one of them:
//
//   input   the canvas input, e.g. a deep link to a pull request or work item
//   remote  the Azure DevOps git remote detected in the session workspace
//   saved   an organization the user picked in the canvas, persisted on disk
//
// The saved connection has two flavors held in one record: a default the user
// explicitly pinned, and the last one they selected. Both are resolved, most
// recently selected first, and they collapse into one entry when they are the
// same organization and project — which is the usual case, since pinning also
// records the connection as the last one used. Returning only the default made
// an explicit selection look like it had not been saved.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { normalizeString } from "./common.mjs";

const CONNECTION_FILE_VERSION = 1;

export const CONNECTION_SOURCE_INPUT = "input";
export const CONNECTION_SOURCE_REMOTE = "remote";
export const CONNECTION_SOURCE_DEFAULT = "default";
export const CONNECTION_SOURCE_LAST_USED = "last-used";

export function connectionPreferencePath() {
    return join(homedir(), ".copilot", "azure-devops-canvas", "connection.json");
}

// A connection is only meaningful with an organization. Project and repository
// stay optional: Azure DevOps answers work item, repository, and project queries
// at organization scope, so requiring a project would make the picker ask for
// more than the data needs.
export function normalizeConnection(value) {
    const organization = normalizeString(value?.organization || value?.org);
    if (!organization) {
        return null;
    }
    return {
        organization,
        project: normalizeString(value?.project),
        repositoryId: normalizeString(value?.repositoryId || value?.repository),
    };
}

// Identity is organization plus project, deliberately excluding the repository:
// two connections differing only by repository would show the same work items
// and the same project-wide pull requests, so stacking both on Home would be
// duplicate content rather than a second view.
export function connectionKey(connection) {
    const normalized = normalizeConnection(connection);
    if (!normalized) {
        return "";
    }
    return `${normalized.organization.toLowerCase()}/${normalized.project.toLowerCase()}`;
}

export function sameConnection(left, right) {
    const leftKey = connectionKey(left);
    return Boolean(leftKey) && leftKey === connectionKey(right);
}

function normalizeRecord(value) {
    return {
        version: CONNECTION_FILE_VERSION,
        default: normalizeConnection(value?.default),
        lastUsed: normalizeConnection(value?.lastUsed),
        updatedAt: normalizeString(value?.updatedAt),
    };
}

export function readConnectionPreference() {
    try {
        return normalizeRecord(JSON.parse(readFileSync(connectionPreferencePath(), "utf8")));
    } catch {
        // A missing or unreadable file means no saved connection, which is the
        // first-run state rather than an error: the canvas asks the user to pick.
        return normalizeRecord(null);
    }
}

export const CONNECTION_WRITE_FAILED = "azure_devops_connection_write_failed";

function persist(record) {
    const next = { ...normalizeRecord(record), updatedAt: new Date().toISOString() };
    const path = connectionPreferencePath();
    mkdirSync(dirname(path), { recursive: true });
    // writeFileSync only applies mode when it creates the file, so a record
    // written before this was restricted would keep its old permissions.
    rmSync(path, { force: true });
    writeFileSync(path, JSON.stringify(next, null, 2), { mode: 0o600 });
    return next;
}

// Every manual selection updates lastUsed, so a user who never pins a default
// still returns to the organization they were last looking at. Pinning also
// writes the default; unpinning clears it without disturbing lastUsed.
//
// A write failure is raised rather than swallowed. The record is the only place
// a connection lives, so a canvas that reported success on an unwritable home
// would send the user back to an empty picker on the next load with nothing to
// explain it, and no way out of that loop.
export function writeConnectionPreference(connection, { isDefault = false } = {}) {
    const normalized = normalizeConnection(connection);
    if (!normalized) {
        return readConnectionPreference();
    }
    const record = readConnectionPreference();
    return persistOrFail({
        default: isDefault ? normalized : record.default,
        lastUsed: normalized,
    });
}

function persistOrFail(record) {
    try {
        return persist(record);
    } catch (error) {
        const failure = new Error(`Could not save the Azure DevOps connection: ${error?.message || "write failed"}`);
        failure.code = CONNECTION_WRITE_FAILED;
        throw failure;
    }
}

export function clearConnectionDefault() {
    const record = readConnectionPreference();
    return persistOrFail({ default: null, lastUsed: record.lastUsed });
}

// The saved connections, most recently chosen first. Both are returned rather
// than only the default, because an explicit selection has to be visible: with
// only the default returned, saving a different organization without pinning it
// updated the record but changed nothing on screen, which reads as the setting
// not sticking.
export function savedConnections(record = readConnectionPreference()) {
    const saved = [];
    if (record.lastUsed) {
        saved.push({ connection: record.lastUsed, source: CONNECTION_SOURCE_LAST_USED });
    }
    if (record.default) {
        saved.push({ connection: record.default, source: CONNECTION_SOURCE_DEFAULT });
    }
    return saved;
}

// Ordering is the whole point of this function, and it encodes a product
// decision: a detected Azure DevOps remote is the priority view, because the
// repository the user is sitting in is the one they are most likely asking
// about. The saved connections are always included, ranked below the remote when
// they differ and collapsing into it when they are the same organization and
// project. Among themselves, the most recently selected comes before the pinned
// default, so an explicit choice is the one the rest of the canvas resolves
// against.
//
// Canvas input is different in kind: a deep link to a specific pull request or
// work item names its own organization, so it wins outright and is the only
// connection. That keeps every existing deep-link path behaving exactly as it
// did before connections existed.
export function resolveConnections({ input, remote, record } = {}) {
    const inputConnection = normalizeConnection(input);
    if (inputConnection) {
        return [{
            ...inputConnection,
            source: CONNECTION_SOURCE_INPUT,
            isDefault: false,
            remote: remote?.isAzureDevOps && sameConnection(remote, inputConnection) ? remote : null,
        }];
    }

    const connections = [];
    const seen = new Set();
    const add = (connection, source, { isDefault = false, remote: attachedRemote = null } = {}) => {
        const normalized = normalizeConnection(connection);
        const key = connectionKey(normalized);
        if (!normalized || seen.has(key)) {
            return;
        }
        seen.add(key);
        connections.push({ ...normalized, source, isDefault, remote: attachedRemote });
    };

    const resolvedRecord = record || readConnectionPreference();
    const saved = savedConnections(resolvedRecord);
    const isPinned = (connection) => Boolean(resolvedRecord.default && sameConnection(resolvedRecord.default, connection));
    if (remote?.isAzureDevOps) {
        add(
            { organization: remote.organization, project: remote.project, repositoryId: remote.repository },
            CONNECTION_SOURCE_REMOTE,
            // A pinned default that matches the remote collapses into it rather
            // than rendering twice, but the connection is still reported as the
            // default so the picker can show it as pinned.
            { isDefault: isPinned(remote), remote },
        );
    }
    // Most recently chosen first, then the pinned default. They collapse into one
    // entry when they are the same organization and project, which is the usual
    // case: pinning a connection also records it as the last one used, so the
    // pinned one is labelled as the default wherever it lands.
    for (const entry of saved) {
        const pinned = isPinned(entry.connection);
        add(entry.connection, pinned ? CONNECTION_SOURCE_DEFAULT : entry.source, { isDefault: pinned });
    }
    return connections;
}

// Requests name the connection they are for, and that name is checked against
// the resolved set rather than trusted. Without this a request could reach any
// organization it liked, which would also defeat validateAvatarUrl: that check
// only proves an avatar belongs to the organization the request claimed.
export function selectConnection(connections, selector) {
    const requested = normalizeConnection(selector);
    if (!requested) {
        return connections[0] || null;
    }
    const match = connections.find((connection) => sameConnection(connection, requested));
    return match || null;
}
