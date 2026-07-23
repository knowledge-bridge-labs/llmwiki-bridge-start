# Implementation Plan

1. Scaffold a small ESM npm package with a thin bin wrapper and minimal runtime
   dependencies.
2. Implement discovery scoring for native LLMWiki/OpenWiki roots, source-like
   LLMWiki Markdown roots, and common Markdown app markers.
3. Add a fast candidate-directory prefilter before scoring, preferring local
   OS tools such as `fd`/`rg` when available and falling back to deterministic
   JavaScript traversal.
4. Add traversal safety guards for dependency, cache, build, runtime-log,
   transient download/editor, and OS internals without using quickstart
   presentation categories to hide otherwise scoring discovery candidates.
5. Validate candidates by invoking `llmwiki-serve manifest`.
6. Start selected sources through `llmwiki-serve serve`, wait for bounded
   loopback health readiness, and write a local source config only for ready
   sources.
7. Register sources through the bridge settings endpoint with merge/upsert
   semantics.
8. Add a guided quickstart flow that leads with `--path DIR`, `--workspace`, or
   bare invocation, can stop after direct source startup, and can continue into
   optional bridge setup.
   - Use a TTY-only checkbox multi-select for candidate source selection.
   - Keep the comma-separated numbered fallback for non-TTY, piped, injected
     prompt, and `--yes` runs.
   - Split candidates into recommended and advanced/lower-priority sections.
     Recommended is Native LLMWiki/OpenWiki plus LLMWiki Markdown; app vaults,
     graphs, workspaces, generic Markdown folders, and noisy paths are
     advanced/lower-priority.
   - Label non-recommended candidates as advanced/lower-priority and explain
     the Native LLMWiki/OpenWiki vs LLMWiki Markdown distinction inline.
   - Treat a healthy printed local source URL as the minimum successful
     onboarding outcome.
9. Add an optional bridge smoke command that uses evidence-only mode by default
   and delegated-runtime when an explicit LLM endpoint is configured.
10. Verify with unit tests, package dry-run, targeted local discovery, and a
   local source restart smoke.

## Risks

- Full-home scans can be slow on large machines; keep validation opt-in, use a
  marker prefilter before scoring, avoid non-source infrastructure roots by
  default, and rely on the score threshold rather than quickstart presentation
  categories to decide broad `discover` output for inspected directories.
  Generic matches that meet the selected threshold stay visible in `discover`
  and are handled as advanced/lower-priority candidates by quickstart.
- First-run users can over-scan local machines if the first docs example is
  broad; lead with `--path DIR` for known source folders and document that it
  constrains scanning to that directory tree.
- App-style vault roots and nested `wiki/` projections can duplicate each other;
  keep both visible in scriptable `discover` when both meet the score threshold.
  In default quickstart, recommend a strong child `wiki/` source and place the
  parent app vault in the advanced/lower-priority section.
- Medium-confidence app markers can identify a vault that the installed
  `llmwiki-serve` cannot yet serve directly; keep marker confidence distinct
  from manifest validation.
- Generic Markdown fallback and example/demo/starter/e2e paths can produce noisy
  quickstart choices; keep broad `discover` threshold-driven for inspected
  directories, while default quickstart hides advanced/lower-priority
  candidates unless `--include-additional` is set. Keep traversal safety guards
  separate from quickstart presentation filtering.
- Existing bridge registry settings must not be overwritten accidentally.
- Rich prompt libraries can break automation if used unconditionally; gate
  interactive prompts on TTY and keep fallback output snapshot-tested.
- Spawned source processes can fail after launch because of port conflicts,
  missing runtime dependencies, or adapter errors; verify `/health` before
  presenting a URL as ready and clean up failed child processes.

## Documentation Plan

- README and spec documentation must use the same supported-variant vocabulary:
  native LLMWiki/OpenWiki projection, LLMWiki Markdown, Obsidian vault, Logseq
  graph, Dendron workspace, Foam workspace, Quartz site source, and generic
  Markdown fallback.
- Each variant must list concrete filesystem markers and the expected default
  confidence band.
- Discovery docs must say that `discover` is scriptable inventory and, within
  inspected directories, reports every candidate over the selected score
  threshold, including parent/child overlap.
- Quickstart docs must say that recommended sources are Native
  LLMWiki/OpenWiki and LLMWiki Markdown, while app vaults, graphs, workspaces,
  generic Markdown folders, and noisy paths are advanced/lower-priority and
  visible through `--include-additional`.
- Quickstart docs must define a printed healthy local source URL as the minimum
  successful onboarding outcome, with bridge setup clearly optional.
- README Quick Start must move `discover`, `start`, `register`, and `smoke`
  examples into an advanced/scriptable commands section so they are not read as
  a mandatory first-run sequence.
- Public docs and screenshots must redact or replace local filesystem paths
  even though the CLI prints full paths for local disambiguation.
- Native classification docs must say that `review_state` or `wiki_title`
  alone are insufficient; stronger projection evidence such as
  `.wiki-compiler.json`, sidecar graph/projection metadata, or
  `source_refs`/`sources` is required.
- Validation docs must say that `discover --validate` and `start` call
  `llmwiki-serve manifest` and that manifest success, not marker detection
  alone, determines whether the candidate is startable.
- Startup docs must say that a source is considered ready only after its HTTP
  health endpoint responds.
- Non-goals must remain explicit that the harness does not compile knowledge,
  convert app-specific syntax, crawl or sync remote sources, or replace bridge
  orchestration.
