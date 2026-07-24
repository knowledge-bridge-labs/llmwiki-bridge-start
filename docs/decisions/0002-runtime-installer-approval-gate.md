# 0002. Gate runtime CLI installers behind explicit approval

## Status

Accepted

## Context

`llmwiki-bridge-start` is an onboarding harness, not a model-runtime manager.
However, first-run bridge onboarding is incomplete when the selected runtime
framework is not installed. Hermes Agent and DeepAgents Code both publish
official CLI installer commands, but executing remote installers is a security
boundary and must not happen implicitly.

## Decision

QuickStart may offer runtime CLI installation for first-class runtime profiles
only when all conditions are true:

1. the user selected that runtime profile,
2. the runtime CLI is not already detected,
3. the current OS has a fixed install plan backed by official runtime docs,
4. the exact install command and docs URL are shown to the user,
5. the user explicitly approves installer execution.

`--yes` automation is not enough to approve runtime installation; scripted runs
must also pass `--install-runtime`. `--no-install-runtime` disables installer
prompts.

Installer execution downloads the official HTTPS installer script to
`.llmwiki-bridge-start/logs` and runs it with a fixed argv runner
(`bash <script>` or `powershell.exe -File <script>`). QuickStart writes
installer stdout/stderr to log files, verifies that the final redirected
installer URL is still HTTPS, and passes only a minimal non-secret environment
allowlist to the installer subprocess.

CLI installation does not mean runtime ownership. QuickStart does not write
Hermes API-server secrets, run `hermes setup --portal`, start `hermes gateway`,
configure DeepAgents provider credentials, run interactive `dcode` sessions or
provider setup commands, or infer a DeepAgents bridge runtime endpoint.

## Consequences

- First-run users can move past a missing runtime CLI without leaving the
  QuickStart flow.
- Automation remains safe because `--yes` alone does not run remote installers.
- Hermes can become a delegated-runtime bridge path only after a reachable
  Hermes API health endpoint is verified or explicitly entered.
- DeepAgents remains endpoint-input/evidence-only for bridge runtime use until
  an official bridge-callable endpoint discovery contract exists.

## Follow-ups

- Re-check official installer docs before each release that changes the
  installer allowlist.
- Add managed Hermes gateway setup only if a later spec defines credential,
  API-server, and lifecycle ownership boundaries.
- Add DeepAgents bridge-runtime integration only if official docs expose a
  supported local HTTP endpoint or health contract.

## References

- Hermes Agent install docs: https://hermes-agent.nousresearch.com/docs/
- Hermes API server setup notes: https://docs.openwebui.com/getting-started/quick-start/connect-an-agent/hermes-agent/
- DeepAgents Code quickstart: https://docs.langchain.com/oss/python/deepagents/code/quickstart
- DeepAgents Code providers: https://docs.langchain.com/oss/python/deepagents/code/providers
