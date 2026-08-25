// Run with: node --test connection.test.mjs
//
// The connection module is the answer to "which Azure DevOps organization does
// this canvas read from", which used to be answerable only by the workspace's
// git remote. These tests cover the store, the precedence rules, and the
// selector check that keeps a request from reaching an organization the canvas
// never resolved.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { SyntheticModule, SourceTextModule, createContext } from "node:vm";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const modulePath = new URL("./connection.mjs", import.meta.url);

// The store writes into the user's home directory, so the module is loaded under
// node:vm with node:os stubbed to a per-test temporary home. That is the only way
// to exercise the real file without touching the developer's own ~/.copilot.
async function loadConnection(home) {
    const context = createContext({
        Buffer, URL, URLSearchParams, console, setTimeout, clearTimeout, Date, JSON, Math,
        Number, String, Object, Array, Promise, Error, Set, Map,
    });
    const synthetic = (specifier) => {
        const exports = {
            "node:http": { createServer },
            "node:crypto": { createHash, randomBytes },
            "node:fs": { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync },
            "node:os": { homedir: () => home },
            "node:path": { dirname, extname, isAbsolute, join, relative, resolve },
            "node:url": { fileURLToPath },
            "node:util": { promisify },
        }[specifier];
        if (!exports) return null;
        return new SyntheticModule(Object.keys(exports), function () {
            for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
        }, { context });
    };
    const cache = new Map();
    const initializeImportMeta = (meta, module) => { meta.url = module.identifier; };
    const loadRelative = async (href) => {
        if (cache.has(href)) return cache.get(href);
        const mod = new SourceTextModule(await readFile(new URL(href), "utf8"), { context, identifier: href, initializeImportMeta });
        cache.set(href, mod);
        await mod.link(linker);
        return mod;
    };
    async function linker(specifier, referencingModule) {
        const stub = synthetic(specifier);
        if (stub) return stub;
        if (specifier.startsWith(".")) return loadRelative(new URL(specifier, referencingModule.identifier).href);
        throw new Error(`Unexpected import: ${specifier}`);
    }
    const module = new SourceTextModule(await readFile(modulePath, "utf8"), { context, identifier: modulePath.href, initializeImportMeta });
    await module.link(linker);
    await module.evaluate();
    return module.namespace;
}

function withHome() {
    const home = mkdtempSync(join(tmpdir(), "azure-devops-connection-"));
    return { home, path: join(home, ".copilot", "azure-devops-canvas", "connection.json") };
}

const remote = (organization, project) => ({
    isAzureDevOps: true,
    organization,
    project,
    repository: "repo",
    remoteName: "origin",
    remoteUrl: `https://dev.azure.com/${organization}/${project}/_git/repo`,
});

test("an organization is the only thing a connection needs", async () => {
    const { home } = withHome();
    const { normalizeConnection } = await loadConnection(home);
    // Compared field by field: the module is evaluated in its own vm realm, so a
    // deep-equality check against a host-realm literal fails on prototypes alone.
    const normalized = normalizeConnection({ organization: "contoso" });
    assert.equal(normalized.organization, "contoso");
    assert.equal(normalized.project, "");
    assert.equal(normalized.repositoryId, "");
    assert.equal(normalizeConnection({ project: "widgets" }), null, "a project alone names no organization");
    assert.equal(normalizeConnection(null), null);
});

test("org is accepted as an alias for organization, matching the canvas input schema", async () => {
    const { home } = withHome();
    const { normalizeConnection } = await loadConnection(home);
    assert.equal(normalizeConnection({ org: "contoso", repository: "repo" }).organization, "contoso");
    assert.equal(normalizeConnection({ org: "contoso", repository: "repo" }).repositoryId, "repo");
});

test("identity is organization and project, and ignores case and repository", async () => {
    const { home } = withHome();
    const { sameConnection } = await loadConnection(home);
    assert.ok(sameConnection({ organization: "Contoso", project: "Widgets" }, { organization: "contoso", project: "widgets" }));
    assert.ok(
        sameConnection({ organization: "contoso", repositoryId: "a" }, { organization: "contoso", repositoryId: "b" }),
        "two repositories in one project show the same work items, so they are one connection",
    );
    assert.ok(!sameConnection({ organization: "contoso", project: "widgets" }, { organization: "contoso" }));
});

