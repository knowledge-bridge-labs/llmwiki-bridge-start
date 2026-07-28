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
   sources. Before launching any source process, reject selected
   ancestor/descendant paths and duplicate manifest `source_id` values with an
   actionable error.
7. Register sources through the bridge settings endpoint with merge/upsert
   semantics. Reject duplicate incoming source IDs before writing bridge
   settings so older generated configs cannot silently collapse entries.
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
   - When the user completes without bridge setup, print one generic
     coding-agent MCP Streamable HTTP registration URL (`/mcp/stream`) for each
     started source.
9. Add bridge runtime setup inside the optional quickstart bridge step.
   - Offer skip/evidence-only, Hermes, and DeepAgents before any bridge start
     attempt.
   - Collect endpoint and model for already-running Hermes/DeepAgents
     endpoints, using the matching fixed runtime profile.
   - Keep explicit `--llm-endpoint` support as a preconfigured compatibility
     path, not as an interactive QuickStart menu choice.
   - Keep DeepAgents ACP as an explicit adapter path selected with
     `--runtime-adapter deepagents-acp`. When selected, pass
     `LLMWIKI_AGENT_BRIDGE_RUNTIME_ADAPTER=deepagents-acp` to background bridge
     starts and `runtimeAdapter: "deepagents-acp"` to a running bridge settings
     update. Do not infer ACP from the DeepAgents profile alone.
   - Treat Hermes and DeepAgents as bridge runtime profiles. Offer runtime CLI
     auto-install only through a fixed allowlist backed by official runtime
     docs, show the official command, require explicit approval, download the
     HTTPS installer script to the QuickStart log directory, and run it through
     fixed argv runner commands with final redirected URL HTTPS checks and a
     minimal installer environment allowlist. If installation is skipped,
     unavailable, or fails, print safe installation guidance and ask for the
     endpoint after the runtime is running.
   - Feed the runtime setup result into runtime detection, bridge start env, and
     smoke mode selection. If the endpoint is skipped or blank, force the
     evidence-only bridge path for this quickstart run unless the user
     explicitly selected the DeepAgents ACP adapter path.
10. Start `llmwiki-agent-bridge` with `cross-spawn` so package command
    resolution works cross-platform without a hand-written Windows `cmd.exe`
    wrapper.
11. Add a `status`/`ls` command that reconciles local started-source config,
   live source health, and bridge registry state when reachable.
12. Add an optional bridge smoke command that uses evidence-only mode by default
   and delegated-runtime only when an explicit or bridge-configured runtime is
   reachable. Evidence-only output must say delegated runtime was not checked.
13. Verify with unit tests, package dry-run, targeted local discovery, and a
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
- Hermes/DeepAgents install commands can drift; keep them in a fixed,
  documented allowlist sourced from official runtime docs, require explicit
  approval, and keep `--yes` safe unless `--install-runtime` is also present.
  Prefer endpoint entry plus evidence-only fallback when uncertain.
- Hand-written Windows command wrappers can diverge from macOS/Linux behavior;
  rely on `cross-spawn` for bridge process startup.
- Spawned source processes can fail after launch because of port conflicts,
  missing runtime dependencies, or adapter errors; verify `/health` before
  presenting a URL as ready and clean up failed child processes.
- Historical generated source configs may contain duplicate IDs. `status`
  should report them clearly, while `register` should refuse to write them back
  into the bridge registry.

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
- Quickstart docs must state that the bridge setup step now includes runtime
  setup choices for skip/evidence-only, Hermes, and DeepAgents, and that
  Hermes/DeepAgents use the bridge runtime profiles documented by
  `llmwiki-agent-bridge`.
- Quickstart docs must state that endpoint, model, and profile feed
  `LLMWIKI_AGENT_BRIDGE_BASE_URL`, `LLMWIKI_AGENT_BRIDGE_MODEL`, and
  `LLMWIKI_AGENT_BRIDGE_RUNTIME_PROFILE` for a started bridge.
- Quickstart docs must state that `--runtime-adapter deepagents-acp` is the
  opt-in DeepAgents ACP path. It feeds
  `LLMWIKI_AGENT_BRIDGE_RUNTIME_ADAPTER=deepagents-acp` for background bridge
  starts and `runtimeAdapter: "deepagents-acp"` for running bridge settings.
  DeepAgents without that adapter remains endpoint-input/evidence-only.
- Quickstart docs must state that Hermes/DeepAgents runtime CLI auto-install is
  allowed only from the official-doc-backed allowlist and only after explicit
  approval. Docs must also state that installer logs are written under
  `.llmwiki-bridge-start/logs`, that `--yes` requires `--install-runtime` before
  running installers, and that installation does not configure credentials,
  start Hermes gateway, or let DeepAgents imply a bridge runtime endpoint.
- Quickstart docs must explain the skip-bridge MCP registration URL handoff and
  avoid client-specific MCP configuration syntax.
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
- Status docs must say that `status`/`ls` is a local diagnostic command over
  `.llmwiki-bridge-start/sources.json`, source `/health`, and reachable bridge
  registry state.
- Smoke docs must distinguish evidence-only source checks from
  delegated-runtime checks, and must say delegated-runtime requires a reachable
  runtime endpoint.
- Non-goals must remain explicit that the harness does not compile knowledge,
  convert app-specific syntax, crawl or sync remote sources, or replace bridge
  orchestration.
