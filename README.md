# llmwiki-bridge-start

Local adoption harness for connecting pre-built LLMWiki/OpenWiki knowledge
artifacts to `llmwiki-serve`, `llmwiki-agent-bridge`, and coding-agent clients.

This package does not compile or ingest knowledge. It discovers existing wiki
folders and Markdown knowledge-tool roots, validates that `llmwiki-serve` can
read them, starts loopback source servers when requested, registers those
sources with a local bridge, and runs evidence-only smoke checks.

## Quick Prototype

```bash
npx llmwiki-bridge-start@latest quickstart --workspace
npx llmwiki-bridge-start@latest discover --home
npx llmwiki-bridge-start@latest discover --path . --validate
npx llmwiki-bridge-start@latest start --path .llmwiki-work/knowledge-bridge-labs-wiki --port 11001
npx llmwiki-bridge-start@latest register --bridge http://127.0.0.1:8788 --config .llmwiki-bridge-start/sources.json
npx llmwiki-bridge-start@latest smoke --bridge http://127.0.0.1:8788
```

`quickstart` is the bounded first-run flow: it discovers candidates without
full validation, lets you choose one or more candidates, validates only that
selection, then offers to start, merge-register, and smoke-test the bridge.

Default discovery scans the user home directory unless `--path`, `--cwd`, or
`--workspace` is supplied. The scanner skips dependency, cache, build, generated
smoke, and OS folders, scores likely wiki roots, removes obvious child-folder
duplicates, and optionally validates candidates with `llmwiki-serve manifest`.
The default minimum score is `30`; use `--min-score 10` when intentionally
looking for plain Markdown folders.

## Supported Source Variants

`discover` is a heuristic finder. The score and confidence explain why a folder
looks like a candidate; `--validate` is the compatibility check that asks
`llmwiki-serve manifest` whether the candidate can actually be served.

| Variant | Meaning | Detection markers | Default confidence |
| --- | --- | --- | --- |
| Native LLMWiki/OpenWiki projection | An already-built projection intended to be served by `llmwiki-serve`. | `.wiki-compiler.json`, `hot.md` plus `index.md` or `overview.md`, typed folders such as `concepts/`, `entities/`, `sources/`, or `queries/`, `graph/graph.json`, and projection frontmatter such as `source_refs`, `review_state`, or `wiki_title`. | Usually medium to high; high when multiple projection markers are present. |
| Obsidian vault | A plain-file Obsidian vault that may be usable directly or through a future adapter. | `.obsidian/` plus Markdown notes. If the vault has a direct child `wiki/`, discovery prefers the vault root. | Medium before validation; higher only if projection markers are also present. |
| Logseq graph | A Logseq knowledge graph. | `logseq/config.edn`, or the weaker fallback of both `pages/` and `journals/`. | Medium for `logseq/config.edn`; low for `pages/` plus `journals/` unless other source-like hints are present. |
| Dendron workspace | A Dendron workspace or vault root. | `dendron.yml`. | Medium. |
| Foam workspace | A Foam Markdown workspace. | `.foam/`, or the weaker fallback of a VS Code extensions recommendation that mentions Foam. | Medium for `.foam/`; low for the VS Code hint unless other source-like hints are present. |
| Quartz site source | A Quartz site content repository. | `quartz.config.ts`, `.js`, `.yaml`, or `.yml`. | Medium. |
| Generic Markdown fallback | A folder of Markdown or Org files without a known app or projection marker. | Markdown file counts, source-like folder names such as `wiki`, `llmwiki`, `openwiki`, or `vault`, hub files, and projection-like frontmatter. | Low by default and usually hidden by the default `--min-score 30`; use `--min-score 10` for intentional fallback discovery. |

Confidence bands are score-based: `60+` is high, `30-59` is medium, `10-29` is
low, and lower scores are hidden. Validation does not change the source files;
it runs `llmwiki-serve manifest <candidate>` and reports `startable: yes/no`
plus manifest fields such as title, source id, adapter, page counts, and graph
counts when available. The `start` command performs the same manifest check
before launching `llmwiki-serve serve`.

See [Supported Source Variants](docs/supported-source-variants.md) for the
longer compatibility notes and non-goals.

## Commands

| Command | Purpose |
| --- | --- |
| `quickstart` | Guided first-run flow: discover, choose candidates, validate selected candidates, start, register, and smoke. |
| `discover` | Find local LLMWiki/Obsidian/Logseq/Foam/Dendron/Quartz/generic Markdown candidates. |
| `start` | Start `llmwiki-serve` on one or more selected local wiki paths. |
| `register` | Upsert started or existing source URLs into `llmwiki-agent-bridge`. Use `--replace` only when intentionally replacing the registry. |
| `smoke` | Run an evidence-only bridge smoke request. |
| `doctor` | Check local prerequisites and optional bridge reachability. |

## Boundary

`llmwiki-bridge-start` is an onboarding/adoption harness. It is not a wiki
compiler, crawler, sync engine, model runtime, Redis manager, production auth
layer, or replacement for `llmwiki-agent-bridge`. It also does not promise
lossless interpretation of Obsidian, Logseq, Dendron, Foam, or Quartz-specific
syntax; manifest validation is the source of truth for whether the current
`llmwiki-serve` can serve a candidate.
