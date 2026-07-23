# llmwiki-bridge-start

Local adoption harness for connecting pre-built LLMWiki/OpenWiki knowledge
artifacts to `llmwiki-serve`, `llmwiki-agent-bridge`, and coding-agent clients.

This package does not compile or ingest knowledge. It discovers existing wiki
folders and Markdown knowledge-tool roots, validates that `llmwiki-serve` can
read them, starts loopback source servers when requested, registers those
sources with a local bridge when requested, and runs bridge smoke checks.

## Quick Start

```bash
npx llmwiki-bridge-start@latest
npx llmwiki-bridge-start@latest --workspace
npx llmwiki-bridge-start@latest discover --home
npx llmwiki-bridge-start@latest discover --path . --validate
npx llmwiki-bridge-start@latest start --path .llmwiki-work/knowledge-bridge-labs-wiki --port 11001
npx llmwiki-bridge-start@latest register --bridge http://127.0.0.1:8788 --config .llmwiki-bridge-start/sources.json
npx llmwiki-bridge-start@latest smoke --bridge http://127.0.0.1:8788
```

If `llmwiki-serve` is not on `PATH`, point the harness at a local checkout or
environment explicitly, for example:

```bash
npx llmwiki-bridge-start@latest --path ./wiki \
  --serve-command uv --serve-arg run --serve-arg llmwiki-serve --serve-cwd ../llmwiki-serve
```

