import { createCanvas, joinSession } from "@github/copilot-sdk/extension";
import {
    addPullRequestComment,
    addWorkItemComment,
    canvasTitle,
    clearDefaultConnection,
    completePullRequest,
    createPullRequest,
    detectAzureDevOpsRemoteFromWorkspace,
    getAuthState,
    getConnections,
    getCurrentBranchPullRequest,
    getEffectiveConfig,
    getWorkItem,
    hasPullRequestReference,
    linkPullRequestWorkItem,
    listOrganizations,
    listProjects,
    listRepositories,
    removePullRequestReviewer,
    replyToPullRequestComment,
    searchIdentities,
    searchWorkItems,
    serializeCanvasInput,
    setCopilotSession,
    setConnection,
    setPullRequestDraft,
    setPullRequestReviewer,
    setPullRequestStatus,
    setPullRequestThreadStatus,
    setPullRequestVote,
    startServer,
    unlinkPullRequestWorkItem,
    updatePullRequest,
    updateWorkItemFields,
} from "./canvas-server.mjs";
import { hasWorkItemReference } from "./work-item.mjs";
import { PULL_REQUEST_REVIEW_VOTING_ENABLED } from "./ui/feature-flags.mjs";

const servers = new Map();

// Pull request actions all take the same shape: the canvas's own input, the
// action input, and the pull request id restated in the form the server reads.
function pullRequestActionInput(ctx, operation) {
    return operation({
        ...(servers.get(ctx.instanceId)?.input || {}),
        ...(ctx.input || {}),
        pullRequestId: ctx.input?.id,
        pullRequestUrl: "",
    });
}

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

