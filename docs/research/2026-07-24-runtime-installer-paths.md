# Runtime installer paths for QuickStart

Date: 2026-07-24

## Scope

This note records the official runtime installer paths used by
`llmwiki-bridge-start` QuickStart. It intentionally covers CLI installation
only. Credential setup, long-running gateway/service management, and provider
auth remain outside the current harness boundary.

## Hermes Agent

Official docs list:

- Linux / macOS / WSL2 / Termux: `curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash`
- Native Windows PowerShell: `iex (irm https://hermes-agent.nousresearch.com/install.ps1)`
- After install, run `hermes setup --portal`.

For bridge runtime use, Hermes must expose an OpenAI-compatible API server.
The documented gateway path uses `hermes gateway`, default host
`127.0.0.1`, default port `8642`, and health at `http://127.0.0.1:8642/health`.

QuickStart implementation choice:

- Show the official command and docs URL.
- After approval, download the same HTTPS installer script to the QuickStart
  log directory and execute it through fixed argv:
  - POSIX/WSL: `bash <downloaded-script>`
  - Windows: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <downloaded-script>`
- Do not run `hermes setup --portal`, write API-server secrets, or start
  `hermes gateway`.
- Only offer a Hermes endpoint default after `/health` or `/v1/health`
  responds, or after explicit CLI flags configure the endpoint.

## DeepAgents Code

Official docs list:

- Linux / macOS: `curl -LsSf https://langch.in/dcode | bash`
- Windows: not officially supported natively; use WSL if desired.
- Provider setup happens through `/auth`, `dcode auth set`, provider
  environment variables, and optional `dcode --install <provider-extra>`.

QuickStart implementation choice:

- Offer automatic CLI installer execution only on Linux/macOS platforms; WSL is
  covered by the Linux path.
- On native Windows, print guidance rather than installing.
- Do not run interactive `dcode` sessions, configure provider credentials, or
  run `dcode --install <extra>`. Safe diagnostics such as `dcode --version`,
  `dcode doctor`, and secret-redacted config inspection remain allowed.
- Do not infer a bridge runtime endpoint from `dcode config`, DeepAgents env
  aliases, or provider config. DeepAgents remains endpoint-input/evidence-only
  for bridge delegated-runtime until an official local HTTP endpoint contract is
  documented.

## References

- https://hermes-agent.nousresearch.com/docs/
- https://docs.openwebui.com/getting-started/quick-start/connect-an-agent/hermes-agent/
- https://docs.langchain.com/oss/python/deepagents/code/quickstart
- https://docs.langchain.com/oss/python/deepagents/code/providers
