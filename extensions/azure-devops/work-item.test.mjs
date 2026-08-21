// Run with: node --test work-item.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { mapWorkItemDetail, parseWorkItemTemplate } from "./work-item.mjs";

const xmlForm = `
<FORM><WebLayout>
  <Page Label="Details" LayoutMode="FirstColumnWide">
    <Section>
      <Group Label="Details">
        <Control Type="HtmlFieldControl" FieldName="System.Description" Label="Description" />
        <Control Type="HtmlFieldControl" FieldName="Microsoft.VSTS.TCM.ReproSteps" Label="Repro Steps" />
        <Control Type="FieldControl" FieldName="Custom.Build" Label="Build" />
        <Control Type="FieldControl" FieldName="Custom.Never" Label="Never Set" />
        <Control Type="FieldControl" FieldName="System.Title" Label="Title" />
      </Group>
    </Section>
    <Section>
      <Group Label="Planning">
        <Control Type="FieldControl" FieldName="Microsoft.VSTS.Common.Priority" Label="Priority" />
      </Group>
    </Section>
    <Section>
      <Group Label="Classification">
        <Control Type="FieldControl" FieldName="System.AreaPath" Label="Area" />
      </Group>
    </Section>
  </Page>
</WebLayout></FORM>`;

const legacyColumnForm = `
<FORM><Layout><Group>
  <Column><Group Label="Main"><Control Type="FieldControl" FieldName="Custom.Main" /></Group></Column>
  <Column><Group Label="Side"><Control Type="FieldControl" FieldName="Custom.Side" /></Group></Column>
</Group></Layout></FORM>`;

const nestedLegacyColumnForm = `
<FORM><Layout><TabGroup><Tab Label="Details"><Group>
  <Column PercentWidth="50">
    <Group><Column PercentWidth="100">
      <Group Label="Description">
        <Control Type="HtmlFieldControl" FieldName="System.Description" />
      </Group>
    </Column></Group>
  </Column>
  <Column PercentWidth="50"><Group>
    <Column PercentWidth="25">
      <Group Label="Planning">
        <Control Type="FieldControl" FieldName="Microsoft.VSTS.Common.Priority" />
      </Group>
    </Column>
    <Column PercentWidth="25">
      <Group Label="Development">
        <Control Type="LinksControl" FieldName="Development" />
      </Group>
      <Group Label="System Info">
        <Control Type="FieldControl" FieldName="Microsoft.VSTS.Build.FoundIn" />
      </Group>
    </Column>
  </Group></Column>
</Group></Tab></TabGroup></Layout></FORM>`;

const dualLayoutForm = `
<FORM>
  <Layout>
    <Group Label="Legacy">
      <Control Type="FieldControl" FieldName="Custom.Legacy" Label="Legacy" />
      <Control Type="FieldControl" FieldName="Microsoft.VSTS.Common.Triage" Label="&amp;Triage:" />
    </Group>
  </Layout>
  <WebLayout>
    <Page Label="Create &amp; Triage">
      <Section>
        <Group Label="Status">
          <Control Type="FieldControl" FieldName="Microsoft.VSTS.Common.Triage" Label="Triage" />
          <Control Type="FieldControl" FieldName="Custom.Team" Label="R&amp;D" />
        </Group>
      </Section>
    </Page>
    <Page Label="Partner">
      <Section>
        <Group Label="Status">
          <Control Type="FieldControl" FieldName="Microsoft.VSTS.Common.Triage" Label="Duplicate triage" />
          <Control Type="HtmlFieldControl" FieldName="Microsoft.VSTS.TCM.ReproSteps" Label="Repro Steps" />
        </Group>
      </Section>
    </Page>
    <Page Label="Servicing">
      <Section>
        <Group Label="Repro Steps">
          <Control Type="HtmlFieldControl" FieldName="Microsoft.VSTS.TCM.ReproSteps" Label="Duplicate repro" />
        </Group>
      </Section>
    </Page>
  </WebLayout>
</FORM>`;

const nestedDuplicateForm = `
<FORM><Layout>
  <Group Label="Outer">
    <Group Label="Inner">
      <Control Type="FieldControl" FieldName="Custom.Duplicate" Label="First label" />
    </Group>
    <Control Type="FieldControl" FieldName="Custom.Duplicate" Label="Later label" />
  </Group>
</Layout></FORM>`;

