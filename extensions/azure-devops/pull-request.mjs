import { normalizeRichText, normalizeString } from "./common.mjs";

export function parsePullRequestUrl(pullRequestUrl) {
    const rawUrl = normalizeString(pullRequestUrl);
    if (!rawUrl) {
        return null;
    }

    try {
        const url = new URL(rawUrl);
        const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
        const pullRequestIndex = segments.findIndex((segment) => segment.toLowerCase() === "pullrequest");
        const id = Number(segments[pullRequestIndex + 1]);
        if (pullRequestIndex < 0 || !Number.isInteger(id) || id <= 0) {
            return null;
        }

        if (url.hostname.toLowerCase() === "dev.azure.com") {
            if (pullRequestIndex < 4 || segments[2]?.toLowerCase() !== "_git") {
                return null;
            }
            return {
                organization: segments[0],
                project: segments[1],
                repository: segments[3],
                id,
            };
        }

        if (url.hostname.toLowerCase().endsWith(".visualstudio.com")) {
            const gitIndex = segments.findIndex((segment) => segment.toLowerCase() === "_git");
            if (gitIndex < 1 || gitIndex + 2 > pullRequestIndex) {
                return null;
            }
            return {
                organization: decodeURIComponent(url.hostname.slice(0, -".visualstudio.com".length)),
                project: segments[gitIndex - 1],
                repository: segments[gitIndex + 1],
                id,
            };
        }
    } catch {
        return null;
    }

    return null;
}

export function mapPullRequest(pr, repositoryOverride = {}) {
    // Tolerate being handed an already-mapped pull request: the raw Azure DevOps
    // shape and the mapped shape carry the same data under different keys, and a
    // silent second mapping previously produced an undefined id and empty webUrl.
    const id = pr.pullRequestId ?? pr.id;
    const rawRepository = pr.repository && typeof pr.repository === "object" ? pr.repository : {};
    const repository = { ...repositoryOverride, ...rawRepository };
    const rawSourceRepository = pr.forkSource?.repository && typeof pr.forkSource.repository === "object"
        ? pr.forkSource.repository
        : {};
    const repositoryWebUrl = normalizeString(repository.webUrl);
    const createdBy = typeof pr.createdBy === "string" ? pr.createdBy : pr.createdBy?.displayName || "";
    return {
        id,
        title: pr.title,
        status: pr.status,
        repository: repository.name || (typeof pr.repository === "string" ? pr.repository : ""),
        repositoryId: repository.id || "",
        // Azure DevOps uses `repository` for the target. A fork can have a
        // different source repository where comment fixes must be applied.
        sourceRepository: rawSourceRepository.name || pr.sourceRepository || repository.name || "",
        sourceRepositoryId: rawSourceRepository.id || pr.sourceRepositoryId || repository.id || "",
        sourceRefName: pr.sourceRefName || "",
        targetRefName: pr.targetRefName || "",
        createdBy,
        creationDate: pr.creationDate || "",
        description: normalizeRichText(pr.description),
        isDraft: Boolean(pr.isDraft),
        reviewers: (pr.reviewers || []).map((reviewer) => ({
            // The identity id is what the reviewer routes address, so it has to
            // survive mapping even though nothing rendered it before.
            id: normalizeString(reviewer.id),
            displayName: normalizeString(reviewer.displayName) || "Unknown",
            uniqueName: normalizeString(reviewer.uniqueName),
            imageUrl: normalizeString(reviewer.imageUrl),
            vote: Number(reviewer.vote) || 0,
            isRequired: Boolean(reviewer.isRequired),
            isContainer: Boolean(reviewer.isContainer),
            hasDeclined: Boolean(reviewer.hasDeclined),
        })),
        mergeStatus: normalizeString(pr.mergeStatus) || "notSet",
        mergeStatusDate: pr.lastMergeSourceCommit?.committer?.date || pr.mergeStatusDate || pr.creationDate || "",
        url: pr.url || "",
        webUrl: pr._links?.web?.href || normalizeString(pr.webUrl) || (repositoryWebUrl && id ? `${repositoryWebUrl}/pullrequest/${id}` : ""),
    };
}

// Selects the pull request the current-branch view should render.
// Returns the selected candidate with its `raw` Azure DevOps payload attached:
// callers must pass `raw` (not `mapped`) to anything that maps again.
export function selectCurrentBranchPullRequest(rawPullRequests = [], repository = {}) {
    const candidates = rawPullRequests.map((raw) => ({ raw, mapped: mapPullRequest(raw, repository) }));
    const isStatus = (candidate, status) => normalizeString(candidate.mapped.status).toLowerCase() === status;
    const visible = candidates.filter((candidate) => !isStatus(candidate, "abandoned"));
    return {
        pullRequests: candidates.map(({ mapped }) => mapped),
        visibleCount: visible.length,
        selected: visible.find((candidate) => isStatus(candidate, "active")) || visible[0] || null,
    };
}

export function mapPolicyEvaluation(evaluation, statusById = new Map()) {
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
        isRequired: Boolean(configuration.isBlocking),
    };
}
