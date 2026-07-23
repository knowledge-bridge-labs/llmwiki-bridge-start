import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { test } from 'node:test'

import { detectLlmRuntime, discoverCandidates, mergeBridgeSources, parseArgs, parseCandidateSelection, parseYesNo, quickstart, registerSources, runCli, scanCandidateDirectories, scoreCandidate, selectBridgeSmokeMode, smokeBridge, startSources } from '../src/index.mjs'

test('parseArgs collects repeated options', () => {
  const parsed = parseArgs(['discover', '--path', 'a', '--path', 'b', '--validate'])
  assert.equal(parsed.command, 'discover')
  assert.deepEqual(parsed.options.path, ['a', 'b'])
  assert.equal(parsed.options.validate, true)
})

test('runCli starts quickstart when no subcommand is provided', async () => {
  const stdout = captureWritable()
  const prompts = []
  await runCli([], {
    stdout,
    stderr: stdout,
    async prompt(question, fallback) {
      prompts.push({ question, fallback })
      return 'n'
    },
  })

  assert(stdout.text.includes('llmwiki-bridge-start quickstart'))
  assert(stdout.text.includes('[1/5] Discover sources'))
  assert(stdout.text.includes('[info] Will scan these root folder(s):'))
  assert(stdout.text.includes(homedir()))
  assert(stdout.text.includes('[skip] Skipped discovery.'))
  assert(stdout.text.includes('Skipped discovery.'))
  assert.equal(prompts.length, 1)
  assert.match(prompts[0].question, /Auto-discover/)
  assert.match(prompts[0].question, /current user's home/)
})

test('runCli keeps explicit quickstart available', async () => {
  const stdout = captureWritable()
  const prompts = []
  await runCli(['quickstart'], {
    stdout,
    stderr: stdout,
    async prompt(question, fallback) {
      prompts.push({ question, fallback })
      return 'n'
    },
  })

  assert(stdout.text.includes('llmwiki-bridge-start quickstart'))
  assert(stdout.text.includes('[1/5] Discover sources'))
  assert(stdout.text.includes('[info] Will scan these root folder(s):'))
  assert(stdout.text.includes(homedir()))
  assert(stdout.text.includes('[skip] Skipped discovery.'))
  assert(stdout.text.includes('Skipped discovery.'))
  assert.equal(prompts.length, 1)
  assert.match(prompts[0].question, /Auto-discover/)
  assert.match(prompts[0].question, /current user's home/)
})

test('quickstart reprompts invalid yes/no answers in interactive prompt fallback', async () => {
  const stdout = captureWritable()
  const answers = ['maybe', 'n']

  await quickstart(
    {},
    {
      stdout,
      stderr: stdout,
      async prompt() {
        return answers.shift()
      },
    },
    {
      resolveServeInvocation() {
        return { command: 'mock-serve', baseArgs: [], cwd: process.cwd() }
      },
    },
  )

  assert.match(stdout.text, /Expected yes or no/)
  assert.match(stdout.text, /Enter "y" or "n"/)
  assert.match(stdout.text, /\[skip\] Skipped discovery/)
})

test('runCli keeps explicit discover as the scriptable listing command', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-runcli-discover-'))
  mkdirSync(join(root, 'concepts'))
  writeFileSync(join(root, 'index.md'), '---\nwiki_title: Run CLI Wiki\nreview_state: approved\nsource_refs: [SRC]\n---\n# Run CLI Wiki\n')
  writeFileSync(join(root, 'hot.md'), '# Hot\n')
  writeFileSync(join(root, 'concepts', 'topic.md'), '# Topic\n')

  const stdout = captureWritable()
  await runCli(['discover', '--path', root, '--json'], {
    stdout,
    stderr: captureWritable(),
    async prompt() {
      throw new Error('discover should not prompt')
    },
  })

  const result = JSON.parse(stdout.text)
  assert.equal(result.roots[0], root)
  assert(result.candidates.some((candidate) => candidate.path === root))
  assert(result.candidates.find((candidate) => candidate.path === root).signals.includes('llmwiki-root:hot+index-or-overview'))
})

test('runCli discover keeps detailed candidate format', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-runcli-discover-format-'))
  mkdirSync(join(root, 'concepts'))
  writeFileSync(join(root, 'index.md'), '---\nwiki_title: Detailed Wiki\nreview_state: approved\nsource_refs: [SRC]\n---\n# Detailed Wiki\n')
  writeFileSync(join(root, 'hot.md'), '# Hot\n')
  writeFileSync(join(root, 'concepts', 'topic.md'), '# Topic\n')

  const stdout = captureWritable()
  await runCli(['discover', '--path', root], {
    stdout,
    stderr: captureWritable(),
    async prompt() {
      throw new Error('discover should not prompt')
    },
  })

  assert.match(stdout.text, /confidence:/)
  assert.match(stdout.text, /variant: Native LLMWiki\/OpenWiki/)
  assert.match(stdout.text, /pages:/)
  assert.match(stdout.text, /signals:/)
  assert.doesNotMatch(stdout.text, /all\) start all listed candidates/)
})

test('discover validation reports actionable llmwiki-serve invocation failures', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-missing-serve-'))
  mkdirSync(join(root, 'concepts'))
  writeFileSync(join(root, 'index.md'), '---\nwiki_title: Missing Serve Wiki\nreview_state: approved\nsource_refs: [SRC]\n---\n# Missing Serve Wiki\n')
  writeFileSync(join(root, 'hot.md'), '# Hot\n')
  writeFileSync(join(root, 'concepts', 'topic.md'), '# Topic\n')

  const result = await discoverCandidates({
    roots: [root],
    validate: true,
    serveInvocation: {
      command: 'definitely-missing-llmwiki-serve-command',
      baseArgs: [],
      cwd: process.cwd(),
    },
  })

  const candidate = result.candidates.find((entry) => entry.path === root)
  assert(candidate)
  assert.equal(candidate.startable, false)
  assert.match(candidate.validationError, /Could not run llmwiki-serve command/)
  assert.match(candidate.validationError, /--serve-command/)
})

test('parseCandidateSelection supports defaults, lists, all, cancel, and bounds checks', () => {
  const candidates = [
    { rank: 1, path: 'one' },
    { rank: 2, path: 'two' },
    { rank: 3, path: 'three' },
  ]

  assert.deepEqual(parseCandidateSelection('', candidates).map((candidate) => candidate.path), ['one'])
  assert.deepEqual(parseCandidateSelection('2, 3 2', candidates).map((candidate) => candidate.path), ['two', 'three'])
  assert.deepEqual(parseCandidateSelection('all', candidates).map((candidate) => candidate.path), ['one', 'two', 'three'])
  assert.deepEqual(parseCandidateSelection('q', candidates), [])
  assert.throws(() => parseCandidateSelection('2x', candidates), /Invalid candidate selection/)
  assert.throws(() => parseCandidateSelection('4', candidates), /out of range/)
})

