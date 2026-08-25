import { createCanvas, joinSession } from "@github/copilot-sdk/extension";
import {
    canvasTitle,
    hasPullRequestReference,
    serializeCanvasInput,
    setCopilotSession,
    startServer,
} from "./canvas-server.mjs";
import { hasWorkItemReference } from "./work-item.mjs";

const servers = new Map();

const canvasInputSchema = {
    type: "object",
    additionalProperties: false,
    anyOf: [
        { maxProperties: 0 },
        { required: ["pullRequestUrl"] },
        { required: ["organization", "project", "pullRequestId"] },
        { required: ["org", "project", "pullRequestId"] },
        { required: ["workItemUrl"] },
        { required: ["organization", "project", "workItemId"] },
        { required: ["org", "project", "workItemId"] },
    ],
    properties: {
        pullRequestUrl: { type: "string", minLength: 1 },
        workItemUrl: { type: "string", minLength: 1 },
        organization: { type: "string", minLength: 1 },
        org: { type: "string", minLength: 1 },
        project: { type: "string", minLength: 1 },
        repository: { type: "string", minLength: 1 },
        repositoryId: { type: "string", minLength: 1 },
        pullRequestId: { type: "number", minimum: 1 },
        workItemId: { type: "number", minimum: 1 },
    },
};

const showReferenceSchema = {
    type: "object",
    additionalProperties: false,
    anyOf: [
        { required: ["url"] },
        { required: ["organization", "project", "id"] },
        { required: ["org", "project", "id"] },
    ],
    properties: {
        url: { type: "string", minLength: 1 },
        organization: { type: "string", minLength: 1 },
        org: { type: "string", minLength: 1 },
        project: { type: "string", minLength: 1 },
        id: { type: "number", minimum: 1 },
    },
};

function referenceInput(input, kind) {
    if (input.url) {
        return kind === "pull-request"
            ? { pullRequestUrl: input.url }
            : { workItemUrl: input.url };
    }
    const common = {
        organization: input.organization || input.org,
        project: input.project,
    };
    return kind === "pull-request"
        ? { ...common, pullRequestId: input.id }
        : { ...common, workItemId: input.id };
}

let session;

async function showReference(ctx, kind) {
    return session.rpc.canvas.open({
        extensionId: ctx.extensionId,
        canvasId: ctx.canvasId,
        instanceId: ctx.instanceId,
        input: referenceInput(ctx.input || {}, kind),
    });
}

session = await joinSession({
    canvases: [
        createCanvas({
            id: "azure-devops",
            displayName: "Azure DevOps",
            description: "Browse and manage Azure DevOps work items and pull requests from a canvas.",
            inputSchema: canvasInputSchema,
            actions: [
                {
                    name: "show_ado_pull_request",
                    description: "Show an Azure DevOps pull request from its URL or organization, project, and ID.",
                    inputSchema: showReferenceSchema,
                    handler: async (ctx) => showReference(ctx, "pull-request"),
                },
                {
                    name: "show_ado_work_item",
                    description: "Show an Azure DevOps work item from its URL or organization, project, and ID.",
                    inputSchema: showReferenceSchema,
                    handler: async (ctx) => showReference(ctx, "work-item"),
                },
            ],
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(ctx.instanceId, ctx.input || {});
                    servers.set(ctx.instanceId, entry);
                } else {
                    const input = ctx.input || {};
                    if (serializeCanvasInput(entry.input) !== serializeCanvasInput(input)) {
                        await new Promise((resolve) => entry.server.close(resolve));
                        entry = await startServer(ctx.instanceId, input);
                        servers.set(ctx.instanceId, entry);
                    }
                }
                return {
                    title: canvasTitle(entry.input),
                    status: hasWorkItemReference(entry.input)
                        ? "Work Item"
                        : hasPullRequestReference(entry.input)
                        ? "Pull Request"
                        : "My work",
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

setCopilotSession(session);
