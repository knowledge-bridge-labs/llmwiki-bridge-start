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
- [ ] Add Docker Compose/k3s-oriented onboarding docs after local CLI stabilizes.
- [ ] Add release workflow and registry trusted publisher setup when ready to
  publish.
