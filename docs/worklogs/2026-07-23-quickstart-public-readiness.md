# Quickstart Public Readiness Worklog

Date: 2026-07-23

## Summary

Prepared `llmwiki-bridge-start` for first public testing as a native-local AX
onboarding harness.

## Implemented

- Bare `llmwiki-bridge-start` now starts the guided quickstart flow.
- README Quick Start now leads with recommended first-run invocations:
  `--path ./wiki`, `--workspace`, and bare `npx`, while scriptable
  `discover`/`start`/`register`/`smoke` examples live in an
  advanced/scriptable section.
- Quick Start now defines the minimum successful onboarding outcome as a
  printed, healthy local source URL; bridge setup remains optional.
- Interactive terminals use checkbox-style multi-select for source selection.
- Piped, non-interactive, and `--yes` runs keep text/flag fallbacks.
- Candidate source paths are printed in full so users can identify the correct
  wiki folder before starting servers.
- Quickstart now prints the concrete scan root(s) before asking for discovery
  approval.
- Candidate selection rows now include source variant labels such as Native
  LLMWiki/OpenWiki, LLMWiki Markdown, Obsidian vault, Logseq graph, Dendron
  workspace, Foam workspace, Quartz source, or Generic Markdown.
- Discovery now distinguishes compiled Native LLMWiki/OpenWiki projections from
  source-like LLMWiki Markdown roots, while keeping generic Markdown capped
  below the default threshold.
- Frontmatter-only folders, docs-like hub plus typed folders, and `hot.md`
  plus index/overview alone no longer classify as Native unless graph,
  compiler, or projection metadata is present.
- Quickstart now keeps default source selection focused on recommended LLMWiki
  sources only. Advanced/lower-priority app vaults and noisy
  example/demo/starter/e2e candidates require `--include-additional`.
- Discovery is now treated as broad scriptable inventory for inspected
  directories. Parent/child overlaps stay visible when both candidates meet the
  score threshold; quickstart owns the recommended/advanced presentation
  policy.
- Quickstart now annotates hidden/additional candidates with reason categories:
  app vault, noisy path, or generic Markdown.
- Quickstart now labels non-recommended candidates as advanced/lower-priority
  rather than broadly compatible, reducing accidental selection pressure.
- Quickstart now explains the difference between Native LLMWiki/OpenWiki and
  LLMWiki Markdown in the selection step.
- Public docs now warn maintainers to redact full local paths before publishing
  screenshots, logs, docs, or issue examples.
- `all` in quickstart now means all currently listed candidates, not every
  discovered candidate hidden by the quickstart display policy.
- Strong direct child `wiki/` sources inside app vaults are recommended by
  default quickstart, while the parent app vault remains discoverable and moves
  to the advanced/lower-priority section. Weak child `wiki/` folders remain
  below the default discovery threshold.
- Noisy-path quickstart matching is token-based, so substring-only names do not
  get hidden accidentally.
- The non-interactive `all` selector is labeled as advanced only when
  advanced/lower-priority candidates are visible.
- Discovery asks before scanning the current user's home directory and explains
  how to constrain scope with `--path`, `--workspace`, or `--cwd`.
- Docs now emphasize that `--path DIR` constrains scanning to that directory
  tree, avoiding unrelated home/workspace sibling candidates.
- Source startup validates selected folders with `llmwiki-serve manifest`.
- Step 4 is now framed as `Optional bridge setup`, making the bridge decision
  explicit after source servers are healthy.
- Started source servers are marked ready only after `/health` responds.
- Windows `uv run` startup records the actual listening server PID separately
  from the runner PID when they differ.
- Optional `llmwiki-agent-bridge` setup remains explicit; direct source URLs are
  a successful quickstart outcome.
- Skip-bridge quickstart now prints one coding-agent MCP Streamable HTTP
  registration URL (`/mcp/stream`) per started source while avoiding
  client-specific config syntax. Extra source, health, manifest, and JSON-RPC
  URL blocks are intentionally omitted from the direct-source completion path.
- Quickstart now prefers a sibling `llmwiki-serve` checkout's `.venv`
  executable for long-running source server startup when present. This avoids
  using `uv run` as the detached server runner in the common local monorepo
  checkout path.
- Specs now keep the public-safety criterion that the CLI prints full local
  paths for disambiguation, and public screenshots, logs, docs, and issues
  should redact or replace them.
- Added npm Trusted Publishing workflow skeleton for future OIDC release.
- Follow-up on 2026-07-24: TTY quickstart yes/no prompts now route through an
  immediate keypress-capable confirm adapter, so pressing `y` or `n` completes
  the choice without Enter while still printing the `[choice]` transcript echo.
