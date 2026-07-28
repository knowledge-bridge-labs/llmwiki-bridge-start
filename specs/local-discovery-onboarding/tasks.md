# Tasks

- [x] Create npm package scaffold.
- [x] Add discovery scoring and filters.
- [x] Add fast discovery prefilter with OS-tool preference and JS fallback.
- [x] Add manifest validation.
- [x] Add source start command.
- [x] Add source HTTP readiness checks before reporting started URLs.
- [x] Add bridge register command.
- [x] Add bridge smoke command.
- [x] Add unit tests for discovery and registry safety.
- [x] Run local package check.
- [x] Run targeted local discovery validation.
- [x] Restart local source servers with the new CLI and run bridge smoke.
- [x] Add interactive prompt flow for first-run UX.
- [x] Add TTY-only checkbox multi-select for quickstart source selection with
  non-TTY text fallback.
- [x] Default bare CLI invocation to quickstart while preserving explicit
  quickstart and discover commands.
- [x] Document supported source variants in README and docs.
- [x] Document and test final public quickstart behavior, including default
  home-scan messaging and `--yes` behavior.
- [x] Add skip-bridge coding-agent MCP URL handoff output, with one
  `/mcp/stream` URL per started source.
- [x] Prefer a sibling `llmwiki-serve` checkout's `.venv` executable over
  `uv run` for long-running source servers when available.
- [x] Improve first-run prompt transcript with a concise `llmwiki-*`
  explanation, multiline discovery prompts, and explicit yes/no choice echoes.
- [x] Make TTY yes/no quickstart prompts complete on `y`/`n` keypress without
  Enter, add discovery progress feedback, and clarify bridge setup prompts.
- [x] Add QuickStart bridge runtime setup choices for skip/evidence-only,
  Hermes, and DeepAgents before bridge startup.
- [x] Remove generic/existing OpenAI-compatible endpoints from the interactive
  first-run runtime setup menu while keeping explicit endpoint flags as a
  compatibility path.
- [x] Pass runtime setup endpoint/model/profile into bridge start env and smoke
  mode selection, with evidence-only fallback when endpoint setup is skipped.
- [x] Apply configured runtime endpoint/model/profile to an already running
  bridge through the settings API before delegated-runtime smoke.
- [x] Make quickstart bridge registration select all newly started source IDs
  and deselect stale selected sources while preserving unrelated registry
  entries in merge mode.
- [x] Validate runtime profiles as `generic`, `hermes`, or `deepagents` so
  yes/no answers cannot be silently consumed as invalid profile names.
- [x] Scrub inherited runtime/API-key environment variables when bridge startup
  proceeds in evidence-only or unconfigured runtime mode.
- [x] Use `cross-spawn` for bridge process startup instead of a hand-written
  Windows `cmd.exe` wrapper.
- [x] Polish expert-verification onboarding UX follow-ups: constrained-scope
  discovery prompt wording, source port fallback info, and final bridge
  endpoint handoff copy.
- [x] Implement branch-by-branch expert-evaluation onboarding fixes: custom
  bridge manual-start env examples for requested host/port, source selection
  echo, compact operational handoff copy with saved PID/log details, clearer
  runtime endpoint default/skip prompts, and cheap repeated-`wiki` candidate
  context.
- [x] Add active timer spinner/progress feedback during long discovery and
  manifest validation phases, and format final bridge handoff as a readable
  grouped block.
- [x] Stop treating legacy/user-local runtime env aliases as first-run
  QuickStart defaults; verify Hermes endpoints through supported health checks.
- [x] Check runtime framework installation with framework-supported CLI
  entrypoints (`hermes --version`, `dcode --version`) and avoid inferring a
  DeepAgents bridge endpoint without a documented endpoint discovery contract.
- [x] Move quickstart final handoff PID/log rows into a saved
  `.llmwiki-bridge-start/quickstart-handoff.md` summary and leave stdout with
  compact endpoint/operational sections.
- [x] Add TTY-only visible-screen quickstart transitions with selected-source
  context preserved on validation/start and stable non-TTY transcripts.
- [x] Redraw a compact `KBL / Knowledge Bridge Labs` logo block at the top of
  each focused interactive quickstart screen without repeating it in non-TTY
  logs.
- [x] Move interactive runtime setup from raw numeric text input to a guided
  single-select prompt while preserving non-interactive numeric/text aliases.
- [x] Add official-doc-backed Hermes/DeepAgents runtime installer plans with
  explicit approval, `--yes` safety, `--install-runtime`/`--no-install-runtime`
  flags, OS-specific allowlisting, fixed argv execution, installer logs, HTTPS
  final-URL enforcement, and minimal installer environment allowlisting.
- [x] Add runtime installer tests for OS allowlist, approved Hermes install
  recheck, `--yes` no-install default, fixed argv script execution, log writes,
  redirect safety, provider-secret env exclusion, and installer failure
  fallback.
- [x] Add opt-in DeepAgents ACP QuickStart wiring through
  `--runtime-adapter deepagents-acp`, background
  `LLMWIKI_AGENT_BRIDGE_RUNTIME_ADAPTER=deepagents-acp`, and running bridge
  `runtimeAdapter: "deepagents-acp"` settings updates while preserving the
  existing endpoint-input compatibility path and evidence-only fallback.
- [x] Reject selected ancestor/descendant source folders and duplicate
  manifest `source_id` values before source startup or bridge registration.
- [x] Add `status`/`ls` to reconcile local started-source config, live source
  health, and bridge registration state.
- [x] Gate delegated-runtime smoke on runtime reachability and explicitly label
  evidence-only smoke as not checking delegated runtime.
- [ ] Add Docker Compose/k3s-oriented onboarding docs after local CLI stabilizes.
- [x] Add GitHub Actions npm publish workflow for trusted publishing.
- [ ] Confirm npm registry trusted publisher setup before publishing.
