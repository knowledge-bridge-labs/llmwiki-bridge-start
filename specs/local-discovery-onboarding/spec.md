# Local Discovery Onboarding

## Problem

AX users often already have one or more local knowledge artifacts, but they need
a low-friction way to find usable LLMWiki-compatible folders, start
`llmwiki-serve`, obtain a local source URL, and optionally connect sources to
`llmwiki-agent-bridge` when they need bridge orchestration.

## Goals

- Discover likely local source roots for native LLMWiki/OpenWiki projections,
  source-like LLMWiki Markdown roots, Obsidian vaults, Logseq graphs, Dendron
  workspaces, Foam workspaces, Quartz site sources, and generic Markdown
  fallback folders.
- Keep scriptable discovery broad and transparent within the directories it
  scans: show every candidate that meets the selected score threshold,
  including parent/child overlap.
- Keep quickstart source selection focused by presenting recommended sources
  separately from advanced/lower-priority app, workspace, graph, generic, and
  noisy paths.
- Validate candidates through `llmwiki-serve manifest` when requested.
- Start selected local sources on loopback ports.
- Treat started `llmwiki-serve` source endpoints as immediately useful even
  when the user skips `llmwiki-agent-bridge`.
- When completing without `llmwiki-agent-bridge`, print one coding-agent MCP
  Streamable HTTP registration URL (`/mcp/stream`) for each started source,
  with a concise MCP-over-HTTP/Streamable HTTP note and without claiming a
  specific client config syntax.
- Define first onboarding success as a reachable local source URL; bridge
  setup, bridge registration, and bridge smoke checks are optional next steps.
- Make `llmwiki-agent-bridge` setup optional and explicit.
- When the user opts into bridge setup, include LLM runtime setup before bridge
  startup rather than treating Hermes or DeepAgents runtime configuration as a
  later step.
- Optionally upsert sources into an existing bridge registry without deleting
  unrelated sources.
- Optionally run an A2A-style smoke query against the bridge, using
  delegated-runtime when an explicit LLM endpoint is configured through flags,
  environment, or quickstart runtime setup, and evidence-only otherwise.

## Non-goals

- Compiling repositories into knowledge graphs.
- Converting or normalizing Obsidian, Logseq, Dendron, Foam, or Quartz syntax
  into canonical LLMWiki projection pages.
- Guaranteeing that a detected app vault is startable without
  `llmwiki-serve manifest` validation.
- Crawling remote wikis, syncing app state, or publishing static sites.
- Owning model runtime lifecycle, Redis, auth, TLS, Docker, or Kubernetes.
  Quickstart may guide Hermes or DeepAgents runtime setup, but it must not
  auto-install or start a runtime unless this repository or directly referenced
  bridge docs contain a confirmed safe command and the user explicitly approves
  it.
- Replacing `llmwiki-agent-bridge` orchestration.
- Treating generated local work folders as canonical project docs.

## Supported Source Variants

Discovery assigns scores from local filesystem markers. The default
`--min-score` is `30`, so medium and high candidates are shown by default while
plain low-confidence Markdown folders require an intentional lower threshold.
`discover` is scriptable inventory: after traversal safety guards choose which
directories to inspect, any candidate that meets the selected score threshold
must remain visible even when it is an app vault root, a generic path, or a
parent of a stronger child `wiki/` source.

| Variant | Detection markers | Default confidence expectation |
| --- | --- | --- |
| Native LLMWiki/OpenWiki projection | `.wiki-compiler.json`; sidecar graph or projection metadata such as `graph/graph.json`; or structural projection combinations that include stronger projection frontmatter such as `source_refs` or `sources`, `hot.md` with `index.md` or `overview.md`, and typed folders such as `concepts/`, `entities/`, `sources/`, or `queries/`. Frontmatter alone, `review_state` alone, `wiki_title` alone, `hot.md` plus index/overview alone, and docs-like hub plus typed folders must not classify a folder as Native. | Medium to high; high when multiple projection markers combine. |
| LLMWiki Markdown | Source-like root names such as `wiki`, `llmwiki`, `openwiki`, or `vault`, plus typed folders and either a strong hub pair (`hot.md` with `index.md` or `overview.md`) or a hub file with a larger Markdown set. This is distinct from a compiled Native projection. | Medium to high; validation determines whether `llmwiki-serve` can start it. |
| Obsidian vault | `.obsidian/` plus Markdown notes. Strong direct child `wiki/` sources do not remove the vault root from `discover`; both paths remain visible when both meet the score threshold. Default quickstart recommends the child `wiki/` source and treats the parent app vault as advanced/lower-priority. App markers keep the app variant label unless stronger projection evidence such as `.wiki-compiler.json`, sidecar graph metadata, or `source_refs` marks a compiled projection. | Medium before validation. |
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
- `--path DIR` must constrain discovery to the selected directory tree instead
  of scanning the current user's home directory, workspace siblings, or
  unrelated local projects.