test('parseYesNo handles defaulted and explicit answers', () => {
  assert.equal(parseYesNo('', true), true)
  assert.equal(parseYesNo('', false), false)
  assert.equal(parseYesNo('yes'), true)
  assert.equal(parseYesNo('n'), false)
  assert.throws(() => parseYesNo('maybe'), /Expected yes or no/)
})

test('startSources waits for source /health before marking a source ready', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-start-ready-'))
  const source = join(root, 'wiki')
  mkdirSync(source)
  const serveScript = writeServeStubScript(root)
  const configPath = join(root, 'sources.json')
  const port = await freePort()

  const result = await startSources({
    paths: [source],
    portStart: port,
    serveInvocation: { command: process.execPath, baseArgs: [serveScript], cwd: root },
    configPath,
    logDir: join(root, 'logs'),
    healthTimeoutMs: 2000,
    healthIntervalMs: 50,
  })

  const pid = result.sources[0].processId
  t.after(() => {
    killPid(pid)
  })

  assert.equal(result.sources[0].status, 'ready')
  assert.equal(result.sources[0].health.ok, true)
  assert.equal(result.sources[0].url, `http://127.0.0.1:${port}`)
  const health = await fetch(`http://127.0.0.1:${port}/health`)
  assert.equal(health.status, 200)
  assert.equal((await health.json()).status, 'ok')

  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  assert.equal(config.sources[0].status, 'ready')
  assert.equal(config.sources[0].health.ok, true)
})

test('startSources cleans up a spawned source when /health never becomes ready', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-start-unhealthy-'))
  const source = join(root, 'wiki')
  mkdirSync(source)
  const pidFile = join(root, 'serve.pid')
  const serveScript = writeServeStubScript(root, { neverHealthy: true, pidFile })
  const port = await freePort()

  await assert.rejects(
    () => startSources({
      paths: [source],
      portStart: port,
      serveInvocation: { command: process.execPath, baseArgs: [serveScript], cwd: root },
      configPath: join(root, 'sources.json'),
      logDir: join(root, 'logs'),
      healthTimeoutMs: 300,
      healthIntervalMs: 50,
    }),
    /Source server did not become healthy/,
  )

  const pid = Number(readFileSync(pidFile, 'utf8'))
  t.after(() => {
    killPid(pid)
  })
  await waitForProcessExit(pid, 3000)
  assert.equal(isProcessAlive(pid), false)
})

test('quickstart can end after starting direct local source URLs without bridge setup', async () => {
  const calls = []
  const stdout = captureWritable()
  const answers = ['y', '2x', '2', 'y', 'n']
  const io = {
    stdout,
    stderr: stdout,
    async prompt() {
      return answers.shift()
    },
  }
  const candidates = [
    { rank: 1, path: 'first-wiki', score: 80, confidence: 'high', markdownCount: 20, signals: ['llmwiki-root:hot+index-or-overview', 'llmwiki-typed-dir', 'frontmatter:source_refs'] },
    { rank: 2, path: 'second-wiki', score: 70, confidence: 'high', markdownCount: 10, signals: ['obsidian:.obsidian'] },
  ]

  const result = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788' },
    io,
    {
      resolveServeInvocation() {
        return { command: 'mock-serve', baseArgs: [], cwd: process.cwd() }
      },
      async discoverCandidates(args) {
        calls.push(['discover', args])
        return { roots: args.roots, count: candidates.length, minScore: args.minScore, candidates }
      },
      async validateCandidate(candidate) {
        calls.push(['validate', candidate.path])
        return {
          ...candidate,
          startable: true,
          manifest: {
            title: candidate.path,
            source_id: candidate.path,
            page_count: 3,
            approved_page_count: 3,
          },
        }
      },
      async startSources(args) {
        calls.push(['start', args])
        return {
          configPath: args.configPath,
          sources: [{
            id: 'second-wiki',
            name: 'second-wiki',
            title: 'second-wiki',
            protocol: 'llmwiki-http',
            status: 'ready',
            selected: true,
            url: 'http://127.0.0.1:11001',
          }],
        }
      },
      async registerSources(args) {
        calls.push(['register', args])
        return {
          bridgeUrl: args.bridgeUrl,
          replace: args.replace,
          payload: { sources: [{ id: 'second-wiki', url: 'http://127.0.0.1:11001' }] },
          response: { ok: true },
        }
      },
      async smokeBridge(args) {
        calls.push(['smoke', args])
        return { bridgeUrl: args.bridgeUrl, status: { state: 'completed' }, text: '' }
      },
    },
  )

  assert.equal(calls[0][0], 'discover')
  assert.equal(calls[0][1].validate, false)
  assert.deepEqual(calls.filter((call) => call[0] === 'validate'), [['validate', 'second-wiki']])
  assert.deepEqual(calls.find((call) => call[0] === 'start')[1].paths, ['second-wiki'])
  assert.equal(calls.some((call) => call[0] === 'register'), false)
  assert.equal(calls.some((call) => call[0] === 'smoke'), false)
  assert.deepEqual(result.sourceUrls, ['http://127.0.0.1:11001'])
  assert.deepEqual(result.skipped, ['bridge-setup', 'register', 'smoke'])
  assert.match(io.stdout.text, /\[2\/5\] Choose source folders/)
  assert.match(io.stdout.text, /  1\) first-wiki \[Native LLMWiki\/OpenWiki\] \(high\/80, 20 md\)/)
  assert.match(io.stdout.text, /  2\) second-wiki \[Obsidian vault\] \(high\/70, 10 md\)/)
  assert.doesNotMatch(io.stdout.text, /signals:/)
  assert.match(io.stdout.text, /Invalid candidate selection/)
  assert.match(io.stdout.text, /Validation runs only if you start selected sources/)
  assert.match(io.stdout.text, /source URLs directly/)
})