const legacyMnemonicForm = `
<FORM><Layout>
  <Group Label="Create &amp; Triage">
    <Control Type="FieldControl" FieldName="Custom.Triage" Label="&amp;Triage:" />
    <Control Type="FieldControl" FieldName="Custom.AssignedTo" Label="Assi&amp;gned To" />
    <Control Type="FieldControl" FieldName="Custom.Team" Label="R&amp;&amp;D" />
  </Group>
</Layout></FORM>`;

const typeDefinition = {
    color: "009ccc",
    states: [
        { name: "New", color: "b2b2b2", category: "Proposed" },
        { name: "Active", color: "007acc", category: "InProgress" },
        { name: "Hidden", color: "000000", category: "Removed", hidden: true },
    ],
};

function detail(fields = {}, options = {}, itemOverrides = {}) {
    return mapWorkItemDetail(
        {
            id: 42,
            rev: 7,
            fields: { "System.WorkItemType": "Bug", "System.Title": "Broken", "System.State": "Active", ...fields },
            ...itemOverrides,
        },
        [],
        parseWorkItemTemplate(xmlForm),
        { typeDefinition, ...options },
    );
}

test("the template parser records whether a control holds HTML", () => {
    const [section] = parseWorkItemTemplate(xmlForm);
    assert.equal(section.fields.find((field) => field.name === "System.Description").isHtml, true);
    assert.equal(section.fields.find((field) => field.name === "Custom.Build").isHtml, false);
});

test("the template parser preserves modern Azure DevOps WebLayout sections", () => {
    assert.deepEqual(
        parseWorkItemTemplate(xmlForm).map((section) => [section.title, section.column]),
        [["Details", 1], ["Planning", 2], ["Classification", 3]],
    );
});

test("the template parser preserves legacy Azure DevOps columns", () => {
    assert.deepEqual(
        parseWorkItemTemplate(legacyColumnForm).map((section) => [section.title, section.column]),
        [["Main", 1], ["Side", 2]],
    );
});

test("nested legacy right-side columns stay outside the main content column", () => {
    assert.deepEqual(
        parseWorkItemTemplate(nestedLegacyColumnForm).map((section) => [section.title, section.column]),
        [["Description", 1], ["Planning", 2], ["System Info", 2]],
    );
});

test("the web layout wins over the legacy layout and repeated controls appear once", () => {
    const sections = parseWorkItemTemplate(dualLayoutForm);
    const fields = sections.flatMap((section) => section.fields);

    assert.ok(!fields.some((field) => field.name === "Custom.Legacy"));
    assert.equal(fields.filter((field) => field.name === "Microsoft.VSTS.Common.Triage").length, 1);
    assert.equal(fields.filter((field) => field.name === "Microsoft.VSTS.TCM.ReproSteps").length, 1);
    assert.equal(fields.find((field) => field.name === "Microsoft.VSTS.Common.Triage").label, "Triage");
});

test("web layout labels decode XML entities without stripping literal ampersands", () => {
    const fields = parseWorkItemTemplate(dualLayoutForm).flatMap((section) => section.fields);

    assert.equal(fields.find((field) => field.name === "Custom.Team").label, "R&D");
});

test("legacy layout labels hide ADO mnemonics and preserve escaped ampersands", () => {
    const [section] = parseWorkItemTemplate(legacyMnemonicForm);
    const labels = Object.fromEntries(section.fields.map((field) => [field.name, field.label]));

    assert.equal(section.title, "Create & Triage");
    assert.equal(labels["Custom.Triage"], "Triage:");
    assert.equal(labels["Custom.AssignedTo"], "Assigned To");
    assert.equal(labels["Custom.Team"], "R&D");
});

test("deduplication retains the first control when it is inside a nested group", () => {
    const sections = parseWorkItemTemplate(nestedDuplicateForm);

    assert.deepEqual(sections.map((section) => section.title), ["Inner"]);
    assert.equal(sections[0].fields[0].label, "First label");
});

test("the revision travels with the mapped item", () => {
    // Without it the canvas cannot send the concurrency check on save.
    assert.equal(detail().rev, 7);
    assert.equal(mapWorkItemDetail({ id: 1, fields: {} }, [], []).rev, 0);
});

test("template fields carry their reference name and format", () => {
    const [section] = detail({ "System.Description": "<div>Some detail</div>" }).templateSections;
    const description = section.fields.find((field) => field.name === "Description");
    assert.equal(description.field, "System.Description");
    assert.equal(description.isHtml, true);
    assert.equal(description.value, "<div>Some detail</div>");
    assert.equal(description.format, "html");
    assert.equal(description.isRichText, true);
});