- Follow-up on 2026-07-24: discovery now has visible progress after approval:
  TTY runs get a heartbeat/progress line and non-TTY transcripts get clear
  start/completion status lines.
- Follow-up on 2026-07-24: the bridge step now explains what
  `llmwiki-agent-bridge` adds before asking, makes the setup question about one
  endpoint for selected sources, and clarifies that the background-start prompt
  runs the safe command detached, writes logs, and waits for bridge health.
- Follow-up on 2026-07-24: optional bridge setup now includes runtime setup
  before bridge start. Users can choose skip/evidence-only, Hermes, or
  DeepAgents. Explicit preconfigured endpoint flags remain a compatibility
  path, but generic/existing OpenAI-compatible endpoints are no longer shown as
  an interactive first-run menu option.
- Follow-up on 2026-07-24: Hermes and DeepAgents are treated as first-class
  `llmwiki-agent-bridge` runtime profiles. The current repo/bridge docs confirm
  profile names and example models but do not confirm a Hermes or DeepAgents
  runtime auto-install command, so quickstart prints safe install/start
  guidance and falls back to evidence-only if the endpoint is blank.
- Follow-up on 2026-07-24: when `llmwiki-agent-bridge` is already running,
  quickstart now applies entered runtime endpoint/model/profile fields through
  `/settings/config.json` before delegated-runtime smoke. The settings write
  sends only safe runtime fields and does not prompt for API keys or bridge
  bearer tokens.
- Follow-up on 2026-07-24: evidence-only/unconfigured bridge startup now
  scrubs inherited runtime/API-key environment variables before spawning the
  bridge child process, so a skipped runtime setup cannot accidentally inherit
  local model credentials.
- Follow-up on 2026-07-24: quickstart bridge registration now makes the newly
  started source IDs the active selected set. Merge mode still preserves
  unrelated registered sources, but stale selected sources are deselected so
  bridge fan-out matches the user's current quickstart selection.
- Follow-up on 2026-07-24: bridge background startup now uses `cross-spawn`
  for cross-platform command resolution instead of a hand-written Windows
  `cmd.exe` wrapper.
- Follow-up on 2026-07-24: onboarding expert verification found one
  release-relevant startup bug. When a requested source port was already
  occupied by an existing healthy service, quickstart could previously treat
  that pre-existing `/health` response as readiness for the newly requested
  source. Source startup now probes requested loopback ports before spawning,
  advances to the next available port when needed, records requested/assigned
  port metadata, and prints a concise fallback notice in quickstart.
- Follow-up on 2026-07-24: bridge registration copy now distinguishes total
  registered bridge sources from the source count selected by the current
  quickstart run. This preserves merge-mode registry behavior while reducing
  first-run confusion when an existing bridge has stale or unrelated sources.
- Follow-up on 2026-07-24: constrained quickstart discovery now asks users to
  find source folders under the shown root(s), while broad home scans keep the
  auto-discover wording. Successful bridge smoke now prints a final bridge
  handoff with base URL, `POST /message:send`, `POST /mcp`, and `/settings`.
- Follow-up on 2026-07-24: branch-by-branch expert evaluation onboarding
  fixes now make custom `--bridge http://host:port` manual-start guidance
  copy-paste safe by printing separate PowerShell and POSIX examples with
  `LLMWIKI_AGENT_BRIDGE_HOST` and `LLMWIKI_AGENT_BRIDGE_PORT` set to the
  requested bridge URL, plus configured runtime env when present. When users
  defer registration/smoke until after a manual bridge start, quickstart now
  prints the next `register` and `smoke` commands and keeps direct source MCP
  URLs visible meanwhile.
- Follow-up on 2026-07-24: quickstart now echoes selected source labels and
  full paths after selection, adds bounded parent/project context for repeated
  visible `wiki` basenames and `.llmwiki-work` paths, and prints compact
  operational details after direct-source and bridge handoffs.
- Follow-up on 2026-07-24: Hermes/DeepAgents endpoint prompts now state that
  blank Enter uses a shown default, while `skip` forces evidence-only; when no
  default is shown, blank Enter or `skip` continues evidence-only.
- Follow-up on 2026-07-24: runtime framework detection now follows documented
  framework checks instead of private machine environment aliases. Hermes
  install detection uses `hermes --version`, and Hermes endpoint defaults are
  accepted only after `/health` or `/v1/health` responds. DeepAgents Code
  install detection uses `dcode --version`; quickstart deliberately does not
  infer a bridge runtime endpoint from `dcode` config until a supported local
  endpoint discovery contract is documented.