- `discover` output must expose the score, confidence, and marker signals that
  caused each candidate to appear.
- `discover` must report every candidate that meets the selected score
  threshold after traversal safety guards have selected directories to inspect.
  It must not hide parent/child overlap, app vault roots, or generic Markdown
  folders for quickstart presentation reasons.
- Default discovery uses the medium-confidence threshold; low-confidence
  generic Markdown fallback discovery requires lowering `--min-score`.
- Native LLMWiki/OpenWiki classification must require stronger projection
  evidence such as `.wiki-compiler.json`, sidecar graph/projection metadata, or
  `source_refs`/`sources` projection frontmatter. `review_state` or
  `wiki_title` alone must not be treated as Native evidence.
- Frontmatter-only Markdown folders must stay generic, even when they contain
  weak projection-like fields such as `review_state` or `wiki_title`.
- Docs-like Markdown folders with only hub files and typed folders must stay
  generic unless graph or projection metadata is also present.
- Source-like Markdown wiki roots with typed folders and either a strong hub
  pair (`hot.md` with `index.md` or `overview.md`) or a hub file plus a larger
  Markdown set should be classified as LLMWiki Markdown rather than Native or
  low-confidence generic fallback.
- `register` must merge by default and require explicit `--replace` to wipe the
  bridge registry.
- When `quickstart` registers started sources with the bridge, the newly
  started sources must become the active selected set for bridge fan-out.
  Existing unrelated bridge registry entries must be preserved in merge mode
  but stale selected entries must be deselected.
- Invoking `llmwiki-bridge-start` without a subcommand must start the
  quickstart flow; explicit `quickstart` remains equivalent and explicit
  `discover` remains available for scriptable candidate listing.
- Public quickstart documentation must lead with recommended first-run
  invocations only: `npx llmwiki-bridge-start@latest --path ./wiki`,
  `npx llmwiki-bridge-start@latest --workspace`, and bare
  `npx llmwiki-bridge-start@latest`. `discover`, `start`, `register`, and
  `smoke` examples belong in an advanced/scriptable commands section so first
  users do not read them as a mandatory sequence.
- `quickstart` must ask before discovery and make the default home-directory
  scan scope visible unless `--path`, `--workspace`, or `--cwd` constrains it.
- In constrained discovery mode (`--path`, `--workspace`, or `--cwd`), the
  discovery approval prompt must say that quickstart will find source folders
  under the shown root(s), not that it will broadly auto-discover local
  folders. If the user declines in constrained mode, the next action must not
  imply they forgot to pass a path.
- `quickstart` must open with a concise first-time-user explanation of what
  `llmwiki-*` does, what `llmwiki-serve` will expose, and why
  `llmwiki-agent-bridge` is optional.
- Long yes/no prompts must keep the main question and explanatory scope text on
  separate lines, and every yes/no answer must be echoed as an explicit
  transcript choice, including defaulted choices.
- In TTY interactive quickstart, yes/no prompts must accept a `y` or `n`
  keypress immediately without requiring Enter. Non-TTY, piped, injected
  `io.prompt`, and `--yes` flows must keep their text/flag fallbacks.
- After discovery approval, quickstart must show visible discovery progress:
  a visible spinner/progress line in TTY terminals and clear start/completion
  transcript lines in non-TTY output. The progress indicator must be driven
  while discovery is actually running, not printed only after completion.
- `quickstart` must keep the default source selection list focused on
  recommended LLMWiki source folders: Native LLMWiki/OpenWiki projections and
  LLMWiki Markdown roots. Quickstart must explain that Native
  LLMWiki/OpenWiki is an already compiled projection, while LLMWiki Markdown is
  a source-like wiki served through the Markdown adapter. App vaults, graphs,
  workspaces, generic Markdown folders, and noisy example/demo/starter/e2e
  candidates are advanced/lower-priority and require `--include-additional`
  when at least one recommended source exists.
- If quickstart sees both an app vault root and a strong direct child `wiki/`
  source, default quickstart must recommend the child and keep the parent app
  vault in the advanced/lower-priority section.