Running `npx llmwiki-bridge-start@latest` with no subcommand starts the bounded
first-run quickstart flow; `quickstart` remains an explicit equivalent. By
default it asks before scanning the current user's home directory. Use `--path
DIR`, `--workspace`, or `--cwd` to constrain discovery before answering yes.
The flow shows a checkbox multi-select in interactive terminals, falls back to
comma-separated numbered selection for piped/non-interactive runs, validates
selected folders only when you choose to start them, waits for started
loopback source URLs to answer health checks, then explains that those URLs can
be used directly without
`llmwiki-agent-bridge`. Bridge setup is optional: if you opt in, quickstart uses
an already running bridge or prints a safe start command such as
`npx --yes llmwiki-agent-bridge@0.1.0` that does not install a global package.
Quickstart runs that command only after a second explicit approval. Once a
bridge is running, it merge-registers the started sources and runs an A2A-style
smoke request. If an explicit LLM endpoint is configured, smoke uses
delegated-runtime mode; otherwise it uses evidence-only mode.

Quickstart keeps the first selection list focused. By default it shows
recommended LLMWiki source folders: Native LLMWiki/OpenWiki projections and
LLMWiki Markdown roots. Native LLMWiki/OpenWiki means an already compiled
projection; LLMWiki Markdown means a source-like wiki that can be served
through the Markdown adapter. App vaults, graphs, workspaces, generic Markdown
folders, and noisy example/demo/starter/e2e paths are treated as
advanced/lower-priority candidates. They are hidden from the default
quickstart selection list when at least one recommended source exists. Use
`--include-additional` to render recommended and advanced/lower-priority
candidates as separate selectable sections.
If an app vault contains a strong direct child `wiki/` source, default
quickstart presents the child as recommended and keeps the parent app vault in
the advanced/lower-priority section. If quickstart finds only
advanced/lower-priority candidates without `--include-additional`, it stops
before selection and asks you to rerun with `--include-additional`.

The scriptable `discover` command is inventory, not presentation. Within the
directories it scans, it reports every candidate that meets its score threshold,
including parent/child overlaps and app vault roots that also contain a strong
child `wiki/` source. Noisy-path and additional-candidate filtering is a
quickstart UX policy, not a broad-discover hiding rule.

`--yes` is intended for local smoke automation: it accepts discovery and source
startup defaults, selects the first candidate, and still skips optional bridge
setup unless `--setup-bridge` is also supplied.

Default discovery scans the user home directory unless `--path`, `--cwd`, or
`--workspace` is supplied. The scanner prefers optional local tools such as
`fd`/`rg` when available and falls back to Node traversal. It scores likely
wiki roots, exposes the markers behind each score, keeps parent/child overlap
visible when both paths meet the score threshold, and optionally validates
candidates with `llmwiki-serve manifest`. The default minimum score is `30`.
Generic Markdown folders are often low confidence, so use `--min-score 10` when
intentionally looking for plain Markdown folders. Broad scans still avoid
dependency, cache, build, transient editor/download, and other infrastructure
folders; pass an explicit `--path DIR` when you intentionally want to inspect a
normally skipped area.

Quickstart intentionally prints full local paths so users can distinguish
candidate folders before starting servers. Redact or replace those paths before
publishing screenshots, logs, docs, or issue reports.

## Supported Source Variants

`discover` is a heuristic finder. The score and confidence explain why a folder
looks like a candidate; `--validate` is the compatibility check that asks
`llmwiki-serve manifest` whether the candidate can actually be served.

| Variant | Meaning | Detection markers | Default confidence |
| --- | --- | --- | --- |
| Native LLMWiki/OpenWiki projection | An already-built projection intended to be served by `llmwiki-serve`. | `.wiki-compiler.json`; sidecar graph or projection metadata such as `graph/graph.json`; or structural projection combinations that include stronger projection frontmatter such as `source_refs` or `sources`, `hot.md` plus `index.md` or `overview.md`, and typed folders such as `concepts/`, `entities/`, `sources/`, or `queries/`. Frontmatter alone, `review_state` alone, `wiki_title` alone, `hot.md` alone, and docs-like hub plus typed folders are not enough to classify Native. | Usually medium to high; high when multiple projection markers are present. |
| LLMWiki Markdown | A source-like Markdown wiki root that `llmwiki-serve` can often read with its Markdown adapter, but that is not a compiled Native projection. | Source-like root names such as `wiki`, `llmwiki`, `openwiki`, or `vault`, plus typed folders and either a strong hub pair (`hot.md` plus `index.md`/`overview.md`) or a hub file with a larger Markdown set. | Usually medium to high; validate before treating it as startable. |
| Obsidian vault | A plain-file Obsidian vault that may be usable directly or through a future adapter. | `.obsidian/` plus Markdown notes. If the vault has a strong direct child `wiki/` source, `discover` keeps both the vault root and child visible when both meet the score threshold. Default quickstart presents the child as recommended and the parent app vault as additional. App markers keep the app variant label unless stronger projection evidence such as `.wiki-compiler.json`, sidecar graph metadata, or `source_refs` marks a compiled projection. | Medium before validation; higher only if projection markers are also present. |
| Logseq graph | A Logseq knowledge graph. | `logseq/config.edn`, or the weaker fallback of both `pages/` and `journals/`. | Medium for `logseq/config.edn`; low for `pages/` plus `journals/` unless other source-like hints are present. |
| Dendron workspace | A Dendron workspace or vault root. | `dendron.yml`. | Medium. |
| Foam workspace | A Foam Markdown workspace. | `.foam/`, or the weaker fallback of a VS Code extensions recommendation that mentions Foam. | Medium for `.foam/`; low for the VS Code hint unless other source-like hints are present. |
| Quartz site source | A Quartz site content repository. | `quartz.config.ts`, `.js`, `.yaml`, or `.yml`. | Medium. |
| Generic Markdown fallback | A folder of Markdown or Org files without a known app or projection marker. | Markdown file counts, source-like folder names such as `wiki`, `llmwiki`, `openwiki`, or `vault`, hub files, and projection-like frontmatter. | Low by default and capped below the default `--min-score 30`; use `--min-score 10` for intentional fallback discovery. |

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
| no subcommand / `quickstart` | Guided first-run flow: optional discover, multi-select, validate/start sources, optional bridge setup, register, and A2A-style smoke. |
| `discover` | Find local LLMWiki Markdown, Native LLMWiki/OpenWiki, Obsidian, Logseq, Foam, Dendron, Quartz, and generic Markdown candidates. |
| `start` | Start `llmwiki-serve` on one or more selected local wiki paths. |
| `register` | Upsert started or existing source URLs into `llmwiki-agent-bridge`. Use `--replace` only when intentionally replacing the registry. |
| `smoke` | Run a bridge smoke request; defaults to evidence-only and accepts delegated-runtime or hybrid with `--mode`. |
| `doctor` | Check local prerequisites and optional bridge reachability. |

## Boundary

`llmwiki-bridge-start` is an onboarding/adoption harness. It is not a wiki
compiler, crawler, sync engine, model runtime, Redis manager, production auth
layer, or replacement for `llmwiki-agent-bridge`. It also does not promise
lossless interpretation of Obsidian, Logseq, Dendron, Foam, or Quartz-specific
syntax; manifest validation is the source of truth for whether the current
`llmwiki-serve` can serve a candidate.

`llmwiki-agent-bridge` remains optional. Use direct `llmwiki-serve` source URLs
when your local agent or script can call the source itself. Add the bridge when
you want source fan-out, A2A/MCP surfaces, runtime-backed synthesis, or one
normalized bridge artifact.
