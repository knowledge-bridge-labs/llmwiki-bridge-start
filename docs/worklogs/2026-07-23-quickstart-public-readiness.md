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
  - Node test suite passed with 36 tests
  - package dry-run passed
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

## Commits

- `9e93e34` — Polish bridge start quickstart
- `121355a` — Add npm trusted publish workflow
- `2db8d53` — Align npm publish workflow with trusted publishing docs
- `1b54e90` — Show full quickstart candidate paths

## Follow-ups

- Register npm Trusted Publisher for `knowledge-bridge-labs/llmwiki-bridge-start`
  with workflow `publish.yml` and environment `npm`.
- Publish only after explicit owner approval for the exact package/version.
- Add public `llmwiki-docs` links after the npm release path is stable.
- Add Compose/k3s/Helm onboarding only after native local validation remains
  stable.