- If quickstart finds only advanced/lower-priority candidates without
  `--include-additional`, it must stop before selection, validation, or startup
  rather than selecting an app vault or fixture by default.
- `quickstart` must support TTY checkbox-style multi-select source startup,
  preserve comma-separated text selection for non-TTY/automation, and allow a
  successful direct-source-only exit before bridge setup.
- After source selection, `quickstart` must echo the selected source label(s)
  and full local path(s), including when the user accepts the default first
  candidate.
- In interactive terminals, `quickstart` may clear the visible screen between
  major screens to keep the current decision focused. This must happen only
  when stdin and stdout are both TTYs and CI is not detected, must not clear
  terminal scrollback, and must be disabled by `--no-clear-screen` or
  `LLMWIKI_BRIDGE_START_NO_CLEAR_SCREEN=1`. Redirected, piped, injected prompt,
  and non-TTY transcripts must remain stable. After the source-selection screen
  is cleared, the validation/start screen must reprint the selected source
  label(s) and full local path(s).
- After source startup approval, `quickstart` must show visible validation
  progress while `llmwiki-serve manifest` compatibility checks are actually
  running. TTY output should use the same spinner/progress style as discovery;
  non-TTY output should keep stable transcript lines.
- When visible candidates have repeated `wiki` basenames or live under
  `.llmwiki-work`, quickstart should add cheap parent/project context to the
  display label while preserving the full path line.
- `quickstart` must explain near the start that a printed, healthy local source
  URL is the minimum successful onboarding outcome and that bridge setup is
  optional.
- After starting selected sources, `quickstart` must state that direct source
  endpoints are healthy and remain usable if the user skips bridge setup.
- Direct-source and bridge completion handoffs must keep the final screen
  concise: show the endpoint/next-action decision first, then a clearly
  separated compact operational details section. PIDs, full log paths, and stop
  guidance must be written to a saved handoff file, normally
  `.llmwiki-bridge-start/quickstart-handoff.md`; if the summary cannot be
  written, quickstart may show a compact fallback detail block. Stop guidance
  must not ask users to kill by broad process name or port.
- Before asking about bridge setup, `quickstart` must explain what
  `llmwiki-agent-bridge` adds, when it is useful, and that skipping it still
  leaves direct MCP Streamable HTTP source URLs ready to use. Bridge setup
  prompts must describe the installation/start intent explicitly, including
  what happens when quickstart starts the bridge command in the background.
- When the user skips bridge setup, `quickstart` must print one generic
  coding-agent MCP Streamable HTTP registration URL (`/mcp/stream`) for every
  started source.
- The direct-source handoff must say the URLs are MCP-over-HTTP/Streamable HTTP
  server URLs, avoid client-specific MCP configuration syntax, and omit
  source, health, manifest, and MCP JSON-RPC endpoint labels.
- `start`/`quickstart` must not report a launched source as ready until its
  loopback HTTP health endpoint responds within a bounded timeout.
- Before launching each source, `start`/`quickstart` must check the requested
  loopback host and port. If the port is already occupied, it must advance to
  the next available port and must not treat a pre-existing `/health` response
  on the requested port as readiness for the newly launched source.
- When quickstart starts a source on a different port because the requested
  port was occupied, it must print a concise info line naming the requested
  port, source title/id, and assigned port.
- `quickstart` must not start or install `llmwiki-agent-bridge` unless the user
  explicitly opts in.
- After the user opts into bridge setup and before any bridge start attempt,
  `quickstart` must offer runtime setup choices for skip/evidence-only,
  Hermes, and DeepAgents. Generic/custom OpenAI-compatible endpoints must not
  appear as an interactive first-run menu choice.
- If an explicit LLM endpoint is provided through flags, quickstart may treat
  it as a preconfigured compatibility path and reflect those values in
  `LLMWIKI_AGENT_BRIDGE_BASE_URL`, `LLMWIKI_AGENT_BRIDGE_MODEL`, and
  `LLMWIKI_AGENT_BRIDGE_RUNTIME_PROFILE`, but this path must not be advertised
  as a happy-path option.
- When no bridge is reachable, manual bridge-start guidance must be
  copy-paste safe for a custom `--bridge http://host:port`: printed examples
  must include `LLMWIKI_AGENT_BRIDGE_HOST` and
  `LLMWIKI_AGENT_BRIDGE_PORT` for the requested bridge URL, plus the same safe
  runtime env fields that quickstart would pass to a background bridge start
  when a runtime is configured. Shell-specific quoting must be explicit and
  cross-platform copy should avoid overclaiming one shell's syntax works
  everywhere.
