# Implementation Plan

1. Scaffold a small ESM npm package with a thin bin wrapper and dependency-free
   implementation.
2. Implement discovery scoring for native LLMWiki roots and common Markdown app
   markers.
3. Add default filters for dependency, cache, build, smoke, variant, and
   generated workspace internals.
4. Validate candidates by invoking `llmwiki-serve manifest`.
5. Start selected sources through `llmwiki-serve serve` and write a local source
   config.
6. Register sources through the bridge settings endpoint with merge/upsert
   semantics.
7. Add a bridge smoke command that uses evidence-only mode.
8. Verify with unit tests, package dry-run, targeted local discovery, and a
   local source restart smoke.

## Risks

- Full-home scans can be slow on large machines; keep validation opt-in and add
  narrowing flags.
- App-style vault roots and nested `wiki/` projections can duplicate each other;
  prefer the app root by default.
- Existing bridge registry settings must not be overwritten accidentally.