test('quickstart renders pipe-friendly non-TTY prompts without color', async () => {
  const stdout = captureWritable()
  const stdin = Readable.from(['n\n'])

  await quickstart(
    {},
    { stdin, stdout, stderr: stdout },
    {
      resolveServeInvocation() {
        return { command: 'mock-serve', baseArgs: [], cwd: process.cwd() }
      },
    },
  )

  assert.match(stdout.text, /\[\?\] Auto-discover local LLMWiki\/knowledge source folders\? Default discovery scans the current user's home unless --path\/--workspace\/--cwd constrains it\. \[Y\/n\]:\n/)
  assert.doesNotMatch(stdout.text, /\u001b\[/)
})

test('quickstart non-TTY text fallback fails invalid candidate input without reprompting forever', async () => {
  const stdout = captureWritable()
  const stdin = Readable.from(['y\n2x\n'])
  const longPath = join(
    mkdtempSync(join(tmpdir(), 'llmwiki-quickstart-full-path-fallback-')),
    'nested-source-candidates',
    'with-an-extra-long-visible-parent-folder-name-for-selection',
    'first-wiki',
  )
  const candidates = [
    { rank: 1, path: longPath, score: 80, confidence: 'high', markdownCount: 20, signals: ['llmwiki-root:hot+index-or-overview', 'llmwiki-typed-dir', 'frontmatter:source_refs'] },
  ]

  await assert.rejects(
    () => quickstart(
      { path: '.' },
      { stdin, stdout, stderr: stdout },
      {
        resolveServeInvocation() {
          return { command: 'mock-serve', baseArgs: [], cwd: process.cwd() }
        },
        async discoverCandidates(args) {
          return { roots: args.roots, count: candidates.length, minScore: args.minScore, candidates }
        },
      },
    ),
    /Invalid candidate selection/,
  )

  assert.match(stdout.text, /  1\) first-wiki \[Native LLMWiki\/OpenWiki\] \(high\/80, 20 md\)/)
  assert(stdout.text.includes(longPath))
  assert(!stdout.text.includes(`${longPath.slice(0, 93)}...`))
  assert.doesNotMatch(stdout.text, /Enter candidate ranks/)
})

test('quickstart uses clack multiselect for TTY candidate selection', async (t) => {
  const previousNoColor = process.env.NO_COLOR
  process.env.NO_COLOR = '1'
  t.after(() => {
    if (previousNoColor === undefined) {
      delete process.env.NO_COLOR
    } else {
      process.env.NO_COLOR = previousNoColor
    }
  })

  const calls = []
  const stdout = captureWritable()
  const answers = ['y', 'y', 'n']
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-quickstart-full-path-clack-'))
  const firstPath = join(
    root,
    'nested-source-candidates',
    'with-an-extra-long-visible-parent-folder-name-for-selection',
    'first-wiki',
  )
  const secondPath = join(
    root,
    'nested-source-candidates',
    'with-another-extra-long-visible-parent-folder-name-for-selection',
    'second-wiki',
  )

  const candidates = [
    { rank: 1, path: firstPath, score: 80, confidence: 'high', markdownCount: 20, signals: ['llmwiki-root:hot+index-or-overview', 'llmwiki-typed-dir', 'frontmatter:source_refs'] },
    { rank: 2, path: secondPath, score: 70, confidence: 'high', markdownCount: 10, signals: ['obsidian:.obsidian'] },
  ]

  const result = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788' },
    {
      stdout,
      stderr: stdout,
      forceInteractiveCandidateSelection: true,
      async prompt() {
        return answers.shift()
      },
      clackPrompts: {
        async multiselect(params) {
          calls.push(['multiselect', params])
          return [2]
        },
        isCancel(value) {
          return value === Symbol.for('cancelled')
        },
        cancel(message) {
          calls.push(['cancel', message])
        },
      },
    },
    {
      resolveServeInvocation() {
        return { command: 'mock-serve', baseArgs: [], cwd: process.cwd() }
      },
      async discoverCandidates(args) {
        calls.push(['discover', args])
        return { roots: args.roots, count: candidates.length, minScore: args.minScore, candidates }
      },
      async validateCandidate(candidate) {
        calls.push(['validate', candidate.path])
        return {
          ...candidate,
          startable: true,
          manifest: {
            title: candidate.path,
            source_id: candidate.path,
            page_count: 3,
            approved_page_count: 3,
          },
        }
      },
      async startSources(args) {
        calls.push(['start', args])
        return {
          configPath: args.configPath,
          sources: [{
            id: 'second-wiki',
            title: 'second-wiki',
            protocol: 'llmwiki-http',
            status: 'ready',
            selected: true,
            url: 'http://127.0.0.1:11001',
          }],
        }
      },
    },
  )

  const multiselectCall = calls.find((call) => call[0] === 'multiselect')
  assert(multiselectCall)
  assert.equal(multiselectCall[1].message, 'Select source folders to start')
  assert.deepEqual(multiselectCall[1].initialValues, [1])
  assert.deepEqual(multiselectCall[1].options.map((option) => option.value), [1, 2])
  assert.equal(multiselectCall[1].options[0].label, '1) first-wiki [Native LLMWiki/OpenWiki]')
  assert.equal(multiselectCall[1].options[1].label, '2) second-wiki [Obsidian vault]')
  assert(multiselectCall[1].options[0].hint.includes(firstPath))
  assert(multiselectCall[1].options[1].hint.includes(secondPath))
  assert(!multiselectCall[1].options[0].hint.includes('...'))
  assert(!multiselectCall[1].options[1].hint.includes('...'))
  assert.deepEqual(calls.filter((call) => call[0] === 'validate'), [['validate', secondPath]])
  assert.deepEqual(calls.find((call) => call[0] === 'start')[1].paths, [secondPath])
  assert.deepEqual(result.sourceUrls, ['http://127.0.0.1:11001'])
  assert.match(stdout.text, /  1\) first-wiki \[Native LLMWiki\/OpenWiki\] \(high\/80, 20 md\)/)
  assert(stdout.text.includes(firstPath))
  assert(stdout.text.includes(secondPath))
  assert(!stdout.text.includes(`${firstPath.slice(0, 93)}...`))
  assert(!stdout.text.includes(`${secondPath.slice(0, 93)}...`))
  assert.match(stdout.text, /\[4\/5\] Optional bridge setup/)
  assert.deepEqual(result.skipped, ['bridge-setup', 'register', 'smoke'])
})

test('quickstart generates bridge setup command without executing it and runs delegated smoke when configured', async () => {
  const calls = []
  const stdout = captureWritable()
  const answers = ['y', '1', 'y', 'y', 'n', 'y']
  const result = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788', 'llm-endpoint': 'http://127.0.0.1:8642/v1' },
    {
      stdout,
      stderr: stdout,
      async prompt() {
        return answers.shift()
      },
    },
    {
      resolveServeInvocation() {
        return { command: 'mock-serve', baseArgs: [], cwd: process.cwd() }
      },
      async discoverCandidates(args) {
        calls.push(['discover', args])
        return {
          roots: args.roots,
          count: 1,
          minScore: args.minScore,
          candidates: [{ rank: 1, path: 'first-wiki', score: 80, confidence: 'high', markdownCount: 20, signals: ['llmwiki-root:hot+index-or-overview', 'llmwiki-typed-dir', 'frontmatter:source_refs'] }],
        }
      },
      async validateCandidate(candidate) {
        calls.push(['validate', candidate.path])
        return { ...candidate, startable: true, manifest: { title: 'First Wiki', source_id: 'first-wiki', page_count: 3, approved_page_count: 3 } }
      },
      async startSources(args) {
        calls.push(['start', args])
        return {
          configPath: args.configPath,
          sources: [{ id: 'first-wiki', title: 'First Wiki', protocol: 'llmwiki-http', status: 'ready', selected: true, url: 'http://127.0.0.1:11001' }],
        }
      },
      async checkBridgeHealth(bridgeUrl) {
        calls.push(['bridge-health', bridgeUrl])
        return { ok: false, error: 'connection refused', url: bridgeUrl }
      },
      bridgeStartPlan(args) {
        calls.push(['bridge-plan', args])
        return {
          command: 'npx',
          args: ['--yes', 'llmwiki-agent-bridge@0.1.0'],
          packageName: 'llmwiki-agent-bridge@0.1.0',
        }
      },
      async startBridgeCommand(args) {
        calls.push(['bridge-start', args])
        throw new Error('bridge command should not run in this test')
      },
      async registerSources(args) {
        calls.push(['register', args])
        return {
          bridgeUrl: args.bridgeUrl,
          replace: args.replace,
          payload: { sources: [{ id: 'first-wiki', url: 'http://127.0.0.1:11001' }] },
          response: { ok: true },
        }
      },
      async smokeBridge(args) {
        calls.push(['smoke', args])
        return { bridgeUrl: args.bridgeUrl, mode: args.mode, status: { state: 'completed' }, text: '' }
      },
    },
  )

  assert.deepEqual(calls.map((call) => call[0]), ['discover', 'validate', 'start', 'bridge-health', 'bridge-plan', 'register', 'smoke'])
  assert.equal(calls.find((call) => call[0] === 'register')[1].replace, false)
  assert.equal(calls.find((call) => call[0] === 'smoke')[1].mode, 'delegated-runtime')
  assert.equal(result.smokeMode, 'delegated-runtime')
  assert.deepEqual(result.skipped, [])
  assert.equal(result.bridgeSetup.executed, false)
  assert.match(stdout.text, /\[4\/5\] Optional bridge setup/)
  assert.match(stdout.text, /\[5\/5\] Register and smoke test/)
  assert.match(stdout.text, /Safe start command/)
  assert.match(stdout.text, /no global install/)
})

