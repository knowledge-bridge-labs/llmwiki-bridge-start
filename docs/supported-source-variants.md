# Supported Source Variants

`llmwiki-bridge-start discover` is a heuristic finder. It does not certify that
a folder is usable. The compatibility check is `llmwiki-serve manifest`, which
is run by `discover --validate`, `quickstart` after candidate selection, and
`start` before launching a source server.

## Variants

| Variant | Intended use | Detection markers | Default confidence |
| --- | --- | --- | --- |
| Native LLMWiki/OpenWiki projection | Already-built source projection for serving to coding agents. | `.wiki-compiler.json`; or structural projection combinations that include graph or projection metadata, such as `graph/graph.json`, projection frontmatter (`source_refs`, `review_state`, `wiki_title`), `hot.md` plus `index.md` or `overview.md`, and typed folders such as `concepts/`, `entities/`, `sources/`, or `queries/`. Frontmatter alone, `hot.md` alone, and docs-like hub plus typed folders are not enough to classify Native. | Usually medium to high; high when several projection markers combine. |
| LLMWiki Markdown | Source-like Markdown wiki root for `llmwiki-serve`'s Markdown adapter. | Source-like root names such as `wiki`, `llmwiki`, `openwiki`, or `vault`, plus a hub file (`index.md`, `overview.md`, `hot.md`, or `critical_facts.md`), typed folders, and a larger Markdown set. | Usually medium to high; validate before treating it as startable. |
| Obsidian vault | Plain-file Obsidian vault that may include a nested `wiki/` hub. | `.obsidian/` plus Markdown notes. Direct child `wiki/` folders are suppressed in favor of the vault root. App markers keep the app variant label unless `.wiki-compiler.json` explicitly marks a compiled projection. | Medium before validation; higher only when projection markers are also present. |
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

## Default exclusions

Broad scans skip dependency, cache, build, generated smoke, variant, and OS
folders. Under `.llmwiki-work`, internal `input/`, `sources/`, and e2e folders
are also hidden so users see source projections rather than intermediate
compiler/test artifacts.

## Non-goals

This package does not compile repositories into knowledge graphs, convert
app-specific syntax into canonical LLMWiki pages, crawl remote wikis, sync app
state, manage Redis or model runtimes, or replace `llmwiki-agent-bridge`.
