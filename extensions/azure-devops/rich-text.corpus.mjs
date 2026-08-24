// Cases taken from real Azure DevOps pull request content.
//
// Surveyed one Azure DevOps organisation on 2026-08-05: 373 comments and
// descriptions across the 40 most recent active pull requests. Two findings
// drive these tests.
//
// Reviewers write type parameters and placeholders in prose, and every one of
// them is shaped exactly like an HTML tag. All of the TYPE_PARAMETERS entries
// below were found in real comments, by several different authors.
//
// Comments are also mostly machine written: 133 of the 173 comments carried raw
// HTML, 2,244 tag occurrences in total, nearly all of it from automation bots.
// That markup has to keep rendering, which is why the renderer
// cannot simply escape everything.
//
// `text` lists substrings the reader must still be able to see.
// `markup` lists tag names that must survive as real elements.

export const TYPE_PARAMETERS = [
    {
        id: "di-registration",
        source: "Register it with serviceCollection.AddSingleton<SigningKeyProvider>(); first.",
        text: ["AddSingleton<SigningKeyProvider>"],
    },
    {
        id: "nested-generic",
        source: "Resolve it through sp.GetRequiredService<ILogger<SigningKeyProvider>>() instead.",
        text: ["GetRequiredService<ILogger<SigningKeyProvider>>"],
    },
    {
        id: "options-monitor",
        source: "Use sp.GetRequiredService<IOptionsMonitor<TokenSettings>>() so reloads are picked up.",
        text: ["IOptionsMonitor<TokenSettings>"],
    },
    {
        id: "rust-vec",
        source: "The field should be Vec<ExternalOtelSetting> rather than a bare string.",
        text: ["Vec<ExternalOtelSetting>"],
    },
    {
        id: "rust-option",
        source: "Return Option<String> here and let the caller decide.",
        text: ["Option<String>"],
    },
    {
        id: "dictionary",
        source: "It is a Dictionary<string, string> keyed by ring name.",
        text: ["Dictionary<string, string>"],
    },
    {
        id: "log-field-placeholder",
        source: "Each one becomes log_field_<name> in the exported schema.",
        text: ["log_field_<name>"],
    },
    {
        id: "config-key-placeholder",
        source: "Set experimentalFeaturesMayBreakAtAnyTime.<key> to opt in.",
        text: ["experimentalFeaturesMayBreakAtAnyTime.<key>"],
    },
    {
        id: "task-generic",
        source: "Await the Task<HttpResponseMessage> before disposing the client.",
        text: ["Task<HttpResponseMessage>"],
    },
    {
        id: "single-letter-parameter",
        source: "Return Vec<U> from the handler and let the caller map it.",
        text: ["Vec<U>"],
    },
    {
        id: "borrowed-parameter",
        source: "Prefer Vec<&str> for the borrowed case.",
        text: ["Vec<&str>"],
    },
];

export const BOT_MARKUP = [
    {
        id: "deployment-badge",
        source: '<img src="https://www.contoso.com/static/v1?label=Deployment&message=Valid&color=green">',
        markup: ["img"],
    },
    {
        id: "quantifier-heading",
        source: "### ![](https://www.contoso.com/static/v1?label=Quantified&message=Extra%20Small&color=green)",
        markup: ["img"],
    },
    {
        id: "deployment-table",
        source: "<table><tr><td>App</td><td><strong>SampleApp</strong></td></tr></table>",
        markup: ["table", "tr", "td", "strong"],
    },
    {
        id: "execution-footer",
        source: '<p align="right"><sub>Total execution time: 20.39 seconds</sub></p>',
        markup: ["p", "sub"],
        text: ["Total execution time: 20.39 seconds"],
    },
    {
        id: "feedback-links",
        source: '<a href="https://www.contoso.com/feedback" target="_blank" title="Thumbs up"><strong>:thumbsup:</strong></a>',
        markup: ["a", "strong"],
    },
    {
        id: "inline-break",
        source: "First line<br>second line",
        markup: ["br"],
        text: ["First line", "second line"],
    },
    {
        // Bots emit whole tables with one tag per line, so an opening tag and
        // its closing half never share a line.
        id: "deployment-table-block",
        source: [
            "<table>",
            "<tr>",
            "<td><strong>SampleApp</strong></td>",
            "</tr>",
            "</table>",
        ].join("\n"),
        markup: ["table", "tr", "td", "strong"],
        text: ["SampleApp"],
    },
];

// PullRequestQuantifier emits allow-listed details/summary markup in both compact
// and multi-line forms. The elements must render and their text must survive.
export const COLLAPSIBLE_MARKUP = [
    {
        id: "quantifier-details",
        source: "<details><summary><strong>Quantification details</strong></summary>Label: Extra Small</details>",
        text: ["Quantification details", "Label: Extra Small"],
    },
    {
        // The shape PullRequestQuantifier actually posts, and it posts on nearly
        // every pull request: the tags are spread over separate lines and the
        // opening one carries a trailing space.
        id: "quantifier-details-block",
        source: [
            "<details >",
            '    <summary display="inline"> <strong>Quantification details</strong></summary>',
            "    <p />",
            "",
            "Label: Extra Small",
            "",
            "</details>",
        ].join("\n"),
        text: ["Quantification details", "Label: Extra Small"],
    },
];
