# Test Plan

## Automated

- CLI argument parsing for repeated options.
- Native LLMWiki scoring.
- OpenWiki-compatible projection scoring using the native projection marker
  family.
- `.wiki-compiler.json` native marker recognition.
- Source-like Markdown wiki roots are classified as `LLMWiki Markdown`, default
  visible, and not mislabeled as Native projection.
- Source-like Markdown wiki roots with `hot.md` plus `index.md`/`overview.md`
  remain `LLMWiki Markdown`, not Native, unless projection metadata or compiler
  markers are present.
- Native classification requires stronger projection evidence such as
  `.wiki-compiler.json`, sidecar graph/projection metadata, or `source_refs`;
  `review_state` or `wiki_title` alone do not classify a folder as Native.
- Frontmatter-only Markdown folders stay Generic Markdown, remain hidden at the
  default discover threshold, and render as `[Generic Markdown]` when included
  through a lowered threshold and `--include-additional`.
- Docs-like folders with only hub files plus typed folders, or `hot.md` plus
  index/overview alone, stay Generic Markdown and remain hidden at the default
  threshold.
- `.wiki-compiler.json` still takes precedence as Native and `.obsidian/` still
  takes precedence as Obsidian over source-like Markdown root shape.
- `skills/wiki` false-positive penalty.
- Nested `wiki/` preference for non-app source containers.
- Generated smoke artifact filtering.
- `.llmwiki-work` internal `input/`, `sources/`, and e2e traversal filtering.
- Fast discovery prefiltering through an injected scanner so tests do not
  depend on local OS tool availability.
- JavaScript fallback scanner inclusion of marker-shaped roots and exclusion of
  dependency/cache/build/generated infrastructure folders.
- `discover` reports parent/child overlap when both paths meet the score
  threshold, including app vault roots with strong direct child `wiki/` sources.
- Quickstart app-root/direct child `wiki/` handling: strong direct child `wiki/`
  sources render as recommended, while the parent app vault renders in the
  additional section and is hidden from default selection without
  `--include-additional`.
- Marker recognition for Obsidian, Logseq `config.edn`, Dendron, Foam, and
  Quartz source variants at the default discovery threshold, including exact
  variant IDs and user-facing labels.
- Explicit app markers keep their app variant label over weak native-looking
  structures unless the source has stronger projection evidence such as an
  explicit compiler marker, sidecar graph metadata, or `source_refs`.
- Low-confidence fallback recognition for Logseq `pages/` plus `journals/`
  graphs that do not include `logseq/config.edn`.
- Low-confidence fallback recognition for Foam VS Code extension hints that do
  not include `.foam/`.
- Default threshold omission of low-confidence generic folders.
- Lowered-threshold inclusion of generic Markdown fallback folders.
- `discover --validate` manifest success and failure reporting using a
  controlled `llmwiki-serve manifest` invocation.
- `start` refusal to launch a source when manifest validation fails.
- `start` readiness behavior: successful launches wait for `/health`, while
  failed readiness cleans up the spawned process and reports an actionable
  failure.
- CLI dispatch paths: `llmwiki-bridge-start` starts quickstart by default,
  explicit `quickstart` remains equivalent, and explicit `discover` remains the
  scriptable listing command.
- Quickstart direct-source-only path: discover approval, multi-select, validate,
  start, then skip bridge setup successfully while printing direct source URLs.
- Quickstart default source selection hides additional app/generic/noisy
  candidates, keeps `all` scoped to the currently listed candidates, and
  validates/starts only recommended selections.
- Quickstart `--include-additional` renders recommended and additional
  candidates as separate sections, including app vaults, graphs, workspaces,
  generic Markdown folders, and noisy paths, and allows selecting the
  additional section.
- Quickstart with only additional candidates stops before selection/validation
  unless `--include-additional` is set.
- Quickstart TTY source selection routes through the checkbox multi-select
  adapter, preselects the first candidate, and maps selected ranks to candidate
  paths.
- Quickstart non-TTY source selection prints the concise numbered fallback list
  and keeps prompts on separate lines for piped input; interactive text fallback
  reprompts on invalid source selections rather than failing on the first typo.
- Quickstart interactive yes/no prompts reprompt on invalid answers, while
  non-interactive automation avoids unbounded waiting.
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
