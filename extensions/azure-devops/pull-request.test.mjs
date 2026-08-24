import assert from "node:assert/strict";
import test from "node:test";

import { mapPullRequest, parsePullRequestUrl, selectCurrentBranchPullRequest } from "./pull-request.mjs";

const repository = {
    id: "11111111-2222-3333-4444-555555555555",
    name: "catalog",
    webUrl: "https://dev.azure.com/contoso/widgets/_git/catalog",
};

function rawPullRequest(overrides = {}) {
    return {
        pullRequestId: 4242,
        title: "Add the canvas home view",
        status: "active",
        sourceRefName: "refs/heads/users/example/home-view",
        targetRefName: "refs/heads/main",
        createdBy: { displayName: "Test Author", id: "user-1" },
        creationDate: "2026-07-30T12:00:00Z",
        description: "<p>Adds a home view.</p>",
        isDraft: false,
        reviewers: [{ id: "reviewer-1", displayName: "Test Reviewer", uniqueName: "reviewer@example.com", vote: 10, isRequired: true }],
        mergeStatus: "succeeded",
        url: "https://dev.azure.com/contoso/_apis/git/pullRequests/4242",
        _links: { web: { href: "https://dev.azure.com/contoso/widgets/_git/catalog/pullrequest/4242" } },
        ...overrides,
    };
}

test("mapPullRequest maps a raw Azure DevOps payload", () => {
    const mapped = mapPullRequest(rawPullRequest(), repository);

    assert.equal(mapped.id, 4242);
    assert.equal(mapped.repository, "catalog");
    assert.equal(mapped.repositoryId, repository.id);
    assert.equal(mapped.createdBy, "Test Author");
    assert.equal(mapped.webUrl, "https://dev.azure.com/contoso/widgets/_git/catalog/pullrequest/4242");
    // description keeps its markup now that the canvas renders rich text.
    assert.equal(mapped.description, "<p>Adds a home view.</p>");
    // The identity id and sign-in address survive mapping because the reviewer
    // actions address reviewers by id.
    assert.deepEqual(mapped.reviewers, [{
        id: "reviewer-1",
        displayName: "Test Reviewer",
        uniqueName: "reviewer@example.com",
        imageUrl: "",
        vote: 10,
        isRequired: true,
        isContainer: false,
        hasDeclined: false,
    }]);
});

test("mapPullRequest derives webUrl from the repository when _links is absent", () => {
    const mapped = mapPullRequest(rawPullRequest({ _links: undefined }), repository);

    assert.equal(mapped.webUrl, "https://dev.azure.com/contoso/widgets/_git/catalog/pullrequest/4242");
});

// Regression: mapping an already-mapped pull request used to read pullRequestId
// off the mapped shape, yielding id undefined, webUrl "", and createdBy "".
test("mapPullRequest is idempotent", () => {
    const once = mapPullRequest(rawPullRequest(), repository);
    const twice = mapPullRequest(once, repository);

    assert.equal(twice.id, 4242);
    assert.equal(twice.createdBy, "Test Author");
    assert.equal(twice.repository, "catalog");
    assert.equal(twice.repositoryId, repository.id);
    assert.equal(twice.webUrl, "https://dev.azure.com/contoso/widgets/_git/catalog/pullrequest/4242");
    assert.deepEqual(twice, once);
});

// Regression: the current-branch view selected from the mapped array and passed
// the mapped pull request into getPullRequestDetails, which maps a second time.
// The selected candidate must expose the untouched Azure DevOps payload.
test("selectCurrentBranchPullRequest returns the raw payload for the selection", () => {
    const raw = rawPullRequest();
    const { selected } = selectCurrentBranchPullRequest([raw], repository);

    assert.equal(selected.raw, raw);
    assert.equal(selected.raw.pullRequestId, 4242);
    assert.equal(mapPullRequest(selected.raw, repository).id, 4242);
});

test("selectCurrentBranchPullRequest prefers an active pull request", () => {
    const completed = rawPullRequest({ pullRequestId: 1, status: "completed" });
    const active = rawPullRequest({ pullRequestId: 2, status: "active" });

    const { selected, pullRequests, visibleCount } = selectCurrentBranchPullRequest([completed, active], repository);

    assert.equal(selected.mapped.id, 2);
    assert.equal(visibleCount, 2);
    assert.deepEqual(pullRequests.map((pr) => pr.id), [1, 2]);
});

test("selectCurrentBranchPullRequest falls back to the first non-abandoned pull request", () => {
    const abandoned = rawPullRequest({ pullRequestId: 1, status: "abandoned" });
    const completed = rawPullRequest({ pullRequestId: 2, status: "completed" });

    const { selected, pullRequests, visibleCount } = selectCurrentBranchPullRequest([abandoned, completed], repository);

    assert.equal(selected.mapped.id, 2);
    assert.equal(visibleCount, 1);
    // Abandoned pull requests stay in the returned list even though they are never selected.
    assert.deepEqual(pullRequests.map((pr) => pr.id), [1, 2]);
});

test("selectCurrentBranchPullRequest reports no selection when every pull request is abandoned", () => {
    const { selected, visibleCount } = selectCurrentBranchPullRequest(
        [rawPullRequest({ status: "abandoned" })],
        repository,
    );

    assert.equal(selected, null);
    assert.equal(visibleCount, 0);
});

test("selectCurrentBranchPullRequest handles an empty result set", () => {
    const { selected, pullRequests, visibleCount } = selectCurrentBranchPullRequest([], repository);

    assert.equal(selected, null);
    assert.equal(visibleCount, 0);
    assert.deepEqual(pullRequests, []);
});

test("parsePullRequestUrl reads dev.azure.com and visualstudio.com urls", () => {
    assert.deepEqual(parsePullRequestUrl("https://dev.azure.com/contoso/widgets/_git/catalog/pullrequest/4242"), {
        organization: "contoso",
        project: "widgets",
        repository: "catalog",
        id: 4242,
    });
    assert.deepEqual(parsePullRequestUrl("https://contoso.visualstudio.com/widgets/_git/catalog/pullrequest/7"), {
        organization: "contoso",
        project: "widgets",
        repository: "catalog",
        id: 7,
    });
});

test("parsePullRequestUrl rejects unusable urls", () => {
    assert.equal(parsePullRequestUrl(""), null);
    assert.equal(parsePullRequestUrl("not a url"), null);
    assert.equal(parsePullRequestUrl("https://github.com/contoso/catalog/pull/4242"), null);
    assert.equal(parsePullRequestUrl("https://dev.azure.com/contoso/widgets/_git/catalog/pullrequest/0"), null);
});