- If the user chooses manual bridge startup and defers registration/smoke,
  quickstart must print the next register and smoke commands for the selected
  bridge URL and source config, plus direct source MCP URLs that remain usable
  meanwhile.
- If `llmwiki-agent-bridge` is already running and the user configures a
  runtime endpoint during quickstart, quickstart must apply safe runtime fields
  through the bridge settings API before registration and smoke. If that live
  settings write fails, quickstart must avoid delegated-runtime smoke by
  falling back to evidence-only or stopping before bridge checks.
- After successful bridge registration and smoke, quickstart must print a
  final bridge handoff with the bridge base URL, A2A-style answer endpoint
  (`POST /message:send`), MCP-style JSON-RPC endpoint (`POST /mcp`), and
  settings UI (`/settings`). This bridge handoff must not describe the bridge
  as MCP Streamable HTTP or use the direct-source `/mcp/stream` path. The
  handoff should be concise and grouped separately from operational process
  details.
- Hermes and DeepAgents must be presented as first-class bridge runtime
  profiles. If the user already has one running, quickstart must collect its
  endpoint and model, then use the matching fixed runtime profile. If not,
  quickstart must provide a safe install and start path. Auto-install is
  allowed only when the current repository or directly referenced bridge docs
  confirm the exact command/package; otherwise quickstart must not run an
  installer and must instead print safe guidance, then prompt for the endpoint
  after the runtime is running.
- In interactive terminals, runtime setup must use the same guided prompt style
  as the rest of QuickStart rather than a raw numeric text prompt. Numeric/text
  runtime setup aliases remain supported for non-interactive, piped, injected
  prompt, `--yes`, and explicit flag flows.
- If the user selects Hermes or DeepAgents but skips installation or endpoint
  input, quickstart must continue with an evidence-only bridge path and print a
  clear next action for rerunning with `--llm-endpoint`, `--llm-model`, and
  `--runtime-profile`.
- Hermes and DeepAgents endpoint prompts must make default behavior explicit:
  if a default endpoint is shown, blank Enter uses that default and `skip`
  forces evidence-only; if no default is shown, blank Enter or `skip` continues
  evidence-only. Defaults may come from explicit CLI flags, the standard
  `LLMWIKI_AGENT_BRIDGE_BASE_URL`, or a framework-supported local health probe
  such as Hermes `/health`. Quickstart must not treat legacy/user-local aliases
  such as `HERMES_BASE_URL`, `DEEPAGENTS_BASE_URL`, or `OPENAI_BASE_URL` as
  first-run defaults.
- Runtime setup must check framework installation with framework-supported CLI
  entrypoints: Hermes via `hermes --version`, DeepAgents Code via
  `dcode --version`. Additional diagnostics may be shown only when they are
  supported by the framework docs, such as `hermes doctor`, `hermes status`,
  `dcode doctor`, or `dcode config show --json`.
- Hermes runtime setup must verify a selected/default endpoint through the
  framework-supported API-server health endpoint before configuring the bridge.
  If the health check fails, quickstart must continue evidence-only and print a
  clear next action. DeepAgents must not claim automatic endpoint detection
  unless a supported local runtime health/discovery method is available.
- Runtime setup results must flow through the same runtime detection path used
  by bridge startup env construction and bridge smoke mode selection. An
  explicit skip/evidence-only runtime setup choice must prevent inherited
  runtime environment variables from switching smoke mode to delegated-runtime.
- When evidence-only runtime setup is selected or runtime setup is otherwise
  unconfigured, bridge process startup must scrub known runtime and API-key
  environment variables before spawning the bridge child process.
- Bridge process startup must use a cross-platform spawn adapter such as
  `cross-spawn`, not a hand-written `cmd.exe`/OS-specific wrapper. The same
  bridge start path must work on Windows, macOS, and Linux.
- `quickstart --yes` must remain safe for smoke automation: accept discovery and
  source-start defaults, select the first candidate, and skip optional bridge
  setup unless `--setup-bridge` is also supplied.
- Source URLs with credentials or unsupported schemes must be rejected.
- The CLI must print full local paths for local source disambiguation and warn
  users to redact or replace them before publishing screenshots, logs, docs, or
  issue reports.
- Tests must cover scoring, discover parent/child overlap transparency,
  quickstart recommended/advanced presentation, supported-variant markers,
  default generic fallback behavior, manifest validation behavior where
  practical, and registry merge safety.
