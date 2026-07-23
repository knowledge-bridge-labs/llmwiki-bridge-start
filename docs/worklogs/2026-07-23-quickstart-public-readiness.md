# Quickstart Public Readiness Worklog

Date: 2026-07-23

## Summary

Prepared `llmwiki-bridge-start` for first public testing as a native-local AX
onboarding harness.

## Implemented

- Bare `llmwiki-bridge-start` now starts the guided quickstart flow.
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
  sources only. Compatible app vaults and noisy example/demo/starter/e2e
  candidates require `--include-additional`.
- `all` in quickstart now means all currently listed candidates, not every
  discovered candidate hidden by the quickstart display policy.
- Discovery now prefers strong direct child `wiki/` sources inside app vaults
  over the parent app vault, while weak child `wiki/` folders remain suppressed.
- The non-interactive `all` selector is labeled as advanced to reduce accidental
  broad source startup.
- Discovery asks before scanning the current user's home directory and explains
  how to constrain scope with `--path`, `--workspace`, or `--cwd`.
- Source startup validates selected folders with `llmwiki-serve manifest`.
- Started source servers are marked ready only after `/health` responds.
- Windows `uv run` startup records the actual listening server PID separately
  from the runner PID when they differ.
- Optional `llmwiki-agent-bridge` setup remains explicit; direct source URLs are
  a successful quickstart outcome.
- Added npm Trusted Publishing workflow skeleton for future OIDC release.

## Validation

- `npm run check`
  - syntax checks passed
  - Node test suite passed with 54 tests
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
    additional compatible candidates
  - `--include-additional` shows all 9 candidates split into Recommended and
    Additional sections
  - after app-vault child `wiki/` preference, default home quickstart shows 5
    recommended source folders and hides 4 additional compatible candidates
  - a targeted project scan with multiple local `wiki/` folders shows the two
    strong source-like `wiki/` roots as recommended candidates
  - a local source-like Markdown wiki is detected as `LLMWiki Markdown` and
    validates startable through `llmwiki-serve manifest`
  - a local docs-like folder is hidden at the default threshold

## Commits

- `9e93e34` — Polish bridge start quickstart
- `121355a` — Add npm trusted publish workflow
- `2db8d53` — Align npm publish workflow with trusted publishing docs
- `1b54e90` — Show full quickstart candidate paths
- `335098e` — Clarify quickstart source selection
- `0536275` — Tighten quickstart source variant detection
- `0f7e3e5` — Focus quickstart default candidate selection
- pending — Prefer strong child wiki sources in app vaults

## Follow-ups

- Register npm Trusted Publisher for `knowledge-bridge-labs/llmwiki-bridge-start`
  with workflow `publish.yml` and environment `npm`.
- Publish only after explicit owner approval for the exact package/version.
- Add public `llmwiki-docs` links after the npm release path is stable.
- Add Compose/k3s/Helm onboarding only after native local validation remains
  stable.