const session = await joinSession({
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
                        const config = await getEffectiveConfig({
                            ...(servers.get(ctx.instanceId)?.input || {}),
                            ...(ctx.input || {}),
                        });
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
                    handler: async (ctx) => getWorkItem({
                        ...(servers.get(ctx.instanceId)?.input || {}),
                        ...(ctx.input || {}),
                    }),
                },
                {
                    name: "add_work_item_comment",
                    description: "Add a Markdown comment to an Azure DevOps work item discussion. Use search_identities and insert @<mentionId> in content to notify an identity.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        required: ["id", "content"],
                        properties: {
                            id: { type: "number", minimum: 1 },
                            content: { type: "string", minLength: 1 },
                        },
                    },
                    handler: async (ctx) => addWorkItemComment({
                        ...(servers.get(ctx.instanceId)?.input || {}),
                        ...(ctx.input || {}),
                        workItemId: ctx.input?.id,
                        workItemUrl: "",
                    }),
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
                    handler: async (ctx) => getCurrentBranchPullRequest({
                        ...(servers.get(ctx.instanceId)?.input || {}),
                        ...(ctx.input || {}),
                    }),
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
                    handler: async (ctx) => createPullRequest({
                        ...(servers.get(ctx.instanceId)?.input || {}),
                        ...(ctx.input || {}),
                    }),
                },
                {
                    name: "update_work_item",
                    description: "Update fields on an Azure DevOps work item. HTML fields must use the markup the canvas editor supports.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        required: ["id", "rev", "fields"],
                        properties: {
                            id: { type: "number", minimum: 1 },
                            rev: {
                                type: "number",
                                minimum: 1,
                                description: "Revision the edit is based on, from get_work_item. The update is rejected if the work item has changed since.",
                            },
                            fields: {
                                type: "array",
                                minItems: 1,
                                items: {
                                    type: "object",
                                    additionalProperties: false,
                                    required: ["name", "value"],
                                    properties: {
                                        name: { type: "string", minLength: 1 },
                                        value: { type: "string" },
                                        isHtml: {
                                            type: "boolean",
                                            description: "Legacy hint only. The server reads the field's current HTML or Markdown mode from Azure DevOps, so this cannot change or bypass validation.",
                                        },
                                    },
                                },
                            },
                        },
                    },
                    handler: async (ctx) => updateWorkItemFields({
                        ...(servers.get(ctx.instanceId)?.input || {}),
                        ...(ctx.input || {}),
                        workItemId: ctx.input?.id,
                        workItemUrl: "",
                        // An action authors markup rather than preserving markup
                        // Azure DevOps already held, so it stays on the strict
                        // policy. Stated rather than left to the input schema.
                        preservesStoredMarkup: false,
                    }),
                },
                {
                    name: "update_pull_request",
                    description: "Update the title or description of an Azure DevOps pull request.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        required: ["id"],
                        properties: {
                            id: { type: "number", minimum: 1 },
                            title: { type: "string", minLength: 1 },
                            description: { type: "string" },
                        },
                    },
                    handler: async (ctx) => updatePullRequest({
                        ...(servers.get(ctx.instanceId)?.input || {}),
                        ...(ctx.input || {}),
                        pullRequestId: ctx.input?.id,
                        pullRequestUrl: "",
                    }),
                },
                {
                    name: "add_pull_request_comment",
                    description: "Start a top-level discussion thread on an Azure DevOps pull request. Use search_identities and insert @<mentionId> in content to notify an identity.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        required: ["id", "content"],
                        properties: {
                            id: { type: "number", minimum: 1 },
                            content: { type: "string", minLength: 1 },
                        },
                    },
                    handler: async (ctx) => pullRequestActionInput(ctx, addPullRequestComment),
                },
                {
                    name: "reply_to_pull_request_comment",
                    description: "Reply to an existing Azure DevOps pull request discussion comment, including an inline code thread. Use search_identities and insert @<mentionId> in content to notify an identity.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        required: ["id", "threadId", "parentCommentId", "content"],
                        properties: {
                            id: { type: "number", minimum: 1 },
                            threadId: { type: "number", minimum: 1 },
                            parentCommentId: { type: "number", minimum: 1 },
                            content: { type: "string", minLength: 1 },
                        },
                    },
                    handler: async (ctx) => pullRequestActionInput(ctx, replyToPullRequestComment),
                },
                {
                    name: "set_pull_request_thread_status",
                    description: "Resolve an Azure DevOps pull request discussion thread as fixed, or reopen it as active.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        required: ["id", "threadId", "status"],
                        properties: {
                            id: { type: "number", minimum: 1 },
                            threadId: { type: "number", minimum: 1 },
                            status: { type: "string", enum: ["fixed", "active"] },
                        },
                    },
                    handler: async (ctx) => pullRequestActionInput(ctx, setPullRequestThreadStatus),
                },
                ...(PULL_REQUEST_REVIEW_VOTING_ENABLED ? [{
                    name: "vote_pull_request",
                    description: "Record the signed-in user's review vote on an Azure DevOps pull request: approve, approve with suggestions, wait for author, reject, or reset the existing vote.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        required: ["id", "vote"],
                        properties: {
                            id: { type: "number", minimum: 1 },
                            vote: {
                                type: "string",
                                enum: ["approve", "approve-with-suggestions", "wait-for-author", "reject", "reset"],
                            },
                        },
                    },
                    handler: async (ctx) => pullRequestActionInput(ctx, setPullRequestVote),
                }] : []),
                {
                    name: "set_pull_request_status",
                    description: "Abandon an Azure DevOps pull request, or reactivate one that was abandoned.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        required: ["id", "action"],
                        properties: {
                            id: { type: "number", minimum: 1 },
                            action: { type: "string", enum: ["abandon", "reactivate"] },
                        },
                    },
                    handler: async (ctx) => pullRequestActionInput(ctx, setPullRequestStatus),
                },
                {
                    name: "set_pull_request_draft",
                    description: "Mark an Azure DevOps pull request as a draft, or publish a draft for review.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        required: ["id", "isDraft"],
                        properties: {
                            id: { type: "number", minimum: 1 },
                            isDraft: { type: "boolean" },
                        },
                    },
                    handler: async (ctx) => pullRequestActionInput(ctx, setPullRequestDraft),
                },
                {
                    name: "complete_pull_request",
                    description: "Complete (merge) an Azure DevOps pull request. Branch policies are never bypassed.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        required: ["id"],
                        properties: {
                            id: { type: "number", minimum: 1 },
                            deleteSourceBranch: { type: "boolean" },
                            squashMerge: { type: "boolean" },
                            transitionWorkItems: { type: "boolean" },
                        },
                    },
                    handler: async (ctx) => pullRequestActionInput(ctx, completePullRequest),
                },
                {
                    name: "set_pull_request_reviewer",
                    description: "Add a reviewer to an Azure DevOps pull request, or change whether an existing reviewer is required or optional. Use search_identities to find the reviewer id.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        required: ["id", "reviewerId"],
                        properties: {
                            id: { type: "number", minimum: 1 },
                            reviewerId: { type: "string", minLength: 1 },
                            isRequired: { type: "boolean" },
                        },
                    },
                    handler: async (ctx) => pullRequestActionInput(ctx, setPullRequestReviewer),
                },
                {
                    name: "remove_pull_request_reviewer",
                    description: "Remove a reviewer from an Azure DevOps pull request.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        required: ["id", "reviewerId"],
                        properties: {
                            id: { type: "number", minimum: 1 },
                            reviewerId: { type: "string", minLength: 1 },
                        },
                    },
                    handler: async (ctx) => pullRequestActionInput(ctx, removePullRequestReviewer),
                },
                {
                    name: "link_pull_request_work_item",
                    description: "Link an Azure DevOps work item to a pull request.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        required: ["id", "workItemId"],
                        properties: {
                            id: { type: "number", minimum: 1 },
                            workItemId: { type: "number", minimum: 1 },
                        },
                    },
                    handler: async (ctx) => pullRequestActionInput(ctx, linkPullRequestWorkItem),
                },
                {
                    name: "unlink_pull_request_work_item",
                    description: "Remove the link between an Azure DevOps work item and a pull request.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        required: ["id", "workItemId"],
                        properties: {
                            id: { type: "number", minimum: 1 },
                            workItemId: { type: "number", minimum: 1 },
                        },
                    },
                    handler: async (ctx) => pullRequestActionInput(ctx, unlinkPullRequestWorkItem),
                },
                {
                    name: "search_identities",
                    description: "Search Azure DevOps users and groups by name or sign-in address. Reviewer actions take id; Markdown comments mention an identity with @<mentionId>.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        required: ["query"],
                        properties: {
                            query: { type: "string", minLength: 2 },
                        },
                    },
                    handler: async (ctx) => searchIdentities({
                        ...(servers.get(ctx.instanceId)?.input || {}),
                        ...(ctx.input || {}),
                    }),
                },
                {
                    name: "search_work_items",
                    description: "Search the project's work items by title, or resolve one by id. With no query it returns the work items assigned to the signed-in user, which is what the pull request work item picker suggests before the user types.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            query: { type: "string" },
                        },
                    },
                    handler: async (ctx) => searchWorkItems({
                        ...(servers.get(ctx.instanceId)?.input || {}),
                        ...(ctx.input || {}),
                    }),
                },
                {
                    name: "get_connections",
                    description: "Return the Azure DevOps connections the canvas reads from: the detected git remote, and the organization the user saved or pinned as their default.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        properties: {},
                    },
                    handler: async (ctx) => getConnections(servers.get(ctx.instanceId)?.input || {}),
                },
                {
                    name: "set_connection",
                    description: "Choose the Azure DevOps organization the canvas reads from when the workspace has no Azure DevOps git remote. Project and repository are optional; without a project the canvas shows work items across the organization but cannot list pull requests.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        required: ["organization"],
                        properties: {
                            organization: { type: "string", minLength: 1 },
                            project: { type: "string" },
                            repositoryId: { type: "string" },
                            isDefault: {
                                type: "boolean",
                                description: "Pin this connection as the default, so it is always shown even when a different Azure DevOps remote is detected. Without it the connection is only remembered as the most recent one.",
                            },
                        },
                    },
                    handler: async (ctx) => setConnection(servers.get(ctx.instanceId)?.input || {}, ctx.input || {}),
                },
                {
                    name: "clear_default_connection",
                    description: "Unpin the default Azure DevOps connection, leaving the most recently used one as the fallback.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        properties: {},
                    },
                    handler: async (ctx) => clearDefaultConnection(servers.get(ctx.instanceId)?.input || {}),
                },
                {
                    name: "list_organizations",
                    description: "List the Azure DevOps organizations the signed-in user belongs to.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        properties: {},
                    },
                    handler: async () => listOrganizations(),
                },
                {
                    name: "list_projects",
                    description: "List Azure DevOps projects in an organization. Defaults to the canvas's current connection.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            organization: { type: "string", minLength: 1 },
                        },
                    },
                    handler: async (ctx) => listProjects({
                        ...(servers.get(ctx.instanceId)?.input || {}),
                        ...(ctx.input || {}),
                    }),
                },
                {
                    name: "list_repositories",
                    description: "List Azure DevOps Git repositories. Scoped to the project when one is selected, otherwise to the whole organization.",
                    inputSchema: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            organization: { type: "string", minLength: 1 },
                            project: { type: "string" },
                        },
                    },
                    handler: async (ctx) => listRepositories({
                        ...(servers.get(ctx.instanceId)?.input || {}),
                        ...(ctx.input || {}),
                    }),
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
