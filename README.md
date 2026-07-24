# llmwiki-bridge-start

Local adoption harness for connecting pre-built LLMWiki/OpenWiki knowledge
artifacts to `llmwiki-serve`, `llmwiki-agent-bridge`, and coding-agent clients.

This package does not compile or ingest knowledge. It discovers existing wiki
folders and Markdown knowledge-tool roots, validates that `llmwiki-serve` can
read them, starts loopback source servers when requested, registers those
sources with a local bridge when requested, and runs bridge smoke checks.

## Quick Start

Recommended first run:

```bash
npx llmwiki-bridge-start@latest --path ./wiki
npx llmwiki-bridge-start@latest --workspace
npx llmwiki-bridge-start@latest
```

Use `--path ./wiki` when you already know the source folder. The scan is
constrained to that directory tree, so quickstart does not wander into your
home directory, workspace siblings, or unrelated local projects. Use
`--workspace` when you want quickstart to look under your `~/workspace`
directory. Use
the bare command when you want the guided flow to propose a broader scan; it
asks before scanning the current user's home directory.

Minimum success: when quickstart starts `llmwiki-serve` and reports healthy
loopback source endpoints, first onboarding has succeeded. If you skip
`llmwiki-agent-bridge`, quickstart prints one MCP Streamable HTTP registration
URL per started source, using the `http://127.0.0.1:<port>/mcp/stream` shape.
These are MCP-over-HTTP/Streamable HTTP server URLs for coding agents or
scripts that support MCP over HTTP; exact client configuration syntax varies by
client. `llmwiki-agent-bridge` can still be added later when you want source
fan-out or one normalized bridge across sources.

If `llmwiki-serve` is not on `PATH`, a sibling `../llmwiki-serve` checkout with
an existing `.venv` is used automatically when available. Otherwise point the
harness at a local checkout or environment explicitly, for example:

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
`llmwiki-agent-bridge`. Bridge setup is optional: if you skip it, quickstart
prints one coding-agent MCP Streamable HTTP registration URL (`/mcp/stream`)
per started source and notes that started local processes remain running, with
PIDs and log paths when available. After you choose source folders,
quickstart echoes the selected label and full path before validation/start. If
you opt in, quickstart uses an already running bridge or prints copy-pasteable
PowerShell and POSIX manual-start examples such as
`LLMWIKI_AGENT_BRIDGE_HOST='127.0.0.1' LLMWIKI_AGENT_BRIDGE_PORT='8788' npx --yes llmwiki-agent-bridge@0.1.0`;
custom `--bridge http://host:port` values are reflected in those env
assignments. The command does not install a global package.
Before starting that bridge command, quickstart asks how to configure the LLM
runtime for this bridge run: skip/evidence-only, Hermes, or DeepAgents.
Hermes and DeepAgents are the supported QuickStart runtime profiles. When a
repo-confirmed runtime install command is not available, quickstart does not
auto-install them. Instead it prints safe install/start guidance and asks for
the endpoint after the runtime is running. If a default endpoint is shown,
blank Enter uses that default; type `skip` to force evidence-only. If no
default endpoint is shown, blank Enter or `skip` continues with evidence-only
bridge smoke.
Quickstart runs the bridge start command only after a second explicit
approval. Once a bridge is running, it merge-registers the started sources and
runs an A2A-style smoke request. After a successful bridge smoke, quickstart
prints a concise bridge handoff with the bridge base URL, A2A-style answer
endpoint (`POST /message:send`), MCP-style JSON-RPC endpoint (`POST /mcp`),
settings UI (`/settings`), and a lifecycle note for started local source/bridge
processes with PIDs and log paths when available. The bridge endpoint handoff
is separate from direct source MCP Streamable HTTP URLs (`/mcp/stream`). If an explicit LLM
endpoint is configured through flags, quickstart treats it as a preconfigured
compatibility path without adding it to the interactive first-run menu.

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
child `wiki/` source. Noisy-path and advanced/lower-priority filtering is a
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

Quickstart intentionally prints full local paths for disambiguation so users can
distinguish candidate folders before starting servers. Redact or replace those
paths before publishing screenshots, logs, docs, or issue reports.
When several visible candidates are all named `wiki`, or a candidate is under
`.llmwiki-work`, quickstart adds a small parent/project context to the display
label while still printing the full path on the next line.

### Advanced/scriptable commands

Use these when you want to automate or debug individual steps. They are not a
required first-run sequence.

```bash
npx llmwiki-bridge-start@latest discover --home
npx llmwiki-bridge-start@latest discover --path . --validate
npx llmwiki-bridge-start@latest start --path ./wiki --port 11001
npx llmwiki-bridge-start@latest register --bridge http://127.0.0.1:8788 --config .llmwiki-bridge-start/sources.json
npx llmwiki-bridge-start@latest smoke --bridge http://127.0.0.1:8788
```

## Supported Source Variants

`discover` is a heuristic finder. The score and confidence explain why a folder
looks like a candidate; `--validate` is the compatibility check that asks
`llmwiki-serve manifest` whether the candidate can actually be served.

| Variant | Meaning | Detection markers | Default confidence |
| --- | --- | --- | --- |
| Native LLMWiki/OpenWiki projection | An already-built projection intended to be served by `llmwiki-serve`. | `.wiki-compiler.json`; sidecar graph or projection metadata such as `graph/graph.json`; or structural projection combinations that include stronger projection frontmatter such as `source_refs` or `sources`, `hot.md` plus `index.md` or `overview.md`, and typed folders such as `concepts/`, `entities/`, `sources/`, or `queries/`. Frontmatter alone, `review_state` alone, `wiki_title` alone, `hot.md` alone, and docs-like hub plus typed folders are not enough to classify Native. | Usually medium to high; high when multiple projection markers are present. |
| LLMWiki Markdown | A source-like Markdown wiki root that `llmwiki-serve` can often read with its Markdown adapter, but that is not a compiled Native projection. | Source-like root names such as `wiki`, `llmwiki`, `openwiki`, or `vault`, plus typed folders and either a strong hub pair (`hot.md` plus `index.md`/`overview.md`) or a hub file with a larger Markdown set. | Usually medium to high; validate before treating it as startable. |
| Obsidian vault | A plain-file Obsidian vault that may be usable directly or through a future adapter. | `.obsidian/` plus Markdown notes. If the vault has a strong direct child `wiki/` source, `discover` keeps both the vault root and child visible when both meet the score threshold. Default quickstart presents the child as recommended and the parent app vault as advanced/lower-priority. App markers keep the app variant label unless stronger projection evidence such as `.wiki-compiler.json`, sidecar graph metadata, or `source_refs` marks a compiled projection. | Medium before validation; higher only if projection markers are also present. |
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

`llmwiki-agent-bridge` remains optional. Use the direct `llmwiki-serve`
handoff URLs when your local agent or script can call each source itself. Add
the bridge later when you want source fan-out, runtime-backed synthesis, or one
normalized bridge across sources.