test('quickstart labels requested hybrid bridge smoke mode as hybrid', async () => {
  const calls = []
  const stdout = captureWritable()
  const answers = ['y', '1', 'y', 'y']

  const result = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788', mode: 'hybrid' },
    {
      stdout,
      stderr: stdout,
      async prompt() {
        return answers.shift()
      },
    },
    {
      resolveServeInvocation() {
        return { command: 'mock-serve', baseArgs: [], cwd: process.cwd() }
      },
      async discoverCandidates(args) {
        calls.push(['discover', args])
        return {
          roots: args.roots,
          count: 1,
          minScore: args.minScore,
          candidates: [{ rank: 1, path: 'first-wiki', score: 80, confidence: 'high', markdownCount: 20, signals: ['llmwiki-root:hot+index-or-overview', 'llmwiki-typed-dir', 'frontmatter:source_refs'] }],
        }
      },
      async validateCandidate(candidate) {
        calls.push(['validate', candidate.path])
        return { ...candidate, startable: true, manifest: { title: 'First Wiki', source_id: 'first-wiki', page_count: 3, approved_page_count: 3 } }
      },
      async startSources(args) {
        calls.push(['start', args])
        return {
          configPath: args.configPath,
          sources: [{ id: 'first-wiki', title: 'First Wiki', protocol: 'llmwiki-http', status: 'ready', selected: true, url: 'http://127.0.0.1:11001' }],
        }
      },
      async checkBridgeHealth(bridgeUrl) {
        calls.push(['bridge-health', bridgeUrl])
        return { ok: true, status: 'ok', url: bridgeUrl }
      },
      async registerSources(args) {
        calls.push(['register', args])
        return {
          bridgeUrl: args.bridgeUrl,
          replace: args.replace,
          payload: { sources: [{ id: 'first-wiki', url: 'http://127.0.0.1:11001' }] },
          response: { ok: true },
        }
      },
      async smokeBridge(args) {
        calls.push(['smoke', args])
        return { bridgeUrl: args.bridgeUrl, mode: args.mode, status: { state: 'completed' }, text: '' }
      },
    },
  )

  assert.equal(result.smokeMode, 'hybrid')
  assert.equal(calls.find((call) => call[0] === 'smoke')[1].mode, 'hybrid')
  assert.match(stdout.text, /Running bridge smoke in hybrid mode/)
})

test('quickstart stops before start/register/smoke when selected validation fails', async () => {
  const calls = []
  const stdout = captureWritable()
  const result = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788' },
    {
      stdout,
      stderr: stdout,
      async prompt() {
        return '1'
      },
    },
    {
      resolveServeInvocation() {
        return { command: 'mock-serve', baseArgs: [], cwd: process.cwd() }
      },
      async discoverCandidates(args) {
        calls.push(['discover', args])
        return {
          roots: args.roots,
          count: 1,
          minScore: args.minScore,
          candidates: [{ rank: 1, path: 'bad-wiki', score: 80, confidence: 'high', markdownCount: 20, signals: ['llmwiki-root:hot+index-or-overview', 'llmwiki-typed-dir', 'frontmatter:source_refs'] }],
        }
      },
      async validateCandidate(candidate) {
        calls.push(['validate', candidate.path])
        return { ...candidate, startable: false, validationError: 'manifest failed' }
      },
      async startSources(args) {
        calls.push(['start', args])
        return {}
      },
      async registerSources(args) {
        calls.push(['register', args])
        return {}
      },
      async smokeBridge(args) {
        calls.push(['smoke', args])
        return {}
      },
    },
  )

  assert.deepEqual(calls.map((call) => call[0]), ['discover', 'validate'])
  assert.deepEqual(result.skipped, ['start', 'bridge-setup', 'register', 'smoke'])
  assert.match(stdout.text, /No selected candidates validated successfully/)
})

test('detectLlmRuntime enables delegated-runtime when an LLM endpoint is configured', () => {
  assert.equal(detectLlmRuntime({}, {}).configured, false)
  const runtime = detectLlmRuntime({ 'llm-endpoint': 'http://127.0.0.1:8642/v1', 'llm-model': 'local-model' }, {})
  assert.equal(runtime.configured, true)
  assert.equal(runtime.baseUrl, 'http://127.0.0.1:8642/v1')
  assert.equal(runtime.model, 'local-model')
  assert.equal(runtime.profile, 'generic')
})

test('selectBridgeSmokeMode uses delegated only when runtime is explicit or bridge settings are configured', async () => {
  const evidence = await selectBridgeSmokeMode({
    env: {},
    inspectBridgeRuntime: async () => ({ configured: false, reason: 'no explicit LLM endpoint detected in bridge settings' }),
  })
  assert.equal(evidence.mode, 'evidence-only')

  const delegatedFromEnv = await selectBridgeSmokeMode({
    env: { LLMWIKI_AGENT_BRIDGE_BASE_URL: 'http://127.0.0.1:8642/v1' },
    inspectBridgeRuntime: async () => {
      throw new Error('settings should not be inspected when env is explicit')
    },
  })
  assert.equal(delegatedFromEnv.mode, 'delegated-runtime')

  const delegatedFromSettings = await selectBridgeSmokeMode({
    env: {},
    inspectBridgeRuntime: async () => ({ configured: true, reason: 'LLM endpoint configured in bridge settings' }),
  })
  assert.equal(delegatedFromSettings.mode, 'delegated-runtime')

  const forced = await selectBridgeSmokeMode({ options: { mode: 'hybrid' }, env: {} })
  assert.equal(forced.mode, 'hybrid')
})