test("per-item multiline formats override the rich control type", () => {
    const item = detail(
        { "Microsoft.VSTS.TCM.ReproSteps": "# Reproduce\n\n1. Open the canvas" },
        {},
        {
            multilineFieldsFormat: {
                "Microsoft.VSTS.TCM.ReproSteps": "Markdown",
            },
        },
    );
    const repro = item.templateSections[0].fields
        .find((field) => field.field === "Microsoft.VSTS.TCM.ReproSteps");
    assert.equal(repro.format, "markdown");
    assert.equal(repro.isRichText, true);
    assert.equal(repro.isHtml, false);
});

test("the format map identifies custom rich fields even when the form uses FieldControl", () => {
    const item = detail(
        { "Custom.Build": "## Build notes" },
        {},
        { multilineFieldsFormat: { "Custom.Build": "Markdown" } },
    );
    const build = item.templateSections[0].fields.find((field) => field.field === "Custom.Build");
    assert.equal(build.format, "markdown");
    assert.equal(build.isRichText, true);
    assert.equal(build.isHtml, false);
});

test("numeric multiline format values are normalized and missing values default to HTML", () => {
    const markdown = detail(
        { "System.Description": "# Markdown" },
        {},
        { multilineFieldsFormat: { "System.Description": 0 } },
    ).templateSections[0].fields.find((field) => field.field === "System.Description");
    const html = detail(
        { "System.Description": "<p>HTML</p>" },
        {},
        { multilineFieldsFormat: { "System.Description": 1 } },
    ).templateSections[0].fields.find((field) => field.field === "System.Description");
    const fallback = detail({ "System.Description": "<p>Legacy HTML</p>" })
        .templateSections[0].fields.find((field) => field.field === "System.Description");

    assert.equal(markdown.format, "markdown");
    assert.equal(html.format, "html");
    assert.equal(fallback.format, "html");
});

test("only state, reason, area, and iteration are promoted to the summary block", () => {
    const item = detail({
        "System.Reason": "Work started",
        "System.AreaPath": "Agency\\Canvas",
        "System.IterationPath": "Agency\\Sprint 12",
        "Microsoft.VSTS.Common.Priority": 2,
    });
    assert.deepEqual(
        item.details.map(({ name, value }) => [name, value]),
        [
            ["State", "Active"],
            ["Reason", "Work started"],
            ["Area", "Agency\\Canvas"],
            ["Iteration", "Agency\\Sprint 12"],
        ],
    );
    const planning = item.templateSections.find((section) => section.title === "Planning");
    assert.equal(planning.column, 2);
    assert.equal(planning.fields[0].name, "Priority");
    assert.equal(planning.fields[0].value, "2");
});

test("primary fields are kept when empty so a blank one can be filled in", () => {
    const [section] = detail().templateSections;
    const names = section.fields.map((field) => field.name);
    assert.ok(names.includes("Description"), "an empty Description must still be offered");
    assert.ok(names.includes("Repro Steps"), "an empty Repro Steps must still be offered");
});

test("other empty fields stay hidden so the view is not buried in blank rows", () => {
    const [section] = detail().templateSections;
    assert.ok(!section.fields.some((field) => field.name === "Never Set"));
});

test("a non-primary field appears once it has a value", () => {
    const [section] = detail({ "Custom.Never": "now set" }).templateSections;
    const field = section.fields.find((entry) => entry.name === "Never Set");
    assert.equal(field.value, "now set");
    assert.equal(field.isHtml, false);
});

test("fields rendered elsewhere are not repeated in the template sections", () => {
    const [section] = detail().templateSections;
    assert.ok(!section.fields.some((field) => field.field === "System.Title"));
});

test("selectable states exclude hidden ones", () => {
    assert.deepEqual(detail().states, ["New", "Active"]);
});

test("a type without a state list yields no picker options", () => {
    assert.deepEqual(mapWorkItemDetail({ id: 1, fields: {} }, [], []).states, []);
});

test("discussion preserves author image URLs for the avatar proxy", () => {
    const authorImageUrl = "https://dev.azure.com/example/_api/_common/identityImage?id=ada";
    const item = mapWorkItemDetail(
        { id: 1, fields: {} },
        [{
            id: 2,
            createdBy: { displayName: "Ada", imageUrl: authorImageUrl },
            createdDate: "2025-01-02T12:00:00Z",
            text: "<p>Looks good.</p>",
        }],
        [],
    );

    assert.equal(item.discussion[0].author, "Ada");
    assert.equal(item.discussion[0].authorImageUrl, authorImageUrl);
});

