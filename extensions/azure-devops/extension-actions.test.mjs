import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SourceTextModule, SyntheticModule, createContext } from "node:vm";

const source = readFileSync(new URL("./extension.mjs", import.meta.url), "utf8");

async function loadExtension() {
    let declaration;
    let opened;
    const context = createContext({});
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
            this.setExport("startServer", async () => ({ input: {}, url: "http://127.0.0.1/" }));
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
    const module = new SourceTextModule(source, { context });
    await module.link((specifier) => {
        if (specifier === "@github/copilot-sdk/extension") return sdk;
        if (specifier === "./canvas-server.mjs") return server;
        if (specifier === "./work-item.mjs") return workItem;
        throw new Error(`Unexpected import: ${specifier}`);
    });
    await module.evaluate();
    return {
        declaration,
        invoke: async (name, input) => {
            opened = undefined;
            const action = declaration.actions.find((candidate) => candidate.name === name);
            assert.ok(action, `Missing action ${name}`);
            await action.handler({
                extensionId: "test:azure-devops",
                canvasId: "azure-devops",
                instanceId: "ado-1",
                input,
            });
            return opened;
        },
    };
}

test("only pull request and work item navigation actions are exposed", async () => {
    const { declaration } = await loadExtension();
    assert.deepEqual(
        Array.from(declaration.actions, (action) => action.name),
        ["show_ado_pull_request", "show_ado_work_item"],
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