test('smokeBridge sends requested orchestration mode', async (t) => {
  let server
  const receivedBody = new Promise((resolveBody) => {
    server = createServer((request, response) => {
      let raw = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => {
        raw += chunk
      })
      request.on('end', () => {
        resolveBody(JSON.parse(raw))
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ status: { state: 'completed', message: { parts: [{ kind: 'text', text: 'ok' }] } } }))
      })
    })
  })
  await new Promise((resolveListen) => {
    server.listen(0, '127.0.0.1', resolveListen)
  })
  t.after(() => {
    server.close()
  })

  const address = server.address()
  const result = await smokeBridge({
    bridgeUrl: `http://127.0.0.1:${address.port}`,
    query: 'release readiness',
    mode: 'delegated-runtime',
  })
  const body = await receivedBody

  assert.equal(result.mode, 'delegated-runtime')
  assert.equal(body.data.query, 'release readiness')
  assert.equal(body.data.mode, 'delegated-runtime')
})

test('scoreCandidate recognizes native llmwiki shape', () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-native-'))
  writeFileSync(join(root, 'index.md'), '---\nwiki_title: Native Wiki\nreview_state: approved\nsource_refs: [SRC]\n---\n# Native Wiki\n')
  writeFileSync(join(root, 'hot.md'), '---\nreview_state: approved\n---\n# Hot\n')
  mkdirSync(join(root, 'concepts'))
  writeFileSync(join(root, 'concepts', 'release.md'), '# Release\n')

  const scored = scoreCandidate(root)
  assert.equal(scored.confidence, 'high')
  assert(scored.signals.includes('llmwiki-root:hot+index-or-overview'))
  assert(scored.signals.includes('llmwiki-typed-dir'))
  assert(scored.signals.includes('frontmatter:source_refs'))
})

test('scoreCandidate penalizes skills/wiki folders', () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-skills-'))
  const wiki = join(root, 'skills', 'wiki')
  mkdirSync(wiki, { recursive: true })
  writeFileSync(join(wiki, 'README.md'), '# Skill docs\n')

  const scored = scoreCandidate(wiki)
  assert(scored.score < 20)
  assert(scored.signals.includes('penalty:skills-wiki'))
})

test('discoverCandidates prefers nested wiki source over plain parent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-nested-'))
  const nested = join(root, 'wiki')
  mkdirSync(join(nested, 'concepts'), { recursive: true })
  writeFileSync(join(nested, 'index.md'), '---\nwiki_title: Nested Wiki\nreview_state: approved\n---\n# Nested\n')
  writeFileSync(join(nested, 'hot.md'), '# Hot\n')
  writeFileSync(join(nested, 'concepts', 'topic.md'), '# Topic\n')

  const result = await discoverCandidates({ roots: [root], maxDepth: 3, validate: false })
  assert(result.candidates.some((candidate) => candidate.path === nested))
})

test('discoverCandidates avoids generated smoke artifact folders by default', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-generated-'))
  const real = join(root, 'knowledge-wiki')
  const smoke = join(root, 'smoke', 'wiki')
  mkdirSync(join(real, 'concepts'), { recursive: true })
  mkdirSync(join(smoke, 'concepts'), { recursive: true })
  for (const target of [real, smoke]) {
    writeFileSync(join(target, 'index.md'), '---\nreview_state: approved\nsource_refs: [SRC]\n---\n# Index\n')
    writeFileSync(join(target, 'hot.md'), '# Hot\n')
    writeFileSync(join(target, 'concepts', 'topic.md'), '# Topic\n')
  }

  const result = await discoverCandidates({ roots: [root], maxDepth: 4, validate: false })
  assert(result.candidates.some((candidate) => candidate.path === real))
  assert(!result.candidates.some((candidate) => candidate.path === smoke))
})

test('discoverCandidates hides llmwiki-work internal input and sources folders', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-work-root-'))
  const work = join(root, '.llmwiki-work')
  const real = join(work, 'project-wiki')
  const input = join(work, 'input', 'knowledge')
  const sources = join(work, 'sources')
  for (const target of [real, input, sources]) {
    mkdirSync(join(target, 'concepts'), { recursive: true })
    writeFileSync(join(target, 'index.md'), '---\nreview_state: approved\nsource_refs: [SRC]\n---\n# Index\n')
    writeFileSync(join(target, 'hot.md'), '# Hot\n')
    writeFileSync(join(target, 'concepts', 'topic.md'), '# Topic\n')
  }

  const result = await discoverCandidates({ roots: [work], maxDepth: 4, validate: false })
  assert(result.candidates.some((candidate) => candidate.path === real))
  assert(!result.candidates.some((candidate) => candidate.path === input))
  assert(!result.candidates.some((candidate) => candidate.path === sources))
})

test('discoverCandidates prefers Obsidian vault root over direct child wiki', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-obsidian-'))
  const wiki = join(root, 'wiki')
  mkdirSync(join(root, '.obsidian'), { recursive: true })
  mkdirSync(join(wiki, 'concepts'), { recursive: true })
  writeFileSync(join(root, 'root-note.md'), '# Root Note\n')
  writeFileSync(join(wiki, 'index.md'), '---\nreview_state: approved\nsource_refs: [SRC]\n---\n# Index\n')
  writeFileSync(join(wiki, 'hot.md'), '# Hot\n')
  writeFileSync(join(wiki, 'concepts', 'topic.md'), '# Topic\n')

  const result = await discoverCandidates({ roots: [root], maxDepth: 3, validate: false })
  assert(result.candidates.some((candidate) => candidate.path === root))
  assert(!result.candidates.some((candidate) => candidate.path === wiki))
})

test('scoreCandidate recognizes supported app variant markers at default threshold', () => {
  const variants = [
    {
      name: 'obsidian',
      variant: 'obsidian-vault',
      label: 'Obsidian vault',
      signal: 'obsidian:.obsidian',
      setup(root) {
        mkdirSync(join(root, '.obsidian'), { recursive: true })
        writeFileSync(join(root, 'note.md'), '# Obsidian note\n')
      },
    },
    {
      name: 'logseq-config',
      variant: 'logseq-graph',
      label: 'Logseq graph',
      signal: 'logseq:config',
      setup(root) {
        mkdirSync(join(root, 'logseq'), { recursive: true })
        writeFileSync(join(root, 'logseq', 'config.edn'), '{}\n')
      },
    },
    {
      name: 'dendron',
      variant: 'dendron-workspace',
      label: 'Dendron workspace',
      signal: 'dendron:dendron.yml',
      setup(root) {
        writeFileSync(join(root, 'dendron.yml'), 'version: 5\n')
      },
    },
    {
      name: 'foam',
      variant: 'foam-workspace',
      label: 'Foam workspace',
      signal: 'foam:.foam',
      setup(root) {
        mkdirSync(join(root, '.foam'), { recursive: true })
      },
    },
    {
      name: 'quartz',
      variant: 'quartz-source',
      label: 'Quartz source',
      signal: 'quartz:config',
      setup(root) {
        writeFileSync(join(root, 'quartz.config.ts'), 'export default {}\n')
      },
    },
  ]

  for (const variant of variants) {
    const root = mkdtempSync(join(tmpdir(), `llmwiki-${variant.name}-`))
    variant.setup(root)

    const scored = scoreCandidate(root)
    assert(scored.score >= 30, `${variant.name} should meet the default discovery threshold`)
    assert(['medium', 'high'].includes(scored.confidence), `${variant.name} should be medium or high confidence`)
    assert(scored.signals.includes(variant.signal), `${variant.name} should report ${variant.signal}`)
    assert.equal(scored.variant, variant.variant, `${variant.name} should use the expected variant`)
    assert.equal(scored.variantLabel, variant.label, `${variant.name} should use the expected variant label`)
  }
})

