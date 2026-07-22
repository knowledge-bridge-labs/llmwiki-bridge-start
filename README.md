# llmwiki-bridge-start

Local adoption harness for connecting pre-built LLMWiki/OpenWiki knowledge
artifacts to `llmwiki-serve`, `llmwiki-agent-bridge`, and coding-agent clients.

This package does not compile or ingest knowledge. It discovers existing wiki
folders and Markdown knowledge-tool roots, validates that `llmwiki-serve` can
read them, starts loopback source servers when requested, registers those
sources with a local bridge when requested, and runs bridge smoke checks.

## Quick Prototype

```bash
npx llmwiki-bridge-start@latest quickstart --workspace
npx llmwiki-bridge-start@latest discover --home
npx llmwiki-bridge-start@latest discover --path . --validate
npx llmwiki-bridge-start@latest start --path .llmwiki-work/knowledge-bridge-labs-wiki --port 11001
npx llmwiki-bridge-start@latest register --bridge http://127.0.0.1:8788 --config .llmwiki-bridge-start/sources.json
npx llmwiki-bridge-start@latest smoke --bridge http://127.0.0.1:8788
```

`quickstart` is the bounded first-run flow. It asks whether to discover local
source folders, lets you multi-select candidates, validates selected folders
only when you choose to start them, starts loopback source URLs, then explains
that those URLs can be used directly without `llmwiki-agent-bridge`. Bridge
setup is optional: if you opt in, quickstart uses an already running bridge or
prints a safe start command such as `npx --yes llmwiki-agent-bridge@0.1.0`
that does not install a global package. Quickstart runs that command only after
a second explicit approval. Once a bridge is running, it merge-registers the
started sources and runs an A2A-style smoke request. If an explicit LLM endpoint
is configured, smoke uses delegated-runtime mode; otherwise it uses
evidence-only mode.

Default discovery scans the user home directory unless `--path`, `--cwd`, or
`--workspace` is supplied. The scanner prefers optional local tools such as
`fd`/`rg` when available and falls back to Node traversal. It skips dependency,
cache, build, example, archive, generated smoke, runtime-log, transient
download/editor, and OS folders, scores likely wiki roots, removes obvious
child-folder duplicates, and optionally validates candidates with
`llmwiki-serve manifest`. Pass `--path DIR` to intentionally scan a skipped
folder such as Downloads or an examples directory.
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
| `quickstart` | Guided first-run flow: optional discover, multi-select, validate/start sources, optional bridge setup, register, and A2A-style smoke. |
| `discover` | Find local LLMWiki/Obsidian/Logseq/Foam/Dendron/Quartz/generic Markdown candidates. |
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
