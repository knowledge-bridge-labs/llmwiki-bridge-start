# Implementation Plan

1. Scaffold a small ESM npm package with a thin bin wrapper and dependency-free
   implementation.
2. Implement discovery scoring for native LLMWiki/OpenWiki roots and common
   Markdown app markers.
3. Add default filters for dependency, cache, build, smoke, variant, and
   generated workspace internals.
4. Validate candidates by invoking `llmwiki-serve manifest`.
5. Start selected sources through `llmwiki-serve serve` and write a local source
   config.
6. Register sources through the bridge settings endpoint with merge/upsert
   semantics.
7. Add a guided quickstart flow that can stop after direct source startup or
   continue into optional bridge setup.
8. Add a bridge smoke command that uses evidence-only mode by default and
   delegated-runtime when an explicit LLM endpoint is configured.
9. Verify with unit tests, package dry-run, targeted local discovery, and a
   local source restart smoke.

## Risks

- Full-home scans can be slow on large machines; keep validation opt-in and add
  narrowing flags.
- App-style vault roots and nested `wiki/` projections can duplicate each other;
  prefer the app root by default.
- Medium-confidence app markers can identify a vault that the installed
  `llmwiki-serve` cannot yet serve directly; keep marker confidence distinct
  from manifest validation.
- Generic Markdown fallback can produce noisy matches during broad scans; keep
  default discovery at medium confidence and require explicit `--min-score 10`
  for intentional low-confidence fallback searches.
- Existing bridge registry settings must not be overwritten accidentally.

## Documentation Plan

- README and spec documentation must use the same supported-variant vocabulary:
  native LLMWiki/OpenWiki projection, Obsidian vault, Logseq graph, Dendron
  workspace, Foam workspace, Quartz site source, and generic Markdown fallback.
- Each variant must list concrete filesystem markers and the expected default
  confidence band.
- Validation docs must say that `discover --validate` and `start` call
  `llmwiki-serve manifest` and that manifest success, not marker detection
  alone, determines whether the candidate is startable.
- Non-goals must remain explicit that the harness does not compile knowledge,
  convert app-specific syntax, crawl or sync remote sources, or replace bridge
  orchestration.
