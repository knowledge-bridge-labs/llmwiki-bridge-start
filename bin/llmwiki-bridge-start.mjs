#!/usr/bin/env node

import { runCli } from '../src/index.mjs'

runCli(process.argv.slice(2)).catch((error) => {
  const message = error && typeof error.message === 'string' ? error.message : String(error)
  console.error(`llmwiki-bridge-start: ${message}`)
  process.exitCode = 1
})