- Follow-up on 2026-07-24: final quickstart handoffs now keep the screen
  focused on endpoints and next actions. PID/log rows move into the generated
  `.llmwiki-bridge-start/quickstart-handoff.md` summary, while stdout prints a
  compact Operational details section with the summary file reference and
  fallback compact details only if the file cannot be written.
- Follow-up on 2026-07-24: interactive TTY quickstart now uses the direct
  `sisteransi` dependency to clear only the visible terminal area between major
  decision screens. Non-TTY transcripts stay stable, scrollback is not cleared,
  `--no-clear-screen` and `LLMWIKI_BRIDGE_START_NO_CLEAR_SCREEN=1` opt out, and
  the validation/start screen reprints the selected source label and full path
  after the source-selection screen is cleared.
- Follow-up on 2026-07-24: interactive runtime setup now uses the existing
  `@clack/prompts` single-select UI instead of mixing Clack source-selection
  screens with a raw numeric readline prompt. Non-interactive and scripted
  runs still accept numeric/text aliases such as `2`, `hermes`, and blank
  default.
- Follow-up on 2026-07-24: interactive quickstart screens now redraw a compact
  boxed `KBL / Knowledge Bridge Labs` logo after each visible-screen
  transition, so each focused question/screen has clear product identity.
  Non-TTY and redirected transcripts keep only the initial banner.
- Release prep on 2026-07-28: target npm package version is
  `llmwiki-bridge-start@0.0.3`. The deterministic default bridge start package
  is now `llmwiki-agent-bridge@0.3.0`, matching the intended bridge release
  candidate that includes MCP lifecycle support. User-facing
  `llmwiki-bridge-start` examples continue to use `@latest` where they already
  describe installing the current harness package.

## Validation

- Docs-only onboarding update:
  - `git diff --check` passed; Git emitted CRLF normalization warnings only.
- `npm run check`
  - syntax checks passed
  - Node test suite passed with 63 tests
  - package dry-run passed
- Quickstart smoke:
  - bare `llmwiki-bridge-start` with `n` prints the concrete scan root and exits
    before discovery
  - bare `llmwiki-bridge-start` with `y`, then `q`, prints full candidate paths,
    variant labels, and exits before validation/start
- `npm audit --omit=dev`
  - no known vulnerabilities
- Local tarball smoke:
  - started a real `llmwiki-serve` source endpoint
  - verified `/health`
  - verified manifest for a 23-page / 23-approved-page knowledge artifact
  - verified recorded `processId` matched the actual listener process on the
    tested Windows `uv run` path
- GitHub `npx` smoke:
  - `npx.cmd --yes github:knowledge-bridge-labs/llmwiki-bridge-start`
  - verified candidate discovery output prints full paths without ellipses
- Local package `npx --package <checkout>` smoke:
  - bare no-subcommand invocation starts quickstart
  - home scan with `y`, then `q`, prints full paths and variant labels
  - broad home scan reduced noisy candidates from 13 to 9 after docs-like
    false-positive removal
  - default quickstart shows 3 recommended source folders and hides 6
    advanced/lower-priority candidates
  - `--include-additional` shows all 9 candidates split into Recommended and
    advanced/lower-priority sections
  - after app-vault child `wiki/` preference, default home quickstart shows 5
    recommended source folders and hides 4 advanced/lower-priority candidates
  - after discover/quickstart policy split, default home quickstart shows
    recommended child wiki sources while additional app/generic/noisy candidates
    stay hidden unless `--include-additional` is set
  - a targeted project scan with multiple local `wiki/` folders shows the two
    strong source-like `wiki/` roots as recommended candidates
  - a local source-like Markdown wiki is detected as `LLMWiki Markdown` and
    validates startable through `llmwiki-serve manifest`
  - a local docs-like folder is hidden at the default threshold
  - the first-run transcript now explains `llmwiki-*`, `llmwiki-serve`, and the
    optional `llmwiki-agent-bridge` before asking questions
  - yes/no prompts now echo explicit and defaulted choices, and the discovery
    prompt separates the question, scan-scope explanation, and `[Y/n]` marker
    onto separate lines
- Follow-up prompt/progress tests:
  - TTY yes/no confirm adapter and discovery heartbeat/progress path covered
    with mocks
  - non-TTY discovery progress start/completion transcript covered
  - bridge setup prompt copy and detached background-start explanation covered
  - Node test suite passed with 68 tests
