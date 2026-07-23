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
- Step 4 is now framed as `Done: optionally add bridge`, making source-only
  success clear before bridge setup.
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
- pending — Polish quickstart first-run transcript
- pending — Improve customer onboarding flow

## Follow-ups

- Register npm Trusted Publisher for `knowledge-bridge-labs/llmwiki-bridge-start`
  with workflow `publish.yml` and environment `npm`.
- Publish only after explicit owner approval for the exact package/version.
- Add public `llmwiki-docs` links after the npm release path is stable.
- Add Compose/k3s/Helm onboarding only after native local validation remains
  stable.
