# Implementation Plan

1. Scaffold a small ESM npm package with a thin bin wrapper and minimal runtime
   dependencies.
2. Implement discovery scoring for native LLMWiki/OpenWiki roots and common
   Markdown app markers.
3. Add a fast candidate-directory prefilter before scoring, preferring local
   OS tools such as `fd`/`rg` when available and falling back to deterministic
   JavaScript traversal.
4. Add default filters for dependency, cache, build, examples, archives,
   runtime logs, smoke, variant, transient download/editor, and generated
   workspace internals.
5. Validate candidates by invoking `llmwiki-serve manifest`.
6. Start selected sources through `llmwiki-serve serve`, wait for bounded
   loopback health readiness, and write a local source config only for ready
   sources.
7. Register sources through the bridge settings endpoint with merge/upsert
   semantics.
8. Add a guided quickstart flow that can stop after direct source startup or
   continue into optional bridge setup.
   - Use a TTY-only checkbox multi-select for candidate source selection.
   - Keep the comma-separated numbered fallback for non-TTY, piped, injected
     prompt, and `--yes` runs.
9. Add a bridge smoke command that uses evidence-only mode by default and
   delegated-runtime when an explicit LLM endpoint is configured.
10. Verify with unit tests, package dry-run, targeted local discovery, and a
   local source restart smoke.

## Risks

- Full-home scans can be slow on large machines; keep validation opt-in, use a
  marker prefilter before scoring, skip transient/generated roots by default,
  and rely on explicit `--path` or lowered `--min-score` for skipped/example
  folders and broad fallback searches.
- App-style vault roots and nested `wiki/` projections can duplicate each other;
  prefer the app root by default.
- Medium-confidence app markers can identify a vault that the installed
  `llmwiki-serve` cannot yet serve directly; keep marker confidence distinct
  from manifest validation.
- Generic Markdown fallback can produce noisy matches during broad scans; keep
  default discovery at medium confidence and require explicit `--min-score 10`
  for intentional low-confidence fallback searches.
- Existing bridge registry settings must not be overwritten accidentally.
- Rich prompt libraries can break automation if used unconditionally; gate
  interactive prompts on TTY and keep fallback output snapshot-tested.
- Spawned source processes can fail after launch because of port conflicts,
  missing runtime dependencies, or adapter errors; verify `/health` before
  presenting a URL as ready and clean up failed child processes.

## Documentation Plan

- README and spec documentation must use the same supported-variant vocabulary:
  native LLMWiki/OpenWiki projection, Obsidian vault, Logseq graph, Dendron
  workspace, Foam workspace, Quartz site source, and generic Markdown fallback.
- Each variant must list concrete filesystem markers and the expected default
  confidence band.
- Validation docs must say that `discover --validate` and `start` call
  `llmwiki-serve manifest` and that manifest success, not marker detection
  alone, determines whether the candidate is startable.
- Startup docs must say that a source is considered ready only after its HTTP
  health endpoint responds.
- Non-goals must remain explicit that the harness does not compile knowledge,
  convert app-specific syntax, crawl or sync remote sources, or replace bridge
  orchestration.