- Follow-up runtime/cross-platform tests:
  - runtime setup choice flow covered for preconfigured endpoint compatibility
    and Hermes/DeepAgents guidance
  - endpoint/model/profile propagation into bridge start runtime options and
    delegated-runtime smoke covered
  - already-running bridge runtime configuration through `/settings/config.json`
    covered, including no API key/bearer-token fields
  - invalid runtime profiles rejected instead of being silently accepted
  - evidence-only skip disables inherited runtime env detection
  - evidence-only bridge startup scrubs inherited runtime/API-key env values
  - selected-ID registry override covered so stale selected sources do not
    remain active after quickstart merge registration
  - Windows `.cmd` bridge commands are passed directly to the cross-platform
    spawn adapter without a `cmd.exe` wrapper
  - targeted runtime/bridge/quickstart/env/register test subset passed with 76
    tests
  - `npm run check` passed with 76 Node tests plus package dry-run
- Follow-up onboarding expert loop:
  - Direct-source-only quickstart passed with an isolated local source and
    printed a direct `/mcp/stream` handoff.
  - Occupied-port regression passed: a deliberately occupied requested source
    port was skipped, the source started on the next available port, and config
    recorded the advanced URL.
  - Optional bridge evidence-only quickstart passed with isolated source and
    bridge ports; bridge registration and evidence-only smoke completed.
  - Main-agent post-fix smoke confirmed the final bridge handoff prints bridge
    base URL, `POST /message:send`, `POST /mcp`, and `/settings`.
  - `npm run check` passed with 79 Node tests plus package dry-run.
- Follow-up expert-evaluation onboarding fixes:
  - `node --check src/index.mjs` passed.
  - `node --check test/discover.test.mjs` passed.
  - `node --test test/discover.test.mjs` passed with 81 Node tests.
  - `npm run check` passed with 81 Node tests plus package dry-run.
- Follow-up progress/handoff UX polish:
  - Discovery now uses async external `fd`/`rg` execution and async-yielding
    fallback paths so a TTY timer spinner can update while scanning is running.
  - Source manifest validation now runs through the same async command path and
    shows a TTY progress indicator before validation completes.
  - Non-TTY transcripts keep stable `[run]`/`[ok]` progress lines for logs and
    automation.
  - Final bridge handoff is formatted as a grouped endpoint section instead of
    adjacent dense URL lines.
  - `npm run check` passed with 84 Node tests plus package dry-run.
- Follow-up runtime default hardening:
  - `HERMES_BASE_URL` is treated as a legacy/user-local compatibility alias,
    not as evidence that Hermes is installed or running.
  - Quickstart no longer uses `HERMES_BASE_URL`, `DEEPAGENTS_BASE_URL`, or
    `OPENAI_BASE_URL` as first-run runtime endpoint defaults.
  - Hermes runtime setup may offer a default only when an explicit
    `LLMWIKI_AGENT_BRIDGE_BASE_URL`/CLI endpoint passes Hermes health probing,
    or when the local default Hermes API server health endpoint responds.
  - DeepAgents remains endpoint-input driven because no equivalent
    OpenAI-compatible local endpoint discovery contract is currently recorded.
  - Runtime framework inspection now tests the documented install checks
    directly (`hermes --version`, `dcode --version`) and includes Hermes health
    probe coverage.
  - `npm run check` passed with 88 Node tests plus package dry-run.
- Follow-up final handoff UX cleanup:
  - Quickstart now follows the requested OpenClaw/NemoClaw-style pattern: keep
    the final screen focused on endpoint handoff, process summary, details-file
    reference, and next action.
  - Direct-source, deferred bridge, and successful bridge handoffs keep PID/log
    rows out of stdout and write full source/bridge PID, log path, URL, and stop
    guidance details to `.llmwiki-bridge-start/quickstart-handoff.md`.
  - Tests assert the compact stdout Operational details section and verify that
    saved summary files contain the process IDs/log paths.
  - `npm run check` passed with syntax checks, 88 Node tests, and package
    dry-run.
- Follow-up TTY screen transition dependency update:
  - `sisteransi` is now a direct runtime dependency instead of an implicit
    transitive dependency.
  - TTY transition tests cover visible-screen clear behavior, selected-source
    context preservation, no scrollback-clearing escape sequence, redirected
    stdout, non-TTY input, CLI option opt-out, and environment opt-out.
  - `npm test` passed with 92 Node tests.
  - `npm run check` passed with syntax checks, 92 Node tests, and package
    dry-run.