test("a selection is remembered as last used, and only pinned when asked", async () => {
    const { home, path } = withHome();
    const { writeConnectionPreference, readConnectionPreference } = await loadConnection(home);

    writeConnectionPreference({ organization: "contoso", project: "widgets" });
    let record = readConnectionPreference();
    assert.equal(record.lastUsed.organization, "contoso");
    assert.equal(record.default, null, "an unpinned selection is not a default");

    writeConnectionPreference({ organization: "fabrikam" }, { isDefault: true });
    record = readConnectionPreference();
    assert.equal(record.default.organization, "fabrikam");
    assert.equal(record.lastUsed.organization, "fabrikam");

    writeConnectionPreference({ organization: "contoso" });
    record = readConnectionPreference();
    assert.equal(record.default.organization, "fabrikam", "an unpinned selection leaves the default alone");
    assert.equal(record.lastUsed.organization, "contoso");

    // Node accepts mode on Windows but reports files as 0o666 because POSIX
    // permission bits do not map to Windows ACLs.
    if (process.platform !== "win32") {
        assert.equal(statSync(path).mode & 0o777, 0o600, "the record is written owner-only");
    }
});

test("clearing the default leaves the last used connection", async () => {
    const { home } = withHome();
    const { writeConnectionPreference, clearConnectionDefault, readConnectionPreference } = await loadConnection(home);
    writeConnectionPreference({ organization: "fabrikam" }, { isDefault: true });
    clearConnectionDefault();
    const record = readConnectionPreference();
    assert.equal(record.default, null);
    assert.equal(record.lastUsed.organization, "fabrikam");
});

test("clearing the connection preference removes all saved connection state", async () => {
    const { home, path } = withHome();
    const {
        writeConnectionPreference,
        clearConnectionPreference,
        readConnectionPreference,
    } = await loadConnection(home);
    writeConnectionPreference(
        { organization: "fabrikam", project: "widgets", repositoryId: "widgets-api" },
        { isDefault: true },
    );

    assert.equal(clearConnectionPreference(), true);
    assert.equal(existsSync(path), false);
    assert.equal(readConnectionPreference().default, null);
    assert.equal(readConnectionPreference().lastUsed, null);
    assert.equal(clearConnectionPreference(), false, "clearing an already empty preference is idempotent");
});

test("a missing or corrupt record reads as the first-run state rather than throwing", async () => {
    const { home, path } = withHome();
    const { readConnectionPreference } = await loadConnection(home);
    assert.equal(readConnectionPreference().default, null);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not json");
    assert.equal(readConnectionPreference().default, null);
});

test("with no remote and no saved connection there is nothing to read from", async () => {
    const { home } = withHome();
    const { resolveConnections } = await loadConnection(home);
    assert.equal(resolveConnections({ remote: null }).length, 0);
});

test("a detected Azure DevOps remote is the connection when nothing is saved", async () => {
    const { home } = withHome();
    const { resolveConnections } = await loadConnection(home);
    const [connection, ...rest] = resolveConnections({ remote: remote("contoso", "widgets") });
    assert.equal(rest.length, 0);
    assert.equal(connection.source, "remote");
    assert.equal(connection.organization, "contoso");
    assert.equal(connection.project, "widgets");
    assert.equal(connection.repositoryId, "repo");
});

test("a saved connection is the connection when there is no remote", async () => {
    const { home } = withHome();
    const { resolveConnections, writeConnectionPreference } = await loadConnection(home);
    writeConnectionPreference({ organization: "fabrikam" });
    const connections = resolveConnections({ remote: null });
    assert.equal(connections.length, 1);
    assert.equal(connections[0].source, "last-used");
    assert.equal(connections[0].organization, "fabrikam");
    assert.equal(connections[0].isDefault, false);
});

test("choosing a connection while a default is pinned shows the choice, and keeps the default", async () => {
    const { home } = withHome();
    const { resolveConnections, writeConnectionPreference } = await loadConnection(home);
    writeConnectionPreference({ organization: "fabrikam" }, { isDefault: true });
    writeConnectionPreference({ organization: "contoso" });
    const connections = resolveConnections({ remote: null });
    // Returning only the default here made an explicit selection look like it had
    // not been saved: the record changed and nothing on screen did.
    assert.equal(
        connections.map((c) => `${c.source}:${c.organization}`).join(", "),
        "last-used:contoso, default:fabrikam",
    );
    assert.equal(connections[0].isDefault, false);
    assert.equal(connections[1].isDefault, true);
});

