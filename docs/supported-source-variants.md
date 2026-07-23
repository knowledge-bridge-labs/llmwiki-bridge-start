# Supported Source Variants

`llmwiki-bridge-start discover` is a heuristic finder. It does not certify that
a folder is usable. The compatibility check is `llmwiki-serve manifest`, which
is run by `discover --validate`, `quickstart` after candidate selection, and
`start` before launching a source server.

`discover` is scriptable inventory. Within the directories it scans, it should
show every candidate that meets the selected score threshold, including
parent/child overlap and app vault roots that also contain a strong child
`wiki/` source. `quickstart` is the presentation layer: by default it
recommends Native LLMWiki/OpenWiki and LLMWiki Markdown sources, while app
vaults, graphs, workspaces, generic Markdown folders, and noisy
example/demo/starter/e2e paths are additional and visible with
`--include-additional`.

## Variants

| Variant | Intended use | Detection markers | Default confidence |
| --- | --- | --- | --- |
| Native LLMWiki/OpenWiki projection | Already-built source projection for serving to coding agents. | `.wiki-compiler.json`; sidecar graph or projection metadata such as `graph/graph.json`; or structural projection combinations that include stronger projection frontmatter such as `source_refs` or `sources`, `hot.md` plus `index.md` or `overview.md`, and typed folders such as `concepts/`, `entities/`, `sources/`, or `queries/`. Frontmatter alone, `review_state` alone, `wiki_title` alone, `hot.md` alone, and docs-like hub plus typed folders are not enough to classify Native. | Usually medium to high; high when several projection markers combine. |
| LLMWiki Markdown | Source-like Markdown wiki root for `llmwiki-serve`'s Markdown adapter. | Source-like root names such as `wiki`, `llmwiki`, `openwiki`, or `vault`, plus typed folders and either a strong hub pair (`hot.md` plus `index.md`/`overview.md`) or a hub file with a larger Markdown set. | Usually medium to high; validate before treating it as startable. |
| Obsidian vault | Plain-file Obsidian vault that may include a nested `wiki/` hub. | `.obsidian/` plus Markdown notes. Strong direct child `wiki/` sources do not remove the vault root from `discover`; both are listed when both meet the score threshold. Default quickstart recommends the child `wiki/` source and places the parent app vault in the additional section. App markers keep the app variant label unless stronger projection evidence such as `.wiki-compiler.json`, sidecar graph metadata, or `source_refs` marks a compiled projection. | Medium before validation; higher only when projection markers are also present. |
| Logseq graph | Local Logseq graph. | `logseq/config.edn`, or weaker fallback markers `pages/` plus `journals/`. | Medium for config; low for only `pages/` plus `journals/`. |
| Dendron workspace | Dendron workspace or vault root. | `dendron.yml`. | Medium. |
| Foam workspace | Foam Markdown workspace. | `.foam/`, or a VS Code extension recommendation mentioning Foam. | Medium. |
| Quartz site source | Quartz source repository. | `quartz.config.ts`, `quartz.config.js`, `quartz.config.yaml`, or `quartz.config.yml`. | Medium. |
| Generic Markdown fallback | Deliberately selected Markdown/Org folder without stronger app or projection markers. | Markdown/Org count, source-like root names such as `wiki`, `llmwiki`, `openwiki`, or `vault`, hub files, and projection-like frontmatter. | Low by default and capped below `--min-score 30`; use `--min-score 10` intentionally. |

## Confidence and validation

- `60+`: high confidence.
- `30-59`: medium confidence.
- `10-29`: low confidence.
- Below `10`: hidden.

Confidence is only a discovery score. Validation is separate:

```bash
llmwiki-bridge-start discover --path . --validate
```

Validation reports whether the candidate is `startable` and includes manifest
fields such as title, source id, adapter, page counts, approved page counts, and
graph counts when available.

## Discovery transparency and quickstart filtering

Broad `discover` output is threshold-driven inventory after traversal safety
guards have selected directories to inspect. It must not hide otherwise scoring
candidates merely because they are app vault roots, generic Markdown folders,
or parents of stronger child `wiki/` sources. Quickstart applies the default UX
filter by splitting candidates into recommended and additional sections; pass
`--include-additional` to make the additional section selectable.

Traversal may still avoid infrastructure folders that are not useful source
roots, such as dependency, cache, build, transient editor/download, and OS
folders. That safety guard is separate from noisy-path presentation filtering.

## Non-goals

This package does not compile repositories into knowledge graphs, convert
app-specific syntax into canonical LLMWiki pages, crawl remote wikis, sync app
state, manage Redis or model runtimes, or replace `llmwiki-agent-bridge`.
