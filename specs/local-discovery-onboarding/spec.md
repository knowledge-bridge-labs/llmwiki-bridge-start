# Local Discovery Onboarding

## Problem

AX users often already have one or more local knowledge artifacts, but they need
a low-friction way to find usable LLMWiki-compatible folders, start
`llmwiki-serve`, connect sources to `llmwiki-agent-bridge`, and verify that a
coding-agent client can retrieve evidence.

## Goals

- Discover likely local source roots for native LLMWiki/OpenWiki projections,
  source-like LLMWiki Markdown roots, Obsidian vaults, Logseq graphs, Dendron
  workspaces, Foam workspaces, Quartz site sources, and generic Markdown
  fallback folders.
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
Generic Markdown fallback scores are capped below the default threshold to keep
broad home scans focused on structured source roots.

| Variant | Detection markers | Default confidence expectation |
| --- | --- | --- |
| Native LLMWiki/OpenWiki projection | `.wiki-compiler.json`; or structural projection combinations that include graph or projection metadata, such as `graph/graph.json`, projection frontmatter (`source_refs`, `review_state`, `wiki_title`), `hot.md` with `index.md` or `overview.md`, and typed folders such as `concepts/`, `entities/`, `sources/`, or `queries/`. Frontmatter alone, `hot.md` plus index/overview alone, and docs-like hub plus typed folders must not classify a folder as Native. | Medium to high; high when multiple projection markers combine. |
| LLMWiki Markdown | Source-like root names such as `wiki`, `llmwiki`, `openwiki`, or `vault`, plus a hub file, typed folders, and a larger Markdown set. This is distinct from a compiled Native projection. | Medium to high; validation determines whether `llmwiki-serve` can start it. |
| Obsidian vault | `.obsidian/` plus Markdown notes. Direct child `wiki/` folders are suppressed in favor of the vault root. App markers keep the app variant label unless `.wiki-compiler.json` explicitly marks a compiled projection. | Medium before validation. |
| Logseq graph | `logseq/config.edn`, or the weaker fallback of both `pages/` and `journals/`. | Medium for `logseq/config.edn`; low for `pages/` plus `journals/` unless other source-like hints are present. |
| Dendron workspace | `dendron.yml`. | Medium. |
| Foam workspace | `.foam/`, or the weaker fallback of a VS Code extension recommendation containing Foam. | Medium for `.foam/`; low for the VS Code hint unless other source-like hints are present. |
| Quartz site source | `quartz.config.ts`, `.js`, `.yaml`, or `.yml`. | Medium. |
| Generic Markdown fallback | Markdown or Org file counts, source-like root names such as `wiki`, `llmwiki`, `openwiki`, or `vault`, hub files, and projection-like frontmatter. | Low by default and capped below the default threshold. |

Confidence is score-derived: `60+` is high, `30-59` is medium, `10-29` is low,
and lower scores are omitted. Confidence is not a serving guarantee.
`discover --validate` must invoke `llmwiki-serve manifest <candidate>` and add a
manifest summary when the candidate is startable or a validation error when it
is not. `start` must also require a successful manifest before launching a local
source server.

## Requirements

- The CLI must keep scriptable commands lightweight and deterministic. The
  guided TTY quickstart may use a small prompt library for multi-select UX, but
  non-TTY, piped, and `--yes` flows must continue to use text/flag fallbacks.
- `discover` must be safe enough to run from a home directory by default.
- `discover` output must expose the score, confidence, and marker signals that
  caused each candidate to appear.
- Default discovery must favor medium/high-confidence candidates; low-confidence
  generic Markdown fallback discovery must require lowering `--min-score`.
- Frontmatter-only Markdown folders must stay generic, even when they contain
  projection-like fields such as `source_refs`, `review_state`, or
  `wiki_title`.
- Docs-like Markdown folders with only hub files and typed folders must stay
  generic unless graph or projection metadata is also present.
- Source-like Markdown wiki roots with a hub file, typed folders, and a larger
  Markdown set should be classified as LLMWiki Markdown rather than Native or
  low-confidence generic fallback.
- `register` must merge by default and require explicit `--replace` to wipe the
  bridge registry.
- Invoking `llmwiki-bridge-start` without a subcommand must start the
  quickstart flow; explicit `quickstart` remains equivalent and explicit
  `discover` remains available for scriptable candidate listing.
- `quickstart` must ask before discovery and make the default home-directory
  scan scope visible unless `--path`, `--workspace`, or `--cwd` constrains it.
- `quickstart` must support TTY checkbox-style multi-select source startup,
  preserve comma-separated text selection for non-TTY/automation, and allow a
  successful direct-source-only exit before bridge setup.
- `start`/`quickstart` must not report a launched source as ready until its
  loopback HTTP health endpoint responds within a bounded timeout.
- `quickstart` must not start or install `llmwiki-agent-bridge` unless the user
  explicitly opts in.
- `quickstart --yes` must remain safe for smoke automation: accept discovery and
  source-start defaults, select the first candidate, and skip optional bridge
  setup unless `--setup-bridge` is also supplied.
- Source URLs with credentials or unsupported schemes must be rejected.
- Tests must cover scoring, duplicate suppression, generated-folder filtering,
  supported-variant markers, default generic fallback behavior, manifest
  validation behavior where practical, and registry merge safety.