test("pinning a connection leaves one entry, since it is also the last one used", async () => {
    const { home } = withHome();
    const { resolveConnections, writeConnectionPreference } = await loadConnection(home);
    writeConnectionPreference({ organization: "fabrikam" }, { isDefault: true });
    const connections = resolveConnections({ remote: null });
    assert.equal(connections.length, 1);
    assert.equal(connections[0].organization, "fabrikam");
    assert.equal(connections[0].isDefault, true);
});

test("a remote ranks above a default, and the default is still included", async () => {
    const { home } = withHome();
    const { resolveConnections, writeConnectionPreference } = await loadConnection(home);
    writeConnectionPreference({ organization: "fabrikam", project: "boxes" }, { isDefault: true });
    const connections = resolveConnections({ remote: remote("contoso", "widgets") });
    assert.equal(
        connections.map((c) => `${c.source}:${c.organization}`).join(", "),
        "remote:contoso, default:fabrikam",
    );
});

test("a repository change is stored and resolved back", async () => {
    const { home } = withHome();
    const { resolveConnections, writeConnectionPreference } = await loadConnection(home);
    writeConnectionPreference({ organization: "fabrikam", project: "widgets", repositoryId: "widgets-api" });
    assert.equal(resolveConnections({ remote: null })[0].repositoryId, "widgets-api");
    writeConnectionPreference({ organization: "fabrikam", project: "widgets", repositoryId: "other-repo" });
    const connections = resolveConnections({ remote: null });
    assert.equal(connections.length, 1, "same organization and project, so it replaces rather than stacks");
    assert.equal(connections[0].repositoryId, "other-repo");
});

test("a default that matches the remote collapses into it rather than showing twice", async () => {
    const { home } = withHome();
    const { resolveConnections, writeConnectionPreference } = await loadConnection(home);
    writeConnectionPreference({ organization: "contoso", project: "widgets" }, { isDefault: true });
    const connections = resolveConnections({ remote: remote("Contoso", "Widgets") });
    assert.equal(connections.length, 1);
    assert.equal(connections[0].source, "remote");
    assert.equal(connections[0].isDefault, true, "the collapsed connection is still reported as pinned");
});

test("canvas input wins outright, so a deep link is unaffected by a saved connection", async () => {
    const { home } = withHome();
    const { resolveConnections, writeConnectionPreference } = await loadConnection(home);
    writeConnectionPreference({ organization: "fabrikam" }, { isDefault: true });
    const connections = resolveConnections({
        input: { organization: "northwind", project: "shipping" },
        remote: remote("contoso", "widgets"),
    });
    assert.equal(connections.length, 1);
    assert.equal(connections[0].source, "input");
    assert.equal(connections[0].organization, "northwind");
});

test("input that matches the remote keeps the remote attached for repository matching", async () => {
    const { home } = withHome();
    const { resolveConnections } = await loadConnection(home);
    const detected = remote("contoso", "widgets");
    const [matching] = resolveConnections({ input: { organization: "contoso", project: "widgets" }, remote: detected });
    assert.equal(matching.remote, detected);
    const [different] = resolveConnections({ input: { organization: "northwind", project: "widgets" }, remote: detected });
    assert.equal(different.remote, null, "a remote from another organization can only mislead repository matching");
});

test("a request may only name a connection the canvas resolved", async () => {
    const { home } = withHome();
    const { resolveConnections, selectConnection, writeConnectionPreference } = await loadConnection(home);
    writeConnectionPreference({ organization: "fabrikam", project: "boxes" }, { isDefault: true });
    const connections = resolveConnections({ remote: remote("contoso", "widgets") });

    assert.equal(selectConnection(connections, { organization: "fabrikam", project: "boxes" }).source, "default");
    assert.equal(
        selectConnection(connections, { organization: "attacker" }),
        null,
        "an unresolved organization is refused rather than reached",
    );
    assert.equal(
        selectConnection(connections, {}).source,
        "remote",
        "a request that names nothing gets the primary connection",
    );
});

test("a connection that could not be written is reported, not reported as saved", async () => {
    const { home } = withHome();
    const { writeConnectionPreference, clearConnectionDefault } = await loadConnection(home);
    // A read-only home is what a sandboxed or misowned HOME looks like. Reporting
    // success here would send the user back to an empty picker on the next load
    // with nothing to explain it, and no way out of that loop.
    rmSync(home, { recursive: true, force: true });
    writeFileSync(home, "not a directory");
    assert.throws(
        () => writeConnectionPreference({ organization: "fabrikam" }),
        (error) => error.code === "azure_devops_connection_write_failed",
    );
    assert.throws(
        () => clearConnectionDefault(),
        (error) => error.code === "azure_devops_connection_write_failed",
    );
});
