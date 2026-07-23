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
- `--path DIR` discovery/quickstart scope stays constrained to that directory
  tree and does not include sibling workspace or home-directory candidates.
- JavaScript fallback scanner inclusion of marker-shaped roots and exclusion of
  dependency/cache/build/generated infrastructure folders.
- `discover` reports parent/child overlap when both paths meet the score
  threshold, including app vault roots with strong direct child `wiki/` sources.
- Quickstart app-root/direct child `wiki/` handling: strong direct child `wiki/`
  sources render as recommended, while the parent app vault renders in the
  advanced/lower-priority section and is hidden from default selection without
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
- README/CLI quickstart copy leads with recommended first-run forms
  (`--path ./wiki`, `--workspace`, or bare invocation) and keeps
  `discover`/`start`/`register`/`smoke` examples in advanced/scriptable docs.
- Quickstart direct-source-only path: discover approval, multi-select, validate,
  start, then skip bridge setup successfully while printing MCP registration
  URL handoff info.
- Quickstart skip-bridge handoff lists one MCP Streamable HTTP registration URL
  (`/mcp/stream`) for every started source without asserting client-specific
  configuration syntax or printing extra source/health/manifest/MCP JSON-RPC
  URL labels.
- Quickstart success copy treats a healthy printed local source URL as the
  minimum onboarding success and describes bridge setup as optional.
- Quickstart default source selection hides advanced/lower-priority
  app/generic/noisy
  candidates, keeps `all` scoped to the currently listed candidates, and
  validates/starts only recommended selections.
- Quickstart `--include-additional` renders recommended and
  advanced/lower-priority candidates as separate sections, including app vaults,
  graphs, workspaces, generic Markdown folders, and noisy paths, and allows
  selecting the advanced section.
- Quickstart explains that Native LLMWiki/OpenWiki is a compiled projection and
  LLMWiki Markdown is a source-like wiki served by the Markdown adapter.
- Quickstart with only advanced/lower-priority candidates stops before
  selection/validation unless `--include-additional` is set.
- Quickstart TTY source selection routes through the checkbox multi-select
  adapter, preselects the first candidate, and maps selected ranks to candidate
  paths.
- Quickstart non-TTY source selection prints the concise numbered fallback list
  and keeps prompts on separate lines for piped input; interactive text fallback
  reprompts on invalid source selections rather than failing on the first typo.
- Quickstart first-run transcript includes a short `llmwiki-*`,
  `llmwiki-serve`, and optional `llmwiki-agent-bridge` explanation before
  asking questions.
- Quickstart yes/no prompts echo explicit and defaulted selections, and the
  discovery prompt keeps the main question, scan-scope explanation, and
  `[Y/n]` marker on separate lines.
- Quickstart interactive yes/no prompts reprompt on invalid answers, while
  non-interactive automation avoids unbounded waiting.
- Quickstart TTY yes/no prompts route through an immediate keypress-capable
  confirm adapter so `y`/`n` completes without Enter, while injected prompt and
  non-TTY fallback paths remain text-based.
- Quickstart discovery progress renders a visible TTY heartbeat/progress line
  and records clear non-TTY start/completion transcript lines.
- Quickstart bridge setup copy explains bridge purpose and direct MCP skip
  behavior before asking, and the background-start question says that
  quickstart will run the command detached, write logs, and wait for health.
- Quickstart bridge setup approval is followed by a runtime setup choice before
  bridge start. The choice list includes skip/evidence-only, Hermes, and
  DeepAgents, and does not include a generic/existing OpenAI-compatible
  endpoint option.
- Explicit preconfigured endpoint flags can still feed runtime values to
  bridge start env and delegated-runtime smoke as a compatibility path without
  appearing in the interactive first-run menu.
- Existing running bridge runtime setup applies safe endpoint/model/profile
  fields through `/settings/config.json` before delegated-runtime smoke, and
  avoids sending API keys or bearer tokens.
- Hermes and DeepAgents runtime setup prints first-class profile guidance and,
  when no repo-confirmed install command exists, does not auto-install. It
  prints safe install/start guidance, prompts for an endpoint after the runtime
  is running, uses the matching fixed runtime profile, and falls back to
  evidence-only if the endpoint is blank.
- Runtime setup skip/evidence-only disables inherited runtime env detection for
  the quickstart bridge smoke path.
- Evidence-only or unconfigured bridge startup scrubs inherited runtime/API-key
  environment variables from the spawned bridge child process while preserving
  normal environment and explicit bridge host/port settings.
- Quickstart bridge path: explicit bridge setup approval, merge registration,
  and smoke mode selection.
- Bridge start uses the `cross-spawn` adapter directly for package commands,
  including Windows `.cmd` command names, without a hand-written `cmd.exe`
  wrapper.
- CLI output may include full local paths for candidate disambiguation but must
  warn users to redact or replace them before publishing screenshots, logs,
  docs, or issue reports.
- LLM endpoint detection for delegated-runtime bridge smoke; evidence-only when
  no explicit endpoint is configured.
- Bridge registry upsert by URL.
- Bridge registry upsert by stable ID when source ports move.
- Bridge registry selected-ID override: quickstart/register merge preserves
  unrelated registered entries but selects only the requested active source IDs
  so stale selected sources do not participate in bridge fan-out.
- Credential-bearing source URL rejection.
- `npm run check`, including syntax checks, Node tests, and package dry-run.

## Manual/local smoke

- Run `doctor` against a local bridge.
- Run targeted `discover --validate` against representative local source roots.
- Run targeted `discover --path <source-root> --validate` and confirm unrelated
  local candidate siblings are not scanned or displayed.
- Start multiple local sources on loopback ports.
- Verify `/health` and `/manifest` for started sources.
- Run bridge smoke using the existing bridge registry, evidence-only by default
  and delegated-runtime when an explicit LLM endpoint is configured.