test("discussion keeps legacy HTML and uses rendered HTML for Markdown comments", () => {
    const item = mapWorkItemDetail(
        { id: 1, fields: {} },
        [
            {
                id: 1,
                format: "html",
                text: "<div>Legacy</div>",
                createdDate: "2025-01-01T12:00:00Z",
            },
            {
                id: 2,
                format: "markdown",
                text: "Hello @<mention-id>",
                renderedText: '<p>Hello <a href="#" data-vss-mention="version:2.0,mention-id">@Ada</a></p>',
                createdDate: "2025-01-02T12:00:00Z",
            },
        ],
        [],
    );

    assert.deepEqual(item.discussion.map(({ id, format, text }) => ({ id, format, text })), [
        {
            id: 2,
            format: "html",
            text: '<p>Hello <a href="#" data-vss-mention="version:2.0,mention-id">@Ada</a></p>',
        },
        { id: 1, format: "html", text: "<div>Legacy</div>" },
    ]);
});

test("identity fields preserve image URLs for compact work-item metadata", () => {
    const item = detail({
        "System.AssignedTo": { displayName: "Ada", imageUrl: "https://dev.azure.com/example/assigned.png" },
        "System.CreatedBy": { displayName: "Grace", imageUrl: "https://dev.azure.com/example/created.png" },
        "System.ChangedBy": { displayName: "Linus", imageUrl: "https://dev.azure.com/example/changed.png" },
    });

    assert.equal(item.assignedTo, "Ada");
    assert.equal(item.assignedToImageUrl, "https://dev.azure.com/example/assigned.png");
    assert.equal(item.createdByImageUrl, "https://dev.azure.com/example/created.png");
    assert.equal(item.changedByImageUrl, "https://dev.azure.com/example/changed.png");
});

test("development artifacts and related work map to navigable sidebar links", () => {
    const relatedById = new Map([[
        7,
        {
            id: 7,
            type: "Bug",
            title: "Linked failure",
            state: "Active",
            changedDate: "2026-08-06T12:00:00Z",
            project: "Service Platform",
            webUrl: "https://dev.azure.com/example/Agency/_workitems/edit/7",
        },
    ]]);
    const item = mapWorkItemDetail({
        id: 42,
        fields: {
            "System.WorkItemType": "User Story",
            "System.Title": "Build the sidebar",
            "System.State": "Active",
        },
        relations: [
            {
                rel: "ArtifactLink",
                url: "vstfs:///Git/PullRequestId/project-guid%2Frepo-guid%2F922952",
                attributes: { name: "Pull Request", comment: "Fix flaky extension publish" },
            },
            {
                rel: "ArtifactLink",
                url: "vstfs:///Git/Ref/project-guid%2Frepo-guid%2FGBmaster",
                attributes: { name: "Branch" },
            },
            {
                rel: "ArtifactLink",
                url: "vstfs:///Git/Commit/project-guid%2Frepo-guid%2F2c80c54abc",
                attributes: { name: "Fixed in Commit" },
            },
            {
                rel: "ArtifactLink",
                url: "vstfs:///Build/Build/1234",
                attributes: { name: "Integrated in build" },
            },
            {
                rel: "System.LinkTypes.Related",
                url: "https://dev.azure.com/example/Agency/_apis/wit/workItems/7",
            },
        ],
    }, [], [], {
        projectWebUrl: "https://dev.azure.com/example/Agency",
        relatedById,
    });

    const development = item.relations.find((group) => group.name === "Development").links;
    assert.deepEqual(
        development.map((entry) => [entry.kind, entry.label, entry.webUrl]),
        [
            [
                "pull-request",
                "Pull request 922952",
                "https://dev.azure.com/example/project-guid/_git/repo-guid/pullrequest/922952",
            ],
            [
                "branch",
                "master",
                "https://dev.azure.com/example/project-guid/_git/repo-guid?version=GBmaster",
            ],
            [
                "commit",
                "Commit 2c80c54a",
                "https://dev.azure.com/example/project-guid/_git/repo-guid/commit/2c80c54abc",
            ],
            [
                "build",
                "Build 1234",
                "https://dev.azure.com/example/Agency/_build/results?buildId=1234&view=results",
            ],
        ],
    );

    const related = item.relations.find((group) => group.name === "Related").links[0];
    assert.equal(related.id, 7);
    assert.equal(related.title, "Linked failure");
    assert.equal(related.changedDate, "2026-08-06T12:00:00Z");
    assert.equal(related.project, "Service Platform");
    assert.equal(related.webUrl, "https://dev.azure.com/example/Agency/_workitems/edit/7");
});