test('explicit app markers take precedence over weak native-looking structure', () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-obsidian-native-looking-'))
  mkdirSync(join(root, '.obsidian'), { recursive: true })
  mkdirSync(join(root, 'concepts'), { recursive: true })
  writeFileSync(join(root, 'hot.md'), '# Hot\n')
  writeFileSync(join(root, 'index.md'), '# Index\n')
  writeFileSync(join(root, 'concepts', 'topic.md'), '# Topic\n')

  const scored = scoreCandidate(root)
  assert.equal(scored.variant, 'obsidian-vault')
  assert.equal(scored.variantLabel, 'Obsidian vault')
  assert(scored.signals.includes('llmwiki-root:hot+index-or-overview'))
  assert(scored.signals.includes('obsidian:.obsidian'))
})

test('scoreCandidate classifies compiler-marked source as native LLMWiki', () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-compiler-marked-'))
  writeFileSync(join(root, '.wiki-compiler.json'), '{"version":1}\n')
  writeFileSync(join(root, 'README.md'), '# Project wiki\n')

  const scored = scoreCandidate(root)
  assert.equal(scored.variant, 'native-llmwiki-openwiki')
  assert.equal(scored.variantLabel, 'Native LLMWiki/OpenWiki')
  assert(scored.score >= 30)
  assert(scored.signals.includes('llmwiki-marker:.wiki-compiler.json'))
})

test('scoreCandidate classifies native LLMWiki only from structural source markers', () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-native-structure-'))
  mkdirSync(join(root, 'concepts'))
  mkdirSync(join(root, 'graph'))
  writeFileSync(join(root, 'hot.md'), '# Hot\n')
  writeFileSync(join(root, 'overview.md'), '# Overview\n')
  writeFileSync(join(root, 'concepts', 'topic.md'), '# Topic\n')
  writeFileSync(join(root, 'graph', 'graph.json'), '{"nodes":[],"edges":[]}\n')

  const scored = scoreCandidate(root)
  assert.equal(scored.variant, 'native-llmwiki-openwiki')
  assert.equal(scored.variantLabel, 'Native LLMWiki/OpenWiki')
  assert(scored.score >= 30)
  assert(['medium', 'high'].includes(scored.confidence))
})

test('scoreCandidate classifies source-like Markdown wiki roots separately from native projections', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'llmwiki-markdown-parent-'))
  const root = join(parent, 'wiki')
  mkdirSync(join(root, 'concepts'), { recursive: true })
  writeFileSync(join(root, 'index.md'), '# Markdown wiki\n')
  writeFileSync(join(root, 'concepts', 'topic.md'), '# Topic\n')
  for (let index = 0; index < 50; index += 1) {
    writeFileSync(join(root, `note-${index}.md`), `# Note ${index}\n`)
  }

  const scored = scoreCandidate(root)
  assert.equal(scored.variant, 'llmwiki-markdown')
  assert.equal(scored.variantLabel, 'LLMWiki Markdown')
  assert(scored.score >= 30)
  assert(['medium', 'high'].includes(scored.confidence))

  const result = await discoverCandidates({ roots: [parent], maxDepth: 2, validate: false })
  assert.equal(result.candidates[0].path, root)
  assert.equal(result.candidates[0].variant, 'llmwiki-markdown')
})

test('source-like Markdown variants support explicit wiki root names', () => {
  for (const name of ['wiki', 'llmwiki', 'openwiki', 'vault']) {
    const parent = mkdtempSync(join(tmpdir(), `llmwiki-markdown-${name}-`))
    const root = join(parent, name)
    mkdirSync(join(root, 'concepts'), { recursive: true })
    writeFileSync(join(root, 'index.md'), '# Markdown wiki\n')
    writeFileSync(join(root, 'concepts', 'topic.md'), '# Topic\n')
    for (let index = 0; index < 50; index += 1) {
      writeFileSync(join(root, `note-${index}.md`), `# Note ${index}\n`)
    }

    const scored = scoreCandidate(root)
    assert.equal(scored.variant, 'llmwiki-markdown', `${name} should be an LLMWiki Markdown root`)
    assert.equal(scored.variantLabel, 'LLMWiki Markdown')
  }
})

test('source-like Markdown wiki roots with hot and index are not mislabeled native', () => {
  const parent = mkdtempSync(join(tmpdir(), 'llmwiki-markdown-hot-index-parent-'))
  const root = join(parent, 'wiki')
  mkdirSync(join(root, 'concepts'), { recursive: true })
  writeFileSync(join(root, 'hot.md'), '# Hot\n')
  writeFileSync(join(root, 'index.md'), '# Index\n')
  writeFileSync(join(root, 'concepts', 'topic.md'), '# Topic\n')
  for (let index = 0; index < 50; index += 1) {
    writeFileSync(join(root, `note-${index}.md`), `# Note ${index}\n`)
  }

  const scored = scoreCandidate(root)
  assert.equal(scored.variant, 'llmwiki-markdown')
  assert.equal(scored.variantLabel, 'LLMWiki Markdown')
  assert(scored.signals.includes('llmwiki-root:hot+index-or-overview'))
})

test('docs-like hot index typed folders stay generic without projection evidence', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'llmwiki-docs-hot-index-parent-'))
  const root = join(parent, 'docs')
  mkdirSync(join(root, 'concepts'), { recursive: true })
  writeFileSync(join(root, 'hot.md'), '# Hot\n')
  writeFileSync(join(root, 'index.md'), '# Index\n')
  writeFileSync(join(root, 'concepts', 'topic.md'), '# Topic\n')
  for (let index = 0; index < 50; index += 1) {
    writeFileSync(join(root, `guide-${index}.md`), `# Guide ${index}\n`)
  }

  const scored = scoreCandidate(root)
  assert.equal(scored.variant, 'generic-markdown')
  assert.equal(scored.variantLabel, 'Generic Markdown')
  assert(scored.score < 30)

  const result = await discoverCandidates({ roots: [parent], maxDepth: 2, validate: false })
  assert.equal(result.candidates.length, 0)
})