- Follow-up runtime setup select UI:
  - TTY/interactively forced runtime setup now calls the Clack single-select
    prompt and no longer prints the raw `Runtime setup options:` text block in
    that path.
  - Non-TTY/scripted runtime setup keeps the numeric/text fallback for
    automation compatibility.
  - Explicit `--runtime-setup skip|hermes|deepagents` bypasses the interactive
    runtime menu and uses the requested runtime choice directly.
  - Targeted runtime/screen transition tests passed.
  - `npm run check` passed with syntax checks, 94 Node tests, and package
    dry-run.
- Follow-up quickstart logo block:
  - First-run banner now uses a compact boxed `KBL / Knowledge Bridge Labs`
    logo with `llmwiki-bridge-start quickstart` and a
    `local knowledge ==[ bridge ]==> coding agents` bridge motif.
  - TTY screen transition tests assert the logo block is redrawn after each
    visible-screen clear, while redirected transcripts do not repeat it.
  - Targeted screen-transition tests passed.
  - `npm run check` passed with syntax checks, 94 Node tests, and package
    dry-run.
- Follow-up runtime installer approval gate:
  - This supersedes the earlier "guidance only" installer posture for the
    documented Hermes/DeepAgents CLI install paths while preserving explicit
    approval and evidence-only fallback.
  - QuickStart now has official-doc-backed runtime installer plans for Hermes
    and DeepAgents Code.
  - Runtime installers are offered only when the selected framework CLI is
    missing and an OS-supported plan exists. Interactive runs require explicit
    approval; `--yes` automation still requires `--install-runtime`, and
    `--no-install-runtime` disables installer prompts.
  - Installer execution downloads the official HTTPS installer script to
    `.llmwiki-bridge-start/logs`, runs it through fixed argv runner commands,
    verifies redirected installer URLs stay HTTPS, writes stdout/stderr logs,
    and passes only a minimal non-secret environment allowlist to the installer
    subprocess.
  - Hermes installation still does not configure API-server secrets or start
    `hermes gateway`; DeepAgents installation still does not imply a
    bridge-callable endpoint.
  - `npm test` passed with 103 Node tests.
- Release prep for `0.0.3`:
  - Package metadata is prepared for `llmwiki-bridge-start@0.0.3`.
  - Default bridge startup now uses
    `llmwiki-agent-bridge@0.3.0` instead of `0.2.1`.
  - This package should be published only after
    `llmwiki-agent-bridge@0.3.0` is available on npm.

## Commits

- `9e93e34` — Polish bridge start quickstart
- `121355a` — Add npm trusted publish workflow
- `2db8d53` — Align npm publish workflow with trusted publishing docs
- `1b54e90` — Show full quickstart candidate paths
- `335098e` — Clarify quickstart source selection
- `0536275` — Tighten quickstart source variant detection
- `0f7e3e5` — Focus quickstart default candidate selection
- `b8af0d1` — Prefer strong child wiki sources in app vaults
- `e6ecc3f` — Separate discover inventory from quickstart policy
- `b73c2c8` — Polish quickstart candidate guidance
- `94a6125` — Polish quickstart first-run transcript
- `613b134` — Add immediate quickstart prompts and progress
- `2ad3b87` — Add runtime onboarding to bridge quickstart
- `fd8176c` — Focus runtime quickstart on Hermes and DeepAgents
- `2abcece` — Select active quickstart sources on bridge register
- `d5b245c` — Harden quickstart onboarding flow
- `f6bb1eb` — Polish quickstart branch handoffs
- `6a572e5` — Add active quickstart progress spinners
- `7b7074b` — Harden quickstart runtime detection
- `4f1b723` — Compact quickstart final handoff
- `f99e47a` — Add TTY quickstart screen transitions
- `1d02315` — Use select UI for runtime quickstart
- `16d7d3b` — Add quickstart screen wordmark
- current — Use Knowledge Bridge Labs terminal logo
- current — Add runtime installer approval gate

## Follow-ups

- Confirm npm Trusted Publisher registration for
  `knowledge-bridge-labs/llmwiki-bridge-start` with workflow `publish.yml` and
  environment `npm`.
- Publish `llmwiki-agent-bridge@0.3.0` before releasing
  `llmwiki-bridge-start@0.0.3`, so the default `npx` bridge path resolves for
  users.
- Publish only after explicit owner approval for the exact package/version.
- Add public `llmwiki-docs` links after the npm release path is stable.
- Add Compose/k3s/Helm onboarding only after native local validation remains
  stable.
