# Local Discovery Onboarding

## Problem

AX users often already have one or more local knowledge artifacts, but they need
a low-friction way to find usable LLMWiki-compatible folders, start
`llmwiki-serve`, connect sources to `llmwiki-agent-bridge`, and verify that a
coding-agent client can retrieve evidence.

## Goals

- Discover likely local source roots for native LLMWiki/OpenWiki projections,
  Obsidian vaults, Logseq graphs, Dendron workspaces, Foam workspaces, Quartz
  site sources, and generic Markdown fallback folders.
- Prefer useful source boundaries over internal fixture, cache, build, and
  generated workspace folders.
- Validate candidates through `llmwiki-serve manifest` when requested.
- Start selected local sources on loopback ports.
- Treat started `llmwiki-serve` source URLs as immediately useful even when the
  user skips `llmwiki-agent-bridge`.
- Make `llmwiki-agent-bridge` setup optional and explicit.
- Upsert sources into an existing bridge registry without deleting unrelated
  sources.
- Run an A2A-style smoke query against the bridge, using delegated-runtime when
  an explicit LLM endpoint is configured and evidence-only otherwise.

## Non-goals

- Compiling repositories into knowledge graphs.
- Converting or normalizing Obsidian, Logseq, Dendron, Foam, or Quartz syntax
  into canonical LLMWiki projection pages.
- Guaranteeing that a detected app vault is startable without
  `llmwiki-serve manifest` validation.
- Crawling remote wikis, syncing app state, or publishing static sites.
- Managing model runtimes, Redis, auth, TLS, Docker, or Kubernetes.
- Replacing `llmwiki-agent-bridge` orchestration.
- Treating generated local work folders as canonical project docs.

## Supported Source Variants

Discovery assigns scores from local filesystem markers. The default
`--min-score` is `30`, so medium and high candidates are shown by default while
plain low-confidence Markdown folders require an intentional lower threshold.

| Variant | Detection markers | Default confidence expectation |
| --- | --- | --- |
| Native LLMWiki/OpenWiki projection | `.wiki-compiler.json`, `hot.md` with `index.md` or `overview.md`, typed folders such as `concepts/`, `entities/`, `sources/`, or `queries/`, `graph/graph.json`, and projection frontmatter such as `source_refs`, `review_state`, or `wiki_title`. | Medium to high; high when multiple projection markers combine. |
| Obsidian vault | `.obsidian/` plus Markdown notes. Direct child `wiki/` folders are suppressed in favor of the vault root. | Medium before validation. |
| Logseq graph | `logseq/config.edn`, or the weaker fallback of both `pages/` and `journals/`. | Medium for `logseq/config.edn`; low for `pages/` plus `journals/` unless other source-like hints are present. |
| Dendron workspace | `dendron.yml`. | Medium. |
| Foam workspace | `.foam/`, or the weaker fallback of a VS Code extension recommendation containing Foam. | Medium for `.foam/`; low for the VS Code hint unless other source-like hints are present. |
| Quartz site source | `quartz.config.ts`, `.js`, `.yaml`, or `.yml`. | Medium. |
| Generic Markdown fallback | Markdown or Org file counts, source-like root names such as `wiki`, `llmwiki`, `openwiki`, or `vault`, hub files, and projection-like frontmatter. | Low unless enough source-like hints lift the score to medium. |

Confidence is score-derived: `60+` is high, `30-59` is medium, `10-29` is low,
and lower scores are omitted. Confidence is not a serving guarantee.
`discover --validate` must invoke `llmwiki-serve manifest <candidate>` and add a
manifest summary when the candidate is startable or a validation error when it
is not. `start` must also require a successful manifest before launching a local
source server.

## Requirements

- The CLI must work without runtime dependencies beyond Node and
  `llmwiki-serve`.
- `discover` must be safe enough to run from a home directory by default.
- `discover` output must expose the score, confidence, and marker signals that
  caused each candidate to appear.
- Default discovery must favor medium/high-confidence candidates; low-confidence
  generic Markdown fallback discovery must require lowering `--min-score`.
- `register` must merge by default and require explicit `--replace` to wipe the
  bridge registry.
- `quickstart` must ask before discovery, support multi-select source startup,
  and allow a successful direct-source-only exit before bridge setup.
- `quickstart` must not start or install `llmwiki-agent-bridge` unless the user
  explicitly opts in.
- Source URLs with credentials or unsupported schemes must be rejected.
- Tests must cover scoring, duplicate suppression, generated-folder filtering,
  supported-variant markers, default generic fallback behavior, manifest
  validation behavior where practical, and registry merge safety.
