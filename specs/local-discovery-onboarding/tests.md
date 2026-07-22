# Test Plan

## Automated

- CLI argument parsing for repeated options.
- Native LLMWiki scoring.
- `skills/wiki` false-positive penalty.
- Nested `wiki/` preference for non-app source containers.
- Generated smoke artifact filtering.
- `.llmwiki-work` internal `input/`, `sources/`, and e2e filtering.
- App-root preference over direct child `wiki/`.
- Default hiding of low-confidence generic folders.
- Bridge registry upsert by URL.
- Bridge registry upsert by stable ID when source ports move.
- Credential-bearing source URL rejection.
- `npm run check`, including syntax checks, Node tests, and package dry-run.

## Manual/local smoke

- Run `doctor` against a local bridge.
- Run targeted `discover --validate` against representative local source roots.
- Start multiple local sources on loopback ports.
- Verify `/health` and `/manifest` for started sources.
- Run evidence-only bridge smoke using the existing bridge registry.
