# llmwiki-bridge-start

Local adoption harness for connecting pre-built LLMWiki/OpenWiki knowledge
artifacts to `llmwiki-serve`, `llmwiki-agent-bridge`, and coding-agent clients.

This package does not compile or ingest knowledge. It discovers existing wiki
folders, validates that `llmwiki-serve` can read them, starts loopback source
servers when requested, registers those sources with a local bridge, and runs
evidence-only smoke checks.

## Quick Prototype

```bash
npx llmwiki-bridge-start@latest discover --home
npx llmwiki-bridge-start@latest discover --path . --validate
npx llmwiki-bridge-start@latest start --path .llmwiki-work/knowledge-bridge-labs-wiki --port 11001
npx llmwiki-bridge-start@latest register --bridge http://127.0.0.1:8788 --config .llmwiki-bridge-start/sources.json
npx llmwiki-bridge-start@latest smoke --bridge http://127.0.0.1:8788
```

Default discovery scans the user home directory unless `--path`, `--cwd`, or
`--workspace` is supplied. The scanner skips dependency, cache, build, generated
smoke, and OS folders, scores likely wiki roots, removes obvious child-folder
duplicates, and optionally validates candidates with `llmwiki-serve manifest`.
The default minimum score is `30`; use `--min-score 10` when intentionally
looking for plain Markdown folders.

## Commands

| Command | Purpose |
| --- | --- |
| `discover` | Find local LLMWiki/Obsidian/Logseq/Foam/Dendron/Quartz/generic Markdown candidates. |
| `start` | Start `llmwiki-serve` on one or more selected local wiki paths. |
| `register` | Upsert started or existing source URLs into `llmwiki-agent-bridge`. Use `--replace` only when intentionally replacing the registry. |
| `smoke` | Run an evidence-only bridge smoke request. |
| `doctor` | Check local prerequisites and optional bridge reachability. |

## Boundary

`llmwiki-bridge-start` is an onboarding/adoption harness. It is not a wiki
compiler, crawler, model runtime, Redis manager, production auth layer, or
replacement for `llmwiki-agent-bridge`.