test('compiler marker still wins over source-like Markdown root shape', () => {
  const parent = mkdtempSync(join(tmpdir(), 'llmwiki-compiler-marked-wiki-parent-'))
  const root = join(parent, 'wiki')
  mkdirSync(join(root, 'concepts'), { recursive: true })
  writeFileSync(join(root, '.wiki-compiler.json'), '{"version":1}\n')
  writeFileSync(join(root, 'index.md'), '# Compiled wiki\n')
  writeFileSync(join(root, 'concepts', 'topic.md'), '# Topic\n')
  for (let index = 0; index < 50; index += 1) {
    writeFileSync(join(root, `note-${index}.md`), `# Note ${index}\n`)
  }

  const scored = scoreCandidate(root)
  assert.equal(scored.variant, 'native-llmwiki-openwiki')
  assert.equal(scored.variantLabel, 'Native LLMWiki/OpenWiki')
})

test('Obsidian marker still wins over source-like Markdown root shape', () => {
  const parent = mkdtempSync(join(tmpdir(), 'llmwiki-obsidian-vault-root-parent-'))
  const root = join(parent, 'vault')
  mkdirSync(join(root, '.obsidian'), { recursive: true })
  mkdirSync(join(root, 'concepts'), { recursive: true })
  writeFileSync(join(root, 'index.md'), '# Vault\n')
  writeFileSync(join(root, 'concepts', 'topic.md'), '# Topic\n')
  for (let index = 0; index < 50; index += 1) {
    writeFileSync(join(root, `note-${index}.md`), `# Note ${index}\n`)
  }

  const scored = scoreCandidate(root)
  assert.equal(scored.variant, 'obsidian-vault')
  assert.equal(scored.variantLabel, 'Obsidian vault')
})

test('small source-like Markdown roots stay generic until explicitly requested', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'llmwiki-small-markdown-parent-'))
  const root = join(parent, 'wiki')
  mkdirSync(join(root, 'concepts'), { recursive: true })
  writeFileSync(join(root, 'index.md'), '# Small wiki\n')
  writeFileSync(join(root, 'concepts', 'topic.md'), '# Topic\n')
  for (let index = 0; index < 5; index += 1) {
    writeFileSync(join(root, `note-${index}.md`), `# Note ${index}\n`)
  }

  const scored = scoreCandidate(root)
  assert.equal(scored.variant, 'generic-markdown')
  assert.equal(scored.variantLabel, 'Generic Markdown')
  assert(scored.score < 30)

  const result = await discoverCandidates({ roots: [parent], maxDepth: 2, validate: false })
  assert.equal(result.candidates.length, 0)
})

test('frontmatter-only Markdown folders stay generic and hidden by default', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-frontmatter-only-docs-'))
  for (let index = 0; index < 12; index += 1) {
    writeFileSync(
      join(root, `doc-${index}.md`),
      '---\nreview_state: approved\nwiki_title: Docs Folder\nsource_refs: [SRC]\n---\n# Doc\n',
    )
  }

  const scored = scoreCandidate(root)
  assert.equal(scored.variant, 'generic-markdown')
  assert.equal(scored.variantLabel, 'Generic Markdown')
  assert.equal(scored.confidence, 'low')
  assert(scored.score < 30)

  const defaultResult = await discoverCandidates({ roots: [root], maxDepth: 1, validate: false })
  assert.equal(defaultResult.candidates.length, 0)

  const explicitResult = await discoverCandidates({ roots: [root], maxDepth: 1, minScore: 10, validate: false })
  assert.equal(explicitResult.candidates.length, 1)
  assert.equal(explicitResult.candidates[0].variant, 'generic-markdown')
})

test('docs-like hub and typed folders stay generic without projection evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-docs-like-'))
  mkdirSync(join(root, 'concepts'))
  writeFileSync(join(root, 'overview.md'), '# Overview\n')
  writeFileSync(join(root, 'concepts', 'topic.md'), '# Topic\n')
  for (let index = 0; index < 5; index += 1) {
    writeFileSync(join(root, `guide-${index}.md`), `# Guide ${index}\n`)
  }

  const scored = scoreCandidate(root)
  assert.equal(scored.variant, 'generic-markdown')
  assert.equal(scored.variantLabel, 'Generic Markdown')
  assert.equal(scored.confidence, 'low')
  assert(scored.score < 30)

  const result = await discoverCandidates({ roots: [root], maxDepth: 1, validate: false })
  assert.equal(result.candidates.length, 0)
})

test('hot plus index alone stays generic without projection evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-hot-index-only-'))
  writeFileSync(join(root, 'hot.md'), '# Hot\n')
  writeFileSync(join(root, 'index.md'), '# Index\n')
  for (let index = 0; index < 5; index += 1) {
    writeFileSync(join(root, `note-${index}.md`), `# Note ${index}\n`)
  }

  const scored = scoreCandidate(root)
  assert.equal(scored.variant, 'generic-markdown')
  assert.equal(scored.variantLabel, 'Generic Markdown')
  assert.equal(scored.confidence, 'low')
  assert(scored.score < 30)

  const result = await discoverCandidates({ roots: [root], maxDepth: 1, validate: false })
  assert.equal(result.candidates.length, 0)
})

test('quickstart labels frontmatter-only candidates as Generic Markdown', async () => {
  const stdout = captureWritable()
  const answers = ['y', 'q']
  const candidates = [{
    rank: 1,
    path: 'frontmatter-only-docs',
    score: 25,
    confidence: 'low',
    markdownCount: 12,
    variant: 'generic-markdown',
    variantLabel: 'Generic Markdown',
    signals: ['frontmatter:source_refs', 'frontmatter:review_state', 'frontmatter:wiki_title', 'markdown:5+'],
  }]

  const result = await quickstart(
    { path: '.', minScore: '10' },
    {
      stdout,
      stderr: stdout,
      async prompt() {
        return answers.shift()
      },
    },
    {
      resolveServeInvocation() {
        return { command: 'mock-serve', baseArgs: [], cwd: process.cwd() }
      },
      async discoverCandidates(args) {
        return { roots: args.roots, count: candidates.length, minScore: args.minScore, candidates }
      },
    },
  )

  assert.match(stdout.text, /frontmatter-only-docs \[Generic Markdown\] \(low\/25, 12 md\)/)
  assert.deepEqual(result.skipped, ['start', 'bridge-setup', 'register', 'smoke'])
})

test('scoreCandidate reports Logseq pages and journals as a low-confidence fallback marker', () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-logseq-pages-journals-'))
  mkdirSync(join(root, 'pages'), { recursive: true })
  mkdirSync(join(root, 'journals'), { recursive: true })

  const scored = scoreCandidate(root)
  assert(scored.score >= 10 && scored.score < 30)
  assert.equal(scored.confidence, 'low')
  assert.equal(scored.variant, 'logseq-graph')
  assert.equal(scored.variantLabel, 'Logseq graph')
  assert(scored.signals.includes('logseq:pages+journals'))
})

