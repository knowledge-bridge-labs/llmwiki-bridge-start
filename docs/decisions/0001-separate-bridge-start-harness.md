# 0001. Keep onboarding in a separate bridge-start harness

## Status

Accepted

## Context

`llmwiki-serve` owns source serving, and `llmwiki-agent-bridge` owns bridge
orchestration for coding-agent clients. First-run adoption needs extra workflow:
finding local candidates, starting local servers, registering sources, and
running smoke checks. Putting that workflow into serve or bridge would blur
runtime responsibilities.

## Decision

Create `llmwiki-bridge-start` as a separate onboarding harness. It may call
`llmwiki-serve` and `llmwiki-agent-bridge`, but it does not compile knowledge,
own retrieval orchestration, manage model runtime, or become the production
deployment layer.

The default path is local AX onboarding:

1. discover likely local source roots,
2. validate selected candidates,
3. start loopback source servers,
4. merge sources into a bridge registry,
5. run an evidence-only bridge smoke check.

## Consequences

- Existing modules keep narrower responsibilities.
- UX iteration can happen independently from bridge/runtime internals.
- Production/team deployment support can be added later as templates or docs
  without forcing Docker/Kubernetes concerns into core packages.

## Follow-ups

- Add an interactive first-run flow.
- Add compose/k3s templates only after local CLI behavior is stable.
- Decide whether app-root preference should be configurable per adapter.
