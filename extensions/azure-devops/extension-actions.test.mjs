import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SourceTextModule, SyntheticModule, createContext } from "node:vm";

const source = readFileSync(new URL("./extension.mjs", import.meta.url), "utf8");
const hasPreviewFeatures = source.includes("\"./azdo-board.mjs\"");

async function loadExtension({ failBoardCleanup = false, failDelegationCleanup = false } = {}) {
    let declaration;
    let delegationCloseAttempts = 0;
    let lifecycle;
    let opened;
    let serverClosed = false;
    const cleanupErrors = [];
    const context = createContext({
        console: {
            error: (...args) => cleanupErrors.push(args.map(String).join(" ")),
        },
    });
    const session = {
        rpc: {
            canvas: {
                open: async (input) => {
                    opened = input;
                    return input;
                },
            },
        },
    };
    const sdk = new SyntheticModule(
        ["createCanvas", "joinSession"],
        function initialize() {
            this.setExport("createCanvas", (canvas) => canvas);
            this.setExport("joinSession", async (config) => {
                declaration = config.canvases[0];
                return session;
            });
        },
        { context },
    );
    const server = new SyntheticModule(
        ["canvasTitle", "hasPullRequestReference", "serializeCanvasInput", "setCopilotSession", "startServer"],
        function initialize() {
            this.setExport("canvasTitle", () => "Azure DevOps");
            this.setExport("hasPullRequestReference", () => false);
            this.setExport("serializeCanvasInput", JSON.stringify);
            this.setExport("setCopilotSession", () => {});
            this.setExport("startServer", async (_instanceId, _input, handlers) => {
                lifecycle = handlers;
                return {
                    input: {},
                    url: "http://127.0.0.1/",
                    closeBoards: async () => {
                        if (failBoardCleanup) throw new Error("board cleanup failed");
                    },
                    server: {
                        close: (callback) => {
                            serverClosed = true;
                            callback();
                        },
                    },
                };
            });
        },
        { context },
    );
    const workItem = new SyntheticModule(
        ["hasWorkItemReference"],
        function initialize() {
            this.setExport("hasWorkItemReference", () => false);
        },
        { context },
    );
    const board = new SyntheticModule(
        [
            "azdoBoardActions",
            "azdoBoardTools",
            "closeAzdoBoard",
            "delegateAzdoWorkItem",
            "openAzdoBoard",
            "setAzdoBoardSession",
        ],
        function initialize() {
            this.setExport("azdoBoardActions", [{ name: "refresh_board" }]);
            this.setExport("azdoBoardTools", []);
            this.setExport("closeAzdoBoard", async () => {
                delegationCloseAttempts += 1;
                if (failDelegationCleanup) throw new Error("delegation cleanup failed");
            });
            this.setExport("delegateAzdoWorkItem", async () => ({}));
            this.setExport("openAzdoBoard", async () => ({}));
            this.setExport("setAzdoBoardSession", () => {});
        },
        { context },
    );
    const module = new SourceTextModule(source, { context });
    await module.link((specifier) => {
        if (specifier === "@github/copilot-sdk/extension") return sdk;
        if (specifier === "./azdo-board.mjs") return board;
        if (specifier === "./canvas-server.mjs") return server;
        if (specifier === "./work-item.mjs") return workItem;
        throw new Error(`Unexpected import: ${specifier}`);
    });
    await module.evaluate();
    const canvasContext = {
        extensionId: "test:azure-devops",
        canvasId: "azure-devops",
        instanceId: "ado-1",
        input: {},
    };
    return {
        cleanupErrors,
        declaration,
        delegate: async () => lifecycle.delegateWorkItem({
            connection: { organization: "contoso", project: "project" },
            dataProvider: {},
            force: false,
            item: { id: 123 },
            mode: "local",
        }),
        delegationCloseAttempts: () => delegationCloseAttempts,
        invoke: async (name, input) => {
            opened = undefined;
            const action = declaration.actions.find((candidate) => candidate.name === name);
            assert.ok(action, `Missing action ${name}`);
            await action.handler({
                ...canvasContext,
                input,
            });
            return opened;
        },
        open: async () => declaration.open(canvasContext),
        close: async () => declaration.onClose(canvasContext),
        serverClosed: () => serverClosed,
    };
}

test("navigation and board actions are exposed", async () => {
    const { declaration } = await loadExtension();
    assert.deepEqual(
        Array.from(declaration.actions, (action) => action.name),
        hasPreviewFeatures
            ? ["show_ado_pull_request", "show_ado_work_item", "refresh_board"]
            : ["show_ado_pull_request", "show_ado_work_item"],
    );
});

test("navigation actions reopen the canvas from URLs or organization references", async () => {
    const { invoke } = await loadExtension();

    assert.deepEqual(
        structuredClone(await invoke("show_ado_pull_request", {
            url: "https://dev.azure.com/contoso/project/_git/repo/pullrequest/42",
        })),
        {
            extensionId: "test:azure-devops",
            canvasId: "azure-devops",
            instanceId: "ado-1",
            input: {
                pullRequestUrl: "https://dev.azure.com/contoso/project/_git/repo/pullrequest/42",
            },
        },
    );
    assert.deepEqual(
        structuredClone(await invoke("show_ado_work_item", {
            org: "contoso",
            project: "project",
            id: 123,
        })),
        {
            extensionId: "test:azure-devops",
            canvasId: "azure-devops",
            instanceId: "ado-1",
            input: {
                organization: "contoso",
                project: "project",
                workItemId: 123,
            },
        },
    );
});

test("canvas cleanup closes the server after board and delegation failures", async () => {
    const extension = await loadExtension({
        failBoardCleanup: true,
        failDelegationCleanup: true,
    });
    await extension.open();
    if (hasPreviewFeatures) {
        await extension.delegate();
    }

    await extension.close();

    assert.equal(extension.serverClosed(), true);
    if (hasPreviewFeatures) {
        assert.equal(extension.delegationCloseAttempts(), 1);
        assert.equal(extension.cleanupErrors.length, 2);
        assert.ok(extension.cleanupErrors.some((message) => /board cleanup failed/.test(message)));
        assert.ok(extension.cleanupErrors.some((message) => /delegation cleanup failed/.test(message)));
    } else {
        assert.equal(extension.delegationCloseAttempts(), 0);
        assert.equal(extension.cleanupErrors.length, 0);
    }
});