test('scoreCandidate reports Foam VS Code extension hints as a low-confidence fallback marker', () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-foam-vscode-'))
  mkdirSync(join(root, '.vscode'), { recursive: true })
  writeFileSync(join(root, '.vscode', 'extensions.json'), '{"recommendations":["foam.foam-vscode"]}\n')

  const scored = scoreCandidate(root)
  assert(scored.score >= 10 && scored.score < 30)
  assert.equal(scored.confidence, 'low')
  assert.equal(scored.variant, 'foam-workspace')
  assert.equal(scored.variantLabel, 'Foam workspace')
  assert(scored.signals.includes('foam:vscode-extension'))
})

test('discoverCandidates hides low-confidence generic folders unless minScore is lowered', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-low-generic-'))
  for (let index = 0; index < 5; index += 1) {
    writeFileSync(join(root, `note-${index}.md`), `# Note ${index}\n`)
  }

  const defaultResult = await discoverCandidates({ roots: [root], maxDepth: 1, validate: false })
  assert.equal(defaultResult.candidates.length, 0)

  const explicitResult = await discoverCandidates({ roots: [root], maxDepth: 1, minScore: 10, validate: false })
  assert.equal(explicitResult.candidates.length, 1)
  assert.equal(explicitResult.candidates[0].path, root)
})

test('discoverCandidates accepts an injected scanner for deterministic candidate prefiltering', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-injected-scanner-'))
  const included = join(root, 'included-wiki')
  const excluded = join(root, 'excluded-wiki')
  const generated = join(root, 'node_modules', 'generated-wiki')
  for (const target of [included, excluded, generated]) {
    mkdirSync(join(target, 'concepts'), { recursive: true })
    writeFileSync(join(target, 'index.md'), '---\nreview_state: approved\nsource_refs: [SRC]\n---\n# Index\n')
    writeFileSync(join(target, 'hot.md'), '# Hot\n')
    writeFileSync(join(target, 'concepts', 'topic.md'), '# Topic\n')
  }

  const scannerCalls = []
  const result = await discoverCandidates({
    roots: [root],
    maxDepth: 3,
    validate: false,
    scanner(args) {
      scannerCalls.push(args)
      return [included, generated]
    },
  })

  assert.equal(scannerCalls.length, 1)
  assert.equal(scannerCalls[0].root, root)
  assert.deepEqual(result.candidates.map((candidate) => candidate.path), [included])
  assert(!result.candidates.some((candidate) => candidate.path === excluded))
  assert(!result.candidates.some((candidate) => candidate.path === generated))
})

test('scanCandidateDirectories JavaScript fallback prefilters source markers and skips generated folders', () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-js-scanner-'))
  const real = join(root, 'knowledge-wiki')
  const generated = join(root, 'node_modules', 'generated-wiki')
  for (const target of [real, generated]) {
    mkdirSync(join(target, 'concepts'), { recursive: true })
    writeFileSync(join(target, 'index.md'), '---\nreview_state: approved\nsource_refs: [SRC]\n---\n# Index\n')
    writeFileSync(join(target, 'hot.md'), '# Hot\n')
    writeFileSync(join(target, 'concepts', 'topic.md'), '# Topic\n')
  }

  const scanned = scanCandidateDirectories({
    root,
    maxDepth: 4,
    minScore: 30,
    preferExternalTools: false,
  })

  assert(scanned.includes(real))
  assert(!scanned.includes(generated))
})

test('mergeBridgeSources upserts by source URL without dropping existing sources', () => {
  const merged = mergeBridgeSources([
    {
      id: 'existing',
      name: 'Existing',
      title: 'Existing',
      protocol: 'llmwiki-http',
      status: 'ready',
      selected: false,
      url: 'http://127.0.0.1:11001',
    },
    {
      id: 'other',
      name: 'Other',
      title: 'Other',
      protocol: 'llmwiki-http',
      status: 'ready',
      selected: false,
      url: 'http://127.0.0.1:11003',
    },
  ], [
    {
      id: 'existing-renamed',
      name: 'Existing Renamed',
      title: 'Existing Renamed',
      protocol: 'llmwiki-http',
      status: 'ready',
      selected: true,
      url: 'http://127.0.0.1:11001/',
    },
  ])

  assert.equal(merged.length, 2)
  assert.equal(merged.find((source) => source.url === 'http://127.0.0.1:11001').id, 'existing-renamed')
  assert.equal(merged.find((source) => source.id === 'other').url, 'http://127.0.0.1:11003')
})

test('mergeBridgeSources upserts by stable id when a source moves ports', () => {
  const merged = mergeBridgeSources([
    {
      id: 'knowledge-bridge-labs-working-wiki',
      name: 'Old',
      title: 'Old',
      protocol: 'llmwiki-http',
      status: 'ready',
      selected: true,
      url: 'http://127.0.0.1:11001',
    },
  ], [
    {
      id: 'knowledge-bridge-labs-working-wiki',
      name: 'New',
      title: 'New',
      protocol: 'llmwiki-http',
      status: 'ready',
      selected: true,
      url: 'http://127.0.0.1:11101',
    },
  ])

  assert.equal(merged.length, 1)
  assert.equal(merged[0].name, 'New')
  assert.equal(merged[0].url, 'http://127.0.0.1:11101')
})

test('registerSources rejects source URLs with credentials before contacting bridge', async () => {
  await assert.rejects(
    () => registerSources({
      bridgeUrl: 'http://127.0.0.1:9',
      sourceUrls: ['http://user:secret@127.0.0.1:11001'],
    }),
    /credentials/,
  )
})

function captureWritable() {
  let text = ''
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      const value = chunk.toString()
      text += value
      callback()
    },
  })
  Object.defineProperty(stream, 'text', {
    get() {
      return text
    },
  })
  return stream
}

function writeServeStubScript(root, { neverHealthy = false, pidFile = '' } = {}) {
  const script = join(root, `serve-stub-${neverHealthy ? 'unhealthy' : 'ready'}.mjs`)
  writeFileSync(script, `import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'

const [command, sourcePath, ...args] = process.argv.slice(2)

if (command === 'manifest') {
  console.log(JSON.stringify({
    title: 'Ready Wiki',
    source_id: 'ready-wiki',
    page_count: 1,
    approved_page_count: 1,
  }))
  process.exit(0)
}

if (command !== 'serve') {
  console.error(\`Unexpected command: \${command} \${sourcePath || ''}\`)
  process.exit(2)
}

const pidFile = ${JSON.stringify(pidFile)}
if (pidFile) {
  writeFileSync(pidFile, String(process.pid))
}

if (${JSON.stringify(Boolean(neverHealthy))}) {
  setInterval(() => {}, 1000)
} else {
  const host = args[args.indexOf('--host') + 1] || '127.0.0.1'
  const port = Number(args[args.indexOf('--port') + 1])
  createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ status: 'ok' }))
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('not found')
  }).listen(port, host)
}
`, 'utf8')
  return script
}

async function freePort() {
  const server = createServer()
  await new Promise((resolveListen) => {
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const { port } = server.address()
  await new Promise((resolveClose) => {
    server.close(resolveClose)
  })
  return port
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return
    }
    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, 50)
    })
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function killPid(pid) {
  if (!pid || !isProcessAlive(pid)) {
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // Best-effort cleanup for tests.
  }
}
