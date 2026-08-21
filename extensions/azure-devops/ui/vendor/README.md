# Vendored dependencies

## `markdown-it.mjs`

A pre-built bundle of the Markdown renderer Azure DevOps itself uses, so the canvas
renders a pull request description the same way Azure DevOps will after it is saved.

The extension ships without `node_modules` and is loaded as native ES modules
straight off disk, so the dependency is committed as a single self-contained file
rather than installed.

### What is in it

| Package | Version | Why |
| --- | --- | --- |
| `markdown-it` | 14.2.0 | The renderer. Matches the version pinned in `AzureDevOps/.npm/default/package.json`. |
| `markdown-it-task-lists` | 2.0.1 | `- [ ]` / `- [x]` checklists, which Azure DevOps supports in pull request descriptions. |
| `markdown-it-emoji` | 3.1.0 | `:thumbsup:` shortcodes. Azure DevOps loads this too, and service-authored pull request comments write shortcodes rather than literal emoji. |

Azure DevOps also loads `markdown-it-imsize` and `markdown-it-container`. They are
deliberately left out: they cover syntax that is either wiki-only (`:::` containers)
or cosmetic in a preview (`=WxH` image sizing). Because the description is edited as
Markdown source, the bytes saved to Azure DevOps are exactly what the user typed - the
preview is advisory, so a gap there cannot corrupt content. Add a plugin if a gap
turns out to matter.

`markdown-it-emoji` was omitted on that reasoning until comment rendering proved the
exception: a comment is read-only, service-authored content, so an unrendered
shortcode is not an advisory gap but the wrong text on screen. It costs ~52 KB, which
is most of this bundle's growth.

### Source of the configuration

Azure DevOps builds its renderer in
`AzureDevOps/Vssf/Web/extensions/vss-features/vss-markdown/MarkdownRenderer.ts`.
It never sets `breaks`, so `markdown-it`'s default of `false` applies: a single
newline is **not** a line break, and two trailing spaces are required. That is the
opposite of GitHub's comment behaviour and the reason this file exists.

### Regenerating

```sh
scripts/build-vendor.sh
```

The script pins exact versions, bundles with `esbuild`, and writes
`ui/vendor/markdown-it.mjs`. Re-run it and commit the result when a version
changes; do not hand-edit the bundle.
