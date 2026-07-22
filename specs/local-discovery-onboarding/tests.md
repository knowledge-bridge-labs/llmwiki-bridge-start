# Test Plan

## Automated

- CLI argument parsing for repeated options.
- Native LLMWiki scoring.
- OpenWiki-compatible projection scoring using the native projection marker
  family.
- `skills/wiki` false-positive penalty.
- Nested `wiki/` preference for non-app source containers.
- Generated smoke artifact filtering.
- `.llmwiki-work` internal `input/`, `sources/`, and e2e filtering.
- Fast discovery prefiltering through an injected scanner so tests do not
  depend on local OS tool availability.
- JavaScript fallback scanner inclusion of marker-shaped roots and exclusion of
  generated/dependency folders.
- App-root preference over direct child `wiki/`.
- Marker recognition for Obsidian, Logseq `config.edn`, Dendron, Foam, and
  Quartz source variants at the default discovery threshold.
- Low-confidence fallback recognition for Logseq `pages/` plus `journals/`
  graphs that do not include `logseq/config.edn`.
- Low-confidence fallback recognition for Foam VS Code extension hints that do
  not include `.foam/`.
- Default hiding of low-confidence generic folders.
- Lowered-threshold inclusion of generic Markdown fallback folders.
- `discover --validate` manifest success and failure reporting using a
  controlled `llmwiki-serve manifest` invocation.
- `start` refusal to launch a source when manifest validation fails.
- Quickstart direct-source-only path: discover approval, multi-select, validate,
  start, then skip bridge setup successfully while printing direct source URLs.
- Quickstart bridge path: explicit bridge setup approval, merge registration,
  and smoke mode selection.
- LLM endpoint detection for delegated-runtime bridge smoke; evidence-only when
  no explicit endpoint is configured.
- Bridge registry upsert by URL.
- Bridge registry upsert by stable ID when source ports move.
- Credential-bearing source URL rejection.
- `npm run check`, including syntax checks, Node tests, and package dry-run.

## Manual/local smoke

- Run `doctor` against a local bridge.
- Run targeted `discover --validate` against representative local source roots.
- Start multiple local sources on loopback ports.
- Verify `/health` and `/manifest` for started sources.
- Run bridge smoke using the existing bridge registry, evidence-only by default
  and delegated-runtime when an explicit LLM endpoint is configured.
