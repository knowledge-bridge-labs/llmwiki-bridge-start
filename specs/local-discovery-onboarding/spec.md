# Local Discovery Onboarding

## Problem

AX users often already have one or more local knowledge artifacts, but they need
a low-friction way to find usable LLMWiki-compatible folders, start
`llmwiki-serve`, connect sources to `llmwiki-agent-bridge`, and verify that a
coding-agent client can retrieve evidence.

## Goals

- Discover likely local source roots for LLMWiki/OpenWiki projections and common
  Markdown knowledge tools.
- Prefer useful source boundaries over internal fixture, cache, build, and
  generated workspace folders.
- Validate candidates through `llmwiki-serve manifest` when requested.
- Start selected local sources on loopback ports.
- Upsert sources into an existing bridge registry without deleting unrelated
  sources.
- Run an evidence-only smoke query against the bridge.

## Non-goals

- Compiling repositories into knowledge graphs.
- Managing model runtimes, Redis, auth, TLS, Docker, or Kubernetes.
- Replacing `llmwiki-agent-bridge` orchestration.
- Treating generated local work folders as canonical project docs.

## Requirements

- The CLI must work without runtime dependencies beyond Node and
  `llmwiki-serve`.
- `discover` must be safe enough to run from a home directory by default.
- `register` must merge by default and require explicit `--replace` to wipe the
  bridge registry.
- Source URLs with credentials or unsupported schemes must be rejected.
- Tests must cover scoring, duplicate suppression, generated-folder filtering,
  and registry merge safety.
