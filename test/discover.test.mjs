import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { test } from 'node:test'
import { cursor as ansiCursor, erase as ansiErase } from 'sisteransi'

import { configureBridgeRuntime, createQuickstartDiscoveryProgress, createQuickstartValidationProgress, detectLlmRuntime, discoverCandidates, downloadRuntimeInstallerScript, inspectRuntimeFramework, mergeBridgeSources, parseArgs, parseCandidateSelection, parseYesNo, probeRuntimeEndpoint, quickstart, registerSources, resolveServeInvocation, runCli, runRuntimeInstallPlan, runtimeInstallPlan, scanCandidateDirectories, scoreCandidate, scrubInstallerEnv, selectBridgeSmokeMode, smokeBridge, startBridgeCommand, startSources } from '../src/index.mjs'

test('parseArgs collects repeated options', () => {
  const parsed = parseArgs(['discover', '--path', 'a', '--path', 'b', '--validate'])
  assert.equal(parsed.command, 'discover')
  assert.deepEqual(parsed.options.path, ['a', 'b'])
  assert.equal(parsed.options.validate, true)
})

test('parseArgs supports quickstart screen-clear opt-out flag', () => {
  const parsed = parseArgs(['quickstart', '--no-clear-screen'])
  assert.equal(parsed.command, 'quickstart')
  assert.equal(parsed.options['clear-screen'], false)
})

test('parseArgs supports runtime install approval flags', () => {
  const approve = parseArgs(['quickstart', '--install-runtime'])
  assert.equal(approve.command, 'quickstart')
  assert.equal(approve.options['install-runtime'], true)

  const decline = parseArgs(['quickstart', '--no-install-runtime'])
  assert.equal(decline.command, 'quickstart')
  assert.equal(decline.options['install-runtime'], false)
})

test('parseArgs accepts explicit runtime adapter option', () => {
  const parsed = parseArgs(['quickstart', '--runtime-adapter', 'deepagents-acp'])
  assert.equal(parsed.command, 'quickstart')
  assert.equal(parsed.options['runtime-adapter'], 'deepagents-acp')
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
  assert(stdout.text.includes('llmwiki-* lets coding agents use local/project knowledge'))
  assert(stdout.text.includes('llmwiki-agent-bridge is optional'))
  assert(stdout.text.includes('This quickstart finds local wiki folders'))
  assert(stdout.text.includes('[1/5] Discover sources'))
  assert(stdout.text.includes('[info] Will scan these root folder(s):'))
  assert(stdout.text.includes(homedir()))
  assert(stdout.text.includes('[choice] Selected: No'))
  assert(stdout.text.includes('[skip] Skipped discovery.'))
  assert(stdout.text.includes('Skipped discovery.'))
  assert.equal(prompts.length, 1)
  assert.match(prompts[0].question, /Auto-discover/)
  assert.match(prompts[0].question, /Auto-discover local LLMWiki\/knowledge source folders\?\nDefault discovery/)
  assert.match(prompts[0].question, /\n\[Y\/n\]: $/)
  assert.match(prompts[0].question, /current user's home/)
  assert.match(stdout.text, /Run `llmwiki-bridge-start --path DIR` to scan a specific root/)
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
  assert(stdout.text.includes('[choice] Selected: No'))
  assert(stdout.text.includes('[skip] Skipped discovery.'))
  assert(stdout.text.includes('Skipped discovery.'))
  assert.equal(prompts.length, 1)
  assert.match(prompts[0].question, /Auto-discover/)
  assert.match(prompts[0].question, /current user's home/)
  assert.match(stdout.text, /Run `llmwiki-bridge-start --path DIR` to scan a specific root/)
})

test('quickstart discovery prompt explains constrained roots without the home-scan warning', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-constrained-quickstart-'))
  const stdout = captureWritable()
  const prompts = []

  await runCli(['quickstart', '--path', root], {
    stdout,
    stderr: stdout,
    async prompt(question, fallback) {
      prompts.push({ question, fallback })
      return 'n'
    },
  })

  assert(stdout.text.includes('[info] Will scan these root folder(s):'))
  assert(stdout.text.includes(root))
  assert.equal(prompts.length, 1)
  assert.match(prompts[0].question, /Discovery is constrained to the root\(s\) shown above/)
  assert.match(prompts[0].question, /Find LLMWiki\/knowledge source folders under the shown root\(s\)\?\nDiscovery is constrained/)
  assert.match(prompts[0].question, /\n\[Y\/n\]: $/)
  assert.doesNotMatch(prompts[0].question, /current user's home/)
  assert.doesNotMatch(prompts[0].question, /Auto-discover/)
  assert.match(stdout.text, /Rerun quickstart when you want to scan the shown root\(s\)/)
  assert.doesNotMatch(stdout.text, /Run `llmwiki-bridge-start --path DIR` to scan a specific root/)
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
  assert.match(stdout.text, /\[choice\] Selected: No/)
  assert.match(stdout.text, /\[skip\] Skipped discovery/)
})

test('quickstart TTY yes/no uses immediate clack confirm and direct discovery progress', async (t) => {
  const previousNoColor = process.env.NO_COLOR
  process.env.NO_COLOR = '1'
  t.after(() => {
    if (previousNoColor === undefined) {
      delete process.env.NO_COLOR
    } else {
      process.env.NO_COLOR = previousNoColor
    }
  })

  const stdout = captureTtyWritable()
  const stdin = ttyReadable()
  const confirmCalls = []

  const result = await quickstart(
    { path: '.' },
    {
      stdin,
      stdout,
      stderr: stdout,
      clackPrompts: {
        async confirm(params) {
          confirmCalls.push(params)
          params.input.emit('keypress', 'y', { name: 'y' })
          return true
        },
        isCancel() {
          return false
        },
        cancel() {},
      },
    },
    {
      resolveServeInvocation() {
        return { command: 'mock-serve', baseArgs: [], cwd: process.cwd() }
      },
      async discoverCandidates(args) {
        return { roots: args.roots, count: 0, minScore: args.minScore, candidates: [] }
      },
    },
  )

  assert.equal(result.autoDiscover, true)
  assert.equal(confirmCalls.length, 1)
  assert.match(confirmCalls[0].message, /Find LLMWiki\/knowledge source folders under the shown root\(s\)\?/)
  assert.doesNotMatch(confirmCalls[0].message, /Auto-discover/)
  assert.equal(confirmCalls[0].initialValue, true)
  assert.equal(confirmCalls[0].input, stdin)
  assert.equal(confirmCalls[0].output, stdout)
  assert.match(stdout.text, /\[choice\] Selected: Yes/)
  assert.match(stdout.text, /\[run\] Discovery scans candidates without validation; validation runs only if you start selected sources\.\n\[run\] Searching local folders for LLMWiki candidates\.\.\.\n\[ok\] Discovery complete: found 0 candidate source folder\(s\)\./)
  assert.doesNotMatch(stdout.text, /\[Y\/n\]:/)
})

test('quickstart TTY screen transitions clear each major screen while preserving current-step context', async (t) => {
  const previousNoColor = process.env.NO_COLOR
  process.env.NO_COLOR = '1'
  disableCiEnvironmentForTtyTest(t)
  t.after(() => {
    if (previousNoColor === undefined) {
      delete process.env.NO_COLOR
    } else {
      process.env.NO_COLOR = previousNoColor
    }
  })

  const runRoot = mkdtempSync(join(tmpdir(), 'llmwiki-quickstart-screen-'))
  const sourcePath = join(runRoot, 'interactive-wiki')
  const stdout = captureTtyWritable()
  const stdin = ttyReadable()
  const confirmAnswers = [true, true, false]
  const calls = []

  const result = await quickstart(
    { path: '.', config: join(runRoot, 'sources.json') },
    {
      stdin,
      stdout,
      stderr: stdout,
      clackPrompts: {
        async confirm(params) {
          calls.push(['confirm', params.message])
          return confirmAnswers.shift()
        },
        async multiselect(params) {
          calls.push(['multiselect', params.message])
          return [1]
        },
        isCancel() {
          return false
        },
        cancel() {},
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
          candidates: [{ rank: 1, path: sourcePath, score: 80, confidence: 'high', markdownCount: 20, signals: ['llmwiki-root:hot+index-or-overview', 'llmwiki-typed-dir', 'frontmatter:source_refs'] }],
        }
      },
      async validateCandidate(candidate) {
        calls.push(['validate', candidate.path])
        return { ...candidate, startable: true, manifest: { title: 'Interactive Wiki', source_id: 'interactive-wiki', page_count: 3, approved_page_count: 3 } }
      },
      async startSources(args) {
        calls.push(['start', args])
        return {
          configPath: args.configPath,
          sources: [{ id: 'interactive-wiki', title: 'Interactive Wiki', path: sourcePath, protocol: 'llmwiki-http', status: 'ready', selected: true, url: 'http://127.0.0.1:11001' }],
        }
      },
    },
  )

  const visibleClear = `${ansiCursor.up(23)}${ansiCursor.to(0)}${ansiErase.down()}`
  assert.equal(countOccurrences(stdout.text, visibleClear), 3)
  assert.equal(countOccurrences(stdout.text, `${visibleClear}+`), 3)
  assert.equal(countOccurrences(stdout.text, 'Knowledge Bridge Labs'), 4)
  assert.equal(countOccurrences(stdout.text, 'local knowledge  ==[ bridge ]==>  coding agents'), 4)
  assert.doesNotMatch(stdout.text, /\u001b\[3J/)
  assert.deepEqual(calls.map((call) => call[0]), ['confirm', 'discover', 'multiselect', 'confirm', 'validate', 'start', 'confirm'])
  assert.deepEqual(result.skipped, ['bridge-setup', 'register', 'smoke'])

  const validateScreenStart = stdout.text.indexOf('[3/5] Validate and start local sources')
  assert.notEqual(validateScreenStart, -1)
  const nextScreenStart = stdout.text.indexOf(visibleClear, validateScreenStart + 1)
  const validateScreen = stdout.text.slice(validateScreenStart, nextScreenStart)
  assert.match(validateScreen, /Selected source folder\(s\):/)
  assert.match(validateScreen, /interactive-wiki \[Native LLMWiki\/OpenWiki\]/)
  assert.match(validateScreen, new RegExp(sourcePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('quickstart screen transitions stay disabled for redirected stdout even when stdin is TTY', async () => {
  const stdout = captureWritable()
  const stdin = Readable.from(['n\n'])
  Object.defineProperty(stdin, 'isTTY', { value: true })
  stdin.setRawMode = () => stdin

  await quickstart(
    {},
    { stdin, stdout, stderr: stdout },
    {
      resolveServeInvocation() {
        return { command: 'mock-serve', baseArgs: [], cwd: process.cwd() }
      },
    },
  )

  assert.doesNotMatch(stdout.text, /\u001b\[[0-9;]*J/)
  assert.equal(countOccurrences(stdout.text, 'Knowledge Bridge Labs'), 0)
  assert.equal(countOccurrences(stdout.text, 'local knowledge  ==[ bridge ]==>  coding agents'), 0)
  assert.match(stdout.text, /\[\?\] Auto-discover local LLMWiki\/knowledge source folders\?\nDefault discovery scans the current user's home unless --path\/--workspace\/--cwd constrains it\.\n\[Y\/n\]:\n/)
  assert.match(stdout.text, /\[choice\] Selected: No\n/)
})

test('quickstart discovery progress appends TTY heartbeat dots with an injected clock', () => {
  const stdout = captureTtyWritable()
  const intervals = []
  const cleared = []
  const clock = {
    setInterval(callback, ms) {
      intervals.push({ callback, ms })
      return `timer-${intervals.length}`
    },
    clearInterval(timer) {
      cleared.push(timer)
    },
  }

  const progress = createQuickstartDiscoveryProgress({
    stdout,
    discoveryProgressClock: clock,
    discoveryProgressIntervalMs: 25,
  }, { color: false })

  progress.start('Searching local folders for LLMWiki candidates')
  intervals[0].callback()
  intervals[0].callback()
  progress.stop('Discovery complete: found 3 candidate source folder(s).')

  assert.equal(intervals.length, 1)
  assert.equal(intervals[0].ms, 25)
  assert.deepEqual(cleared, ['timer-1'])
  assert.equal(stdout.text, '[run] Searching local folders for LLMWiki candidates..\n[ok] Discovery complete: found 3 candidate source folder(s).\n')
})

test('quickstart discovery uses a timer spinner before slow discovery completes', async () => {
  const stdout = captureTtyWritable()
  const events = []
  const spinnerFactory = (options) => ({
    start(message) {
      events.push(['spinner-start', options.indicator, message])
    },
    stop(message) {
      events.push(['spinner-stop', message])
    },
    error(message) {
      events.push(['spinner-error', message])
    },
    clear() {
      events.push(['spinner-clear'])
    },
  })
  const answers = ['y', 'q']

  await quickstart(
    { path: '.' },
    {
      stdout,
      stderr: stdout,
      forceDiscoveryHeartbeat: true,
      clackPrompts: { spinner: spinnerFactory },
      async prompt() {
        return answers.shift()
      },
    },
    {
      resolveServeInvocation() {
        return { command: 'mock-serve', baseArgs: [], cwd: process.cwd() }
      },
      async discoverCandidates(args) {
        events.push(['discover-start', events.length])
        assert.equal(events[0][0], 'spinner-start')
        await new Promise((resolveTick) => {
          setImmediate(resolveTick)
        })
        events.push(['discover-finish'])
        return { roots: args.roots, count: 1, minScore: args.minScore, candidates: [{ rank: 1, path: 'slow-wiki', score: 80, confidence: 'high', markdownCount: 20, signals: ['llmwiki-root:hot+index-or-overview', 'llmwiki-typed-dir', 'frontmatter:source_refs'] }] }
      },
    },
  )

  assert.deepEqual(events.map((event) => event[0]), ['spinner-start', 'discover-start', 'discover-finish', 'spinner-stop'])
  assert.equal(events[0][1], 'timer')
  assert.equal(events[0][2], 'Searching local folders for LLMWiki candidates')
  assert.equal(events[3][1], 'Discovery complete: found 1 candidate source folder(s).')
})

test('quickstart progress keeps transcript output when stdout is redirected even if stdin is TTY', () => {
  const stdout = captureWritable()
  const stdin = ttyReadable()
  const progress = createQuickstartDiscoveryProgress({
    stdin,
    stdout,
    clackPrompts: {
      spinner() {
        throw new Error('redirected stdout must not use an interactive spinner')
      },
    },
  }, { color: false })

  progress.start('Searching local folders for LLMWiki candidates...')
  progress.stop('Discovery complete: found 2 candidate source folder(s).')

  assert.equal(stdout.text, '[run] Searching local folders for LLMWiki candidates...\n[ok] Discovery complete: found 2 candidate source folder(s).\n')
})

test('quickstart validation progress appends TTY heartbeat dots with an injected clock', () => {
  const stdout = captureTtyWritable()
  const intervals = []
  const cleared = []
  const clock = {
    setInterval(callback, ms) {
      intervals.push({ callback, ms })
      return `timer-${intervals.length}`
    },
    clearInterval(timer) {
      cleared.push(timer)
    },
  }

  const progress = createQuickstartValidationProgress({
    stdout,
    validationProgressClock: clock,
    validationProgressIntervalMs: 25,
  }, { color: false })

  progress.start('Validating 2 selected candidate(s) with llmwiki-serve manifest.')
  intervals[0].callback()
  intervals[0].callback()
  progress.stop()

  assert.equal(intervals.length, 1)
  assert.equal(intervals[0].ms, 25)
  assert.deepEqual(cleared, ['timer-1'])
  assert.equal(stdout.text, '[run] Validating 2 selected candidate(s) with llmwiki-serve manifest...\n')
})

test('quickstart validation uses a timer spinner before slow manifest validation completes', async () => {
  const stdout = captureTtyWritable()
  const events = []
  const spinnerFactory = (options) => ({
    start(message) {
      events.push(['spinner-start', options.indicator, message])
    },
    stop(message) {
      events.push(['spinner-stop', message])
    },
    error(message) {
      events.push(['spinner-error', message])
    },
    clear() {
      events.push(['spinner-clear'])
    },
  })
  const answers = ['y', '1', 'y', 'n']

  await quickstart(
    { path: '.' },
    {
      stdout,
      stderr: stdout,
      forceValidationHeartbeat: true,
      createDiscoveryProgress() {
        return { start() {}, stop() {}, error() {} }
      },
      clackPrompts: { spinner: spinnerFactory },
      async prompt() {
        return answers.shift()
      },
    },
    {
      resolveServeInvocation() {
        return { command: 'mock-serve', baseArgs: [], cwd: process.cwd() }
      },
      async discoverCandidates(args) {
        return { roots: args.roots, count: 1, minScore: args.minScore, candidates: [{ rank: 1, path: 'slow-validate-wiki', score: 80, confidence: 'high', markdownCount: 20, signals: ['llmwiki-root:hot+index-or-overview', 'llmwiki-typed-dir', 'frontmatter:source_refs'] }] }
      },
      async validateCandidate(candidate) {
        events.push(['validate-start', events.length])
        assert.equal(events[0][0], 'spinner-start')
        await new Promise((resolveTick) => {
          setImmediate(resolveTick)
        })
        events.push(['validate-finish'])
        return { ...candidate, startable: true, manifest: { title: 'Slow Validate Wiki', source_id: 'slow-validate-wiki', page_count: 1, approved_page_count: 1 } }
      },
      async startSources(args) {
        return {
          configPath: args.configPath,
          sources: [{ id: 'slow-validate-wiki', title: 'Slow Validate Wiki', protocol: 'llmwiki-http', status: 'ready', selected: true, url: 'http://127.0.0.1:11001' }],
        }
      },
    },
  )

  assert.deepEqual(events.map((event) => event[0]), ['spinner-start', 'validate-start', 'validate-finish', 'spinner-clear'])
  assert.equal(events[0][1], 'timer')
  assert.equal(events[0][2], 'Validating 1 selected candidate(s) with llmwiki-serve manifest')
  assert.match(stdout.text, /Slow Validate Wiki \(slow-validate-wiki\)/)
  assert.match(stdout.text, /Coding-agent MCP registration URLs:/)
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
  assert.match(stdout.text, /Note: Full local paths are shown for disambiguation; redact them before sharing CLI output\./)
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

test('resolveServeInvocation prefers a sibling checkout venv executable for long-running serve', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-serve-invocation-'))
  const bridgeRoot = join(root, 'llmwiki-bridge-start')
  const serveRoot = join(root, 'llmwiki-serve')
  const scriptDir = process.platform === 'win32'
    ? join(serveRoot, '.venv', 'Scripts')
    : join(serveRoot, '.venv', 'bin')
  const executable = join(scriptDir, process.platform === 'win32' ? 'llmwiki-serve.exe' : 'llmwiki-serve')
  mkdirSync(bridgeRoot, { recursive: true })
  mkdirSync(scriptDir, { recursive: true })
  writeFileSync(join(serveRoot, 'pyproject.toml'), '[project]\nname = "llmwiki-serve"\n')
  writeFileSync(executable, '')

  const previousCwd = process.cwd()
  process.chdir(bridgeRoot)
  t.after(() => {
    process.chdir(previousCwd)
  })

  const invocation = resolveServeInvocation({})
  assert.equal(invocation.command, executable)
  assert.deepEqual(invocation.baseArgs, [])
  assert.equal(invocation.cwd, serveRoot)
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

test('startSources advances past an occupied requested port before checking readiness', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-start-occupied-port-'))
  const source = join(root, 'wiki')
  mkdirSync(source)
  const { server: existingServer, port: occupiedPort, nextPort } = await occupyHealthPortWithNextAvailable()
  const portFile = join(root, 'serve-port.txt')
  const serveScript = writeServeStubScript(root, { portFile })
  const configPath = join(root, 'sources.json')

  t.after(async () => {
    await closeServer(existingServer)
  })

  const result = await startSources({
    paths: [source],
    portStart: occupiedPort,
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
  assert.equal(result.sources[0].url, `http://127.0.0.1:${nextPort}`)
  assert.notEqual(result.sources[0].url, `http://127.0.0.1:${occupiedPort}`)
  assert.equal(readFileSync(portFile, 'utf8'), String(nextPort))

  const existingHealth = await fetch(`http://127.0.0.1:${occupiedPort}/health`)
  assert.equal(existingHealth.status, 200)
  assert.equal((await existingHealth.json()).status, 'existing')

  const startedHealth = await fetch(`${result.sources[0].url}/health`)
  assert.equal(startedHealth.status, 200)
  assert.equal((await startedHealth.json()).status, 'ok')

  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  assert.equal(config.sources[0].url, `http://127.0.0.1:${nextPort}`)
})

test('startSources cleans up a spawned source when /health never becomes ready', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-start-unhealthy-'))
  const source = join(root, 'wiki')
  mkdirSync(source)
  const pidFile = join(root, 'serve.pid')
  const serveScript = writeServeStubScript(root, { neverHealthy: true, pidFile })
  const port = await freePort()

  const startPromise = startSources({
    paths: [source],
    portStart: port,
    serveInvocation: { command: process.execPath, baseArgs: [serveScript], cwd: root },
    configPath: join(root, 'sources.json'),
    logDir: join(root, 'logs'),
    healthTimeoutMs: 300,
    healthIntervalMs: 50,
  })
  await waitForFile(pidFile, 1000)

  await assert.rejects(
    () => startPromise,
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
  const answers = ['y', '2x', '2', 'y', '']
  const prompts = []
  const configPath = join(mkdtempSync(join(tmpdir(), 'llmwiki-quickstart-direct-')), '.llmwiki-bridge-start', 'sources.json')
  const io = {
    stdout,
    stderr: stdout,
    async prompt(question) {
      prompts.push(question)
      return answers.shift()
    },
  }
  const candidates = [
    { rank: 1, path: 'first-wiki', score: 80, confidence: 'high', markdownCount: 20, signals: ['llmwiki-root:hot+index-or-overview', 'llmwiki-typed-dir', 'frontmatter:source_refs'] },
    { rank: 2, path: 'second-wiki', score: 70, confidence: 'high', markdownCount: 10, signals: ['obsidian:.obsidian'] },
  ]

  const result = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788', 'include-additional': true, config: configPath },
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
            processId: 2222,
            logs: { stdout: 'second-wiki.out.log', stderr: 'second-wiki.err.log' },
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
  assert.match(io.stdout.text, /Recommended source folders:/)
  assert.match(io.stdout.text, /Advanced \/ lower-priority candidates:/)
  assert.match(io.stdout.text, /Recommended source types: Native LLMWiki\/OpenWiki is a compiled projection; LLMWiki Markdown is a source-like wiki served by the Markdown adapter\./)
  assert.match(io.stdout.text, /  1\) first-wiki \[Native LLMWiki\/OpenWiki\] \(high\/80, 20 md\)/)
  assert.match(io.stdout.text, /  2\) second-wiki \[Obsidian vault\] \(high\/70, 10 md\)/)
  assert.match(io.stdout.text, /\n  all\) select all listed candidates \(advanced\)\n/)
  assert.doesNotMatch(io.stdout.text, /signals:/)
  assert.match(io.stdout.text, /Invalid candidate selection/)
  assert.match(io.stdout.text, /validation runs only if you start selected sources/)
  assert.match(io.stdout.text, /\[ok\] Discovery complete: found 2 candidate source folder\(s\)\./)
  assert(prompts.some((prompt) => /Start 1 selected source server\(s\) on loopback\?\nThis validates each selected folder first\.\n\[Y\/n\]: $/.test(prompt)))
  assert(prompts.some((prompt) => /Set up llmwiki-agent-bridge as one endpoint for the selected source\(s\)\?\nChoose yes to register these sources with a bridge or start one; choose no to finish with direct MCP URL\(s\)\.\n\[y\/N\]: $/.test(prompt)))
  assert.match(io.stdout.text, /\[choice\] Selected: Yes/)
  assert.match(io.stdout.text, /\[choice\] Selected: defaulted No/)
  assert.match(io.stdout.text, /Selected source folder\(s\):\n  - second-wiki \[Obsidian vault\]\n    second-wiki/)
  assert.match(io.stdout.text, /Simple path: llmwiki-serve alone is enough when your coding agent can register the direct source MCP URL\(s\)/)
  assert.match(io.stdout.text, /Add llmwiki-agent-bridge only when you want one A2A\/MCP-style bridge endpoint/)
  assert.match(io.stdout.text, /Runtime path: connect an already running Hermes\/DeepAgents endpoint/)
  assert.match(io.stdout.text, /If you skip bridge setup, the direct MCP Streamable HTTP URL\(s\) printed below are ready to use\./)
  assert.match(io.stdout.text, /Coding-agent MCP registration URLs:/)
  assert.match(io.stdout.text, /These are MCP-over-HTTP\/Streamable HTTP server URLs; exact client configuration syntax varies by client\./)
  assert.match(io.stdout.text, /  - http:\/\/127\.0\.0\.1:11001\/mcp\/stream/)
  assert.match(io.stdout.text, /Operational details\n/)
  assert.match(io.stdout.text, /Started source servers\s+1/)
  assert.match(io.stdout.text, /Bridge process\s+not used/)
  assert.match(io.stdout.text, /Details file\s+.*\.llmwiki-bridge-start[\\/]quickstart-handoff\.md/)
  assert.match(io.stdout.text, /Processes stay running after exit; full PIDs\/logs are in the details file\./)
  assert.match(io.stdout.text, /Safe next step: use the MCP registration URL\(s\) above/)
  assert.doesNotMatch(io.stdout.text, /second-wiki\.out\.log/)
  assert(result.runSummary?.path)
  assert(existsSync(result.runSummary.path))
  const directDetails = readFileSync(result.runSummary.path, 'utf8')
  assert.match(directDetails, /### second-wiki/)
  assert.match(directDetails, /PID 2222/)
  assert.match(directDetails, /second-wiki\.out\.log/)
  assert.doesNotMatch(io.stdout.text, /source URL:/)
  assert.doesNotMatch(io.stdout.text, /health URL:/)
  assert.doesNotMatch(io.stdout.text, /manifest URL:/)
  assert.doesNotMatch(io.stdout.text, /MCP JSON-RPC URL/)
  assert.match(io.stdout.text, /\[4\/5\] Optional bridge setup/)
  assert.match(io.stdout.text, /direct local source endpoint\(s\)/)
  assert(io.stdout.text.indexOf('Skipped bridge setup.') < io.stdout.text.indexOf('Coding-agent MCP registration URLs:'))
  assert.equal(countOccurrences(io.stdout.text, 'Coding-agent MCP registration URLs:'), 1)
  assert.equal(countOccurrences(io.stdout.text, '/mcp/stream'), 1)
  assert.equal(countOccurrences(io.stdout.text, 'Full local paths are shown for disambiguation; redact them before sharing CLI output.'), 1)
})

test('quickstart skip-bridge handoff lists one MCP stream URL for every started source', async () => {
  const stdout = captureWritable()
  const answers = ['y', 'all', 'y', 'n']
  const candidates = [
    { rank: 1, path: 'first-wiki', score: 80, confidence: 'high', markdownCount: 20, signals: ['llmwiki-root:hot+index-or-overview', 'llmwiki-typed-dir', 'frontmatter:source_refs'] },
    { rank: 2, path: 'second-wiki', score: 70, confidence: 'high', markdownCount: 10, signals: ['hub-file', 'llmwiki-typed-dir', 'name:wiki', 'markdown:50+'] },
  ]

  const result = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788' },
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
      async validateCandidate(candidate) {
        return { ...candidate, startable: true, manifest: { title: candidate.path, source_id: candidate.path, page_count: 3, approved_page_count: 3 } }
      },
      async startSources(args) {
        return {
          configPath: args.configPath,
          sources: args.paths.map((path, index) => ({
            id: path,
            name: path,
            title: path,
            protocol: 'llmwiki-http',
            status: 'ready',
            selected: index === 0,
            url: `http://127.0.0.1:${11001 + index}`,
          })),
        }
      },
    },
  )

  assert.deepEqual(result.sourceUrls, ['http://127.0.0.1:11001', 'http://127.0.0.1:11002'])
  assert.deepEqual(result.skipped, ['bridge-setup', 'register', 'smoke'])
  assert.equal(countOccurrences(stdout.text, 'Coding-agent MCP registration URLs:'), 1)
  assert.equal(countOccurrences(stdout.text, '/mcp/stream'), 2)
  assert.match(stdout.text, /  - http:\/\/127\.0\.0\.1:11001\/mcp\/stream\n  - http:\/\/127\.0\.0\.1:11002\/mcp\/stream/)
  assert.doesNotMatch(stdout.text, /source URL:/)
  assert.doesNotMatch(stdout.text, /health URL:/)
  assert.doesNotMatch(stdout.text, /manifest URL:/)
  assert.doesNotMatch(stdout.text, /MCP JSON-RPC URL/)
})

test('quickstart prints an info line when source startup falls back to another port', async () => {
  const calls = []
  const stdout = captureWritable()
  const answers = ['y', '1', 'y', 'n']
  const candidates = [
    { rank: 1, path: 'first-wiki', score: 80, confidence: 'high', markdownCount: 20, signals: ['llmwiki-root:hot+index-or-overview', 'llmwiki-typed-dir', 'frontmatter:source_refs'] },
  ]

  const result = await quickstart(
    { path: '.', port: '12001', bridge: 'http://127.0.0.1:8788' },
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
      async validateCandidate(candidate) {
        return { ...candidate, startable: true, manifest: { title: 'First Wiki', source_id: 'first-wiki', page_count: 3, approved_page_count: 3 } }
      },
      async startSources(args) {
        calls.push(['start', args])
        return {
          configPath: args.configPath,
          sources: [{
            id: 'first-wiki',
            title: 'First Wiki',
            protocol: 'llmwiki-http',
            status: 'ready',
            selected: true,
            url: 'http://127.0.0.1:12002',
            requestedPort: 12001,
            port: 12002,
            portFallback: { requestedPort: 12001, assignedPort: 12002, reason: 'requested-port-occupied' },
          }],
        }
      },
    },
  )

  assert.deepEqual(result.sourceUrls, ['http://127.0.0.1:12002'])
  assert.deepEqual(calls.find((call) => call[0] === 'start')[1].ports, [12001])
  assert.match(stdout.text, /\[info\] Requested port 12001 was occupied; started First Wiki on 12002\./)
})

test('quickstart hides additional candidates by default and selects only recommended sources', async () => {
  const calls = []
  const stdout = captureWritable()
  const answers = ['y', 'all', 'y', 'n']
  const candidates = [
    { rank: 1, path: 'recommended-native', score: 80, confidence: 'high', markdownCount: 20, signals: ['llmwiki-root:hot+index-or-overview', 'llmwiki-typed-dir', 'frontmatter:source_refs'] },
    { rank: 2, path: 'hidden-obsidian', score: 70, confidence: 'high', markdownCount: 200, signals: ['obsidian:.obsidian', 'markdown:50+'] },
    { rank: 3, path: 'starter-e2e-wiki', score: 90, confidence: 'high', markdownCount: 100, signals: ['llmwiki-marker:.wiki-compiler.json', 'markdown:50+'] },
    { rank: 4, path: join('project', 'wiki'), score: 65, confidence: 'high', markdownCount: 423, signals: ['hub-file', 'llmwiki-typed-dir', 'name:wiki', 'markdown:50+'] },
    { rank: 5, path: 'generic-notes', score: 35, confidence: 'medium', markdownCount: 12, signals: ['markdown:5+'] },
  ]

  const result = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788' },
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
        return { roots: args.roots, count: candidates.length, minScore: args.minScore, candidates }
      },
      async validateCandidate(candidate) {
        calls.push(['validate', candidate.path])
        return { ...candidate, startable: true, manifest: { title: candidate.path, source_id: candidate.path, page_count: 3, approved_page_count: 3 } }
      },
      async startSources(args) {
        calls.push(['start', args])
        return {
          configPath: args.configPath,
          sources: args.paths.map((path, index) => ({
            id: path,
            title: path,
            protocol: 'llmwiki-http',
            status: 'ready',
            selected: true,
            url: `http://127.0.0.1:${11001 + index}`,
          })),
        }
      },
    },
  )

  assert.deepEqual(calls.filter((call) => call[0] === 'validate').map((call) => call[1]), ['recommended-native', join('project', 'wiki')])
  assert.deepEqual(calls.find((call) => call[0] === 'start')[1].paths, ['recommended-native', join('project', 'wiki')])
  assert.equal(result.candidateSelection.recommendedCount, 2)
  assert.equal(result.candidateSelection.additionalCount, 3)
  assert.equal(result.candidateSelection.hiddenAdditionalCount, 3)
  assert.deepEqual(result.candidateSelection.additionalReasonCounts, {
    'app-vault': 1,
    'noisy-path': 1,
    'generic-markdown': 1,
  })
  assert.deepEqual(result.candidateSelection.hiddenAdditional.map((candidate) => candidate.path), ['hidden-obsidian', 'starter-e2e-wiki', 'generic-notes'])
  assert.match(stdout.text, /Found 2 recommended source folder\(s\)/)
  assert.match(stdout.text, /Recommended source folders:/)
  assert.match(stdout.text, /Recommended source types: Native LLMWiki\/OpenWiki is a compiled projection; LLMWiki Markdown is a source-like wiki served by the Markdown adapter\./)
  assert.match(stdout.text, /3 advanced\/lower-priority candidate\(s\) hidden by default \(1 app vault, 1 example\/demo\/starter\/e2e-like path, 1 generic Markdown\)/)
  assert.match(stdout.text, /recommended-native \[Native LLMWiki\/OpenWiki\]/)
  assert.match(stdout.text, /wiki \[LLMWiki Markdown\]/)
  assert.match(stdout.text, /\n  all\) select all listed candidates\n/)
  assert.doesNotMatch(stdout.text, /\n  all\) select all listed candidates \(advanced\)\n/)
  assert.doesNotMatch(stdout.text, /hidden-obsidian \[Obsidian vault\]/)
  assert.doesNotMatch(stdout.text, /starter-e2e-wiki/)
  assert.doesNotMatch(stdout.text, /generic-notes/)
  assert.equal(countOccurrences(stdout.text, 'Full local paths are shown for disambiguation; redact them before sharing CLI output.'), 1)
})

test('quickstart recommends strong child wiki while keeping parent app vault additional', async () => {
  const stdout = captureWritable()
  const answers = ['y', 'q']
  const vault = 'obsidian-vault'
  const childWiki = join(vault, 'wiki')
  const candidates = [
    { rank: 1, path: childWiki, score: 90, confidence: 'high', markdownCount: 80, signals: ['llmwiki-root:hot+index-or-overview', 'llmwiki-typed-dir', 'name:wiki', 'markdown:50+'] },
    { rank: 2, path: vault, score: 65, confidence: 'high', markdownCount: 120, signals: ['obsidian:.obsidian', 'markdown:50+'] },
  ]

  const defaultResult = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788' },
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

  assert.equal(defaultResult.candidateSelection.recommendedCount, 1)
  assert.equal(defaultResult.candidateSelection.additionalCount, 1)
  assert.match(stdout.text, /wiki \[LLMWiki Markdown\]/)
  assert.doesNotMatch(stdout.text, /obsidian-vault \[Obsidian vault\]/)

  const includeStdout = captureWritable()
  const includeAnswers = ['y', 'q']
  const includeResult = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788', 'include-additional': true },
    {
      stdout: includeStdout,
      stderr: includeStdout,
      async prompt() {
        return includeAnswers.shift()
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

  assert.equal(includeResult.candidateSelection.visibleCount, 2)
  assert.match(includeStdout.text, /Found 2 candidate source folder\(s\): 1 recommended and 1 advanced\/lower-priority\./)
  assert.match(includeStdout.text, /Recommended source folders:/)
  assert.match(includeStdout.text, /Advanced \/ lower-priority candidates:/)
  assert.match(includeStdout.text, /obsidian-vault \[Obsidian vault\]/)
  assert.match(includeStdout.text, /reason: app vault/)
  assert.match(includeStdout.text, /\n  all\) select all listed candidates \(advanced\)\n/)
})

test('quickstart include-additional can start an explicitly selected additional candidate', async () => {
  const calls = []
  const stdout = captureWritable()
  const answers = ['y', '3', 'y', 'n']
  const candidates = [
    { rank: 1, path: 'recommended-native', score: 80, confidence: 'high', markdownCount: 20, signals: ['llmwiki-root:hot+index-or-overview', 'llmwiki-typed-dir', 'frontmatter:source_refs'] },
    { rank: 2, path: 'hidden-obsidian', score: 70, confidence: 'high', markdownCount: 200, signals: ['obsidian:.obsidian', 'markdown:50+'] },
    { rank: 3, path: 'generic-notes', score: 35, confidence: 'medium', markdownCount: 12, signals: ['markdown:5+'] },
  ]

  const result = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788', 'include-additional': true },
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
        return { roots: args.roots, count: candidates.length, minScore: args.minScore, candidates }
      },
      async validateCandidate(candidate) {
        calls.push(['validate', candidate.path])
        return { ...candidate, startable: true, manifest: { title: candidate.path, source_id: candidate.path, page_count: 3, approved_page_count: 3 } }
      },
      async startSources(args) {
        calls.push(['start', args])
        return {
          configPath: args.configPath,
          sources: args.paths.map((path, index) => ({
            id: path,
            title: path,
            protocol: 'llmwiki-http',
            status: 'ready',
            selected: true,
            url: `http://127.0.0.1:${11001 + index}`,
          })),
        }
      },
    },
  )

  assert.equal(result.candidateSelection.visibleCount, 3)
  assert.deepEqual(result.selected.map((candidate) => candidate.path), ['generic-notes'])
  assert.deepEqual(calls.filter((call) => call[0] === 'validate').map((call) => call[1]), ['generic-notes'])
  assert.deepEqual(calls.find((call) => call[0] === 'start')[1].paths, ['generic-notes'])
  assert.match(stdout.text, /Advanced \/ lower-priority candidates:/)
  assert.match(stdout.text, /generic-notes \[Generic Markdown\]/)
  assert.match(stdout.text, /reason: generic Markdown/)
  assert.match(stdout.text, /\n  all\) select all listed candidates \(advanced\)\n/)
})

test('quickstart noisy path policy matches path tokens without substring false positives', async () => {
  const stdout = captureWritable()
  const answers = ['y', 'q']
  const candidates = [
    { rank: 1, path: join('examples', 'wiki'), score: 90, confidence: 'high', markdownCount: 80, signals: ['llmwiki-root:hot+index-or-overview', 'llmwiki-typed-dir', 'name:wiki', 'markdown:50+'] },
    { rank: 2, path: 'democracy-wiki', score: 90, confidence: 'high', markdownCount: 80, signals: ['llmwiki-root:hot+index-or-overview', 'llmwiki-typed-dir', 'name:wiki', 'markdown:50+'] },
  ]

  const result = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788' },
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

  assert.equal(result.candidateSelection.recommendedCount, 1)
  assert.equal(result.candidateSelection.additionalCount, 1)
  assert.deepEqual(result.candidateSelection.additionalReasonCounts, { 'noisy-path': 1 })
  assert.match(stdout.text, /democracy-wiki \[LLMWiki Markdown\]/)
  assert.doesNotMatch(stdout.text, /examples[\\/]+wiki/)
})

test('quickstart stops when only additional candidates exist without opt-in', async () => {
  const calls = []
  const stdout = captureWritable()
  const candidates = [
    { rank: 1, path: 'only-obsidian', score: 70, confidence: 'high', markdownCount: 200, signals: ['obsidian:.obsidian', 'markdown:50+'] },
  ]

  const result = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788' },
    {
      stdout,
      stderr: stdout,
      async prompt() {
        return 'y'
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
        return { ...candidate, startable: true }
      },
      async startSources(args) {
        calls.push(['start', args])
        return {}
      },
    },
  )

  assert.equal(result.candidateSelection.recommendedCount, 0)
  assert.equal(result.candidateSelection.additionalCount, 1)
  assert.equal(result.candidateSelection.visibleCount, 0)
  assert.deepEqual(calls.map((call) => call[0]), ['discover'])
  assert.match(stdout.text, /No recommended LLMWiki source folders found/)
  assert.match(stdout.text, /Use --include-additional to review advanced\/lower-priority/)
  assert.doesNotMatch(stdout.text, /only-obsidian \[Obsidian vault\]/)
  assert.deepEqual(result.skipped, ['selection', 'start', 'bridge-setup', 'register', 'smoke'])
})

test('quickstart include-additional shows advanced candidates when no recommended sources exist', async () => {
  const stdout = captureWritable()
  const answers = ['y', 'q']
  const candidates = [
    { rank: 1, path: 'only-obsidian', score: 70, confidence: 'high', markdownCount: 200, signals: ['obsidian:.obsidian', 'markdown:50+'] },
  ]

  const result = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788', 'include-additional': true },
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

  assert.equal(result.candidateSelection.recommendedCount, 0)
  assert.equal(result.candidateSelection.additionalCount, 1)
  assert.equal(result.candidateSelection.visibleCount, 1)
  assert.match(stdout.text, /Found 1 advanced\/lower-priority candidate source folder\(s\)/)
  assert.match(stdout.text, /Advanced \/ lower-priority candidates:/)
  assert.match(stdout.text, /only-obsidian \[Obsidian vault\]/)
  assert.match(stdout.text, /\n  all\) select all listed candidates \(advanced\)\n/)
  assert.deepEqual(result.skipped, ['start', 'bridge-setup', 'register', 'smoke'])
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

  assert.match(stdout.text, /\[\?\] Auto-discover local LLMWiki\/knowledge source folders\?\nDefault discovery scans the current user's home unless --path\/--workspace\/--cwd constrains it\.\n\[Y\/n\]:\n/)
  assert.match(stdout.text, /\[choice\] Selected: No\n/)
  assert.doesNotMatch(stdout.text, /\u001b\[/)
})

test('quickstart logs defaulted yes/no selections in transcripts', async () => {
  const stdout = captureWritable()
  const stdin = Readable.from(['\nq\n'])
  const candidates = [
    { rank: 1, path: 'defaulted-wiki', score: 80, confidence: 'high', markdownCount: 20, signals: ['llmwiki-root:hot+index-or-overview', 'llmwiki-typed-dir', 'frontmatter:source_refs'] },
  ]

  const result = await quickstart(
    {},
    { stdin, stdout, stderr: stdout },
    {
      resolveServeInvocation() {
        return { command: 'mock-serve', baseArgs: [], cwd: process.cwd() }
      },
      async discoverCandidates(args) {
        return { roots: args.roots, count: candidates.length, minScore: args.minScore, candidates }
      },
    },
  )

  assert.equal(result.autoDiscover, true)
  assert.deepEqual(result.skipped, ['start', 'bridge-setup', 'register', 'smoke'])
  assert.match(stdout.text, /\[choice\] Selected: defaulted Yes\n/)
})

test('quickstart records discovery progress start and completion in non-TTY transcripts', async () => {
  const stdout = captureWritable()
  const answers = ['y', 'q']
  const candidates = [
    { rank: 1, path: 'progress-wiki', score: 80, confidence: 'high', markdownCount: 20, signals: ['llmwiki-root:hot+index-or-overview', 'llmwiki-typed-dir', 'frontmatter:source_refs'] },
  ]

  await quickstart(
    { path: '.' },
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

  assert.match(stdout.text, /\[run\] Discovery scans candidates without validation; validation runs only if you start selected sources\.\n\[run\] Searching local folders for LLMWiki candidates\.\.\./)
  assert.match(stdout.text, /\[ok\] Discovery complete: found 1 candidate source folder\(s\)\./)
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
  assert.match(stdout.text, /\n  all\) select all listed candidates\n/)
  assert.doesNotMatch(stdout.text, /\n  all\) select all listed candidates \(advanced\)\n/)
  assert.equal(countOccurrences(stdout.text, 'Full local paths are shown for disambiguation; redact them before sharing CLI output.'), 1)
  assert.doesNotMatch(stdout.text, /Enter candidate ranks/)
})

test('quickstart candidate display adds parent context for repeated wiki basenames and llmwiki work paths', async () => {
  const stdout = captureWritable()
  const answers = ['y', 'q']
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-repeated-wiki-context-'))
  const projectAWiki = join(root, 'project-a', 'wiki')
  const projectBWiki = join(root, 'project-b', 'wiki')
  const workWiki = join(root, 'project-c', '.llmwiki-work', 'sources', 'wiki')
  const candidates = [
    { rank: 1, path: projectAWiki, score: 80, confidence: 'high', markdownCount: 20, signals: ['hub-file', 'llmwiki-typed-dir', 'name:wiki', 'markdown:50+'] },
    { rank: 2, path: projectBWiki, score: 75, confidence: 'high', markdownCount: 18, signals: ['hub-file', 'llmwiki-typed-dir', 'name:wiki', 'markdown:50+'] },
    { rank: 3, path: workWiki, score: 65, confidence: 'high', markdownCount: 12, signals: ['hub-file', 'llmwiki-typed-dir', 'name:wiki', 'markdown:50+'] },
  ]

  const result = await quickstart(
    { path: '.', 'include-additional': true },
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

  assert.deepEqual(result.skipped, ['start', 'bridge-setup', 'register', 'smoke'])
  assert.match(stdout.text, /1\) wiki — project-a \[LLMWiki Markdown\]/)
  assert.match(stdout.text, /2\) wiki — project-b \[LLMWiki Markdown\]/)
  assert.match(stdout.text, /3\) wiki — project-c\/\.llmwiki-work\/sources \[LLMWiki Markdown\]/)
  assert(stdout.text.includes(projectAWiki))
  assert(stdout.text.includes(projectBWiki))
  assert(stdout.text.includes(workWiki))
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
    { path: '.', bridge: 'http://127.0.0.1:8788', 'include-additional': true },
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
  assert.match(stdout.text, /Recommended source folders:/)
  assert.match(stdout.text, /Advanced \/ lower-priority candidates:/)
  assert.match(stdout.text, /  1\) first-wiki \[Native LLMWiki\/OpenWiki\] \(high\/80, 20 md\)/)
  assert(stdout.text.includes(firstPath))
  assert(stdout.text.includes(secondPath))
  assert(!stdout.text.includes(`${firstPath.slice(0, 93)}...`))
  assert(!stdout.text.includes(`${secondPath.slice(0, 93)}...`))
  assert.match(stdout.text, /\[4\/5\] Optional bridge setup/)
  assert.equal(countOccurrences(stdout.text, 'Full local paths are shown for disambiguation; redact them before sharing CLI output.'), 1)
  assert.deepEqual(result.skipped, ['bridge-setup', 'register', 'smoke'])
})

test('quickstart does not clear screens for redirected, non-TTY, or opted-out quickstart runs', async (t) => {
  disableCiEnvironmentForTtyTest(t)

  const redirectedStdout = captureWritable()
  await runQuickstartScreenTransitionFixture({
    stdin: ttyReadable(),
    stdout: redirectedStdout,
  })
  assert(!redirectedStdout.text.includes(ansiErase.down()))
  assert.match(redirectedStdout.text, /Selected source folder\(s\):/)

  const nonTtyInputStdout = captureTtyWritable()
  await runQuickstartScreenTransitionFixture({
    stdin: nonTtyReadable(),
    stdout: nonTtyInputStdout,
  })
  assert(!nonTtyInputStdout.text.includes(ansiErase.down()))

  const optionOptOutStdout = captureTtyWritable()
  await runQuickstartScreenTransitionFixture({
    stdin: ttyReadable(),
    stdout: optionOptOutStdout,
    options: { 'clear-screen': false },
  })
  assert(!optionOptOutStdout.text.includes(ansiErase.down()))

  const previousNoClear = process.env.LLMWIKI_BRIDGE_START_NO_CLEAR_SCREEN
  process.env.LLMWIKI_BRIDGE_START_NO_CLEAR_SCREEN = '1'
  t.after(() => {
    if (previousNoClear === undefined) {
      delete process.env.LLMWIKI_BRIDGE_START_NO_CLEAR_SCREEN
    } else {
      process.env.LLMWIKI_BRIDGE_START_NO_CLEAR_SCREEN = previousNoClear
    }
  })

  const envOptOutStdout = captureTtyWritable()
  await runQuickstartScreenTransitionFixture({
    stdin: ttyReadable(),
    stdout: envOptOutStdout,
  })
  assert(!envOptOutStdout.text.includes(ansiErase.down()))
})

test('quickstart TTY multiselect receives only recommended candidates by default', async (t) => {
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
  const answers = ['y', 'n']
  const candidates = [
    { rank: 1, path: 'recommended-native', score: 80, confidence: 'high', markdownCount: 20, signals: ['llmwiki-root:hot+index-or-overview', 'llmwiki-typed-dir', 'frontmatter:source_refs'] },
    { rank: 2, path: 'hidden-obsidian', score: 70, confidence: 'high', markdownCount: 200, signals: ['obsidian:.obsidian', 'markdown:50+'] },
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
          return [1]
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
    },
  )

  const multiselectCall = calls.find((call) => call[0] === 'multiselect')
  assert(multiselectCall)
  assert.deepEqual(multiselectCall[1].options.map((option) => option.value), [1])
  assert.equal(multiselectCall[1].options[0].label, '1) recommended-native [Native LLMWiki/OpenWiki]')
  assert(!stdout.text.includes('hidden-obsidian [Obsidian vault]'))
  assert.match(stdout.text, /\n  all\) select all listed candidates\n/)
  assert.doesNotMatch(stdout.text, /\n  all\) select all listed candidates \(advanced\)\n/)
  assert.equal(result.candidateSelection.hiddenAdditionalCount, 1)
  assert.deepEqual(result.skipped, ['start', 'bridge-setup', 'register', 'smoke'])
})

test('quickstart uses clack select for interactive runtime setup', async () => {
  const calls = []
  const prompts = []
  const stdout = captureWritable()
  const answers = ['y', '1', 'y', 'y', 'n', 'skip', 'n']

  const result = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788' },
    {
      stdout,
      stderr: stdout,
      forceInteractiveRuntimeSetup: true,
      async prompt(question) {
        prompts.push(question)
        return answers.shift()
      },
      clackPrompts: {
        async select(params) {
          calls.push(['runtime-select', params])
          return 'hermes'
        },
        isCancel() {
          return false
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
      async inspectRuntimeFramework(args) {
        calls.push(['framework', args.choice.id])
        return {
          framework: 'hermes',
          installed: false,
          installCheck: { displayCommand: 'hermes --version' },
          checks: [{ name: 'version', displayCommand: 'hermes --version', ok: false, error: 'not found' }],
          runtime: { ok: false, baseUrl: 'http://127.0.0.1:8642/v1', error: 'not running' },
          endpointDefault: { value: '', source: '' },
        }
      },
      async checkBridgeHealth(bridgeUrl) {
        calls.push(['bridge-health', bridgeUrl])
        return { ok: false, error: 'connection refused', url: bridgeUrl }
      },
      bridgeStartPlan(args) {
        calls.push(['bridge-plan', args])
        return { command: 'npx', args: ['--yes', 'llmwiki-agent-bridge@0.1.0'], packageName: 'llmwiki-agent-bridge@0.1.0' }
      },
      async startBridgeCommand() {
        throw new Error('bridge command should not run when background start is declined')
      },
    },
  )

  const runtimeSelectCall = calls.find((call) => call[0] === 'runtime-select')
  assert(runtimeSelectCall)
  assert.equal(runtimeSelectCall[1].message, 'Choose runtime setup before bridge start')
  assert.equal(runtimeSelectCall[1].initialValue, 'skip')
  assert.deepEqual(runtimeSelectCall[1].options.map((option) => option.value), ['skip', 'hermes', 'deepagents'])
  assert.deepEqual(runtimeSelectCall[1].options.map((option) => option.label), ['Skip / evidence-only', 'Hermes', 'DeepAgents'])
  assert.match(runtimeSelectCall[1].options[1].hint, /Check Hermes install/)
  assert(!stdout.text.includes('Runtime setup options:'))
  assert(!prompts.some((prompt) => /Choose runtime setup before bridge start/.test(prompt)))
  assert.equal(result.runtimeSetup.choice, 'hermes')
  assert.equal(result.runtimeSetup.configured, false)
  assert.equal(result.runtimeSetup.fallback, 'evidence-only')
  assert.match(stdout.text, /\[choice\] Runtime setup: Hermes/)
  assert.deepEqual(calls.map((call) => call[0]), ['discover', 'validate', 'start', 'runtime-select', 'framework', 'bridge-health', 'bridge-plan'])
  assert.deepEqual(result.skipped, ['register', 'smoke'])
})

test('quickstart explicit runtime setup skips the interactive runtime menu', async () => {
  const calls = []
  const stdout = captureWritable()
  const answers = ['y', '1', 'y', 'y', 'n']

  const result = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788', 'runtime-setup': 'skip' },
    {
      stdout,
      stderr: stdout,
      forceInteractiveRuntimeSetup: true,
      async prompt() {
        return answers.shift()
      },
      clackPrompts: {
        async select() {
          throw new Error('runtime select should not run when --runtime-setup is explicit')
        },
        isCancel() {
          return false
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
        return { command: 'npx', args: ['--yes', 'llmwiki-agent-bridge@0.1.0'], packageName: 'llmwiki-agent-bridge@0.1.0' }
      },
      async startBridgeCommand() {
        throw new Error('bridge command should not run when background start is declined')
      },
    },
  )

  assert.equal(result.runtimeSetup.choice, 'skip')
  assert.equal(result.runtimeSetup.configured, false)
  assert.equal(result.runtimeSetup.runtime.disabled, true)
  assert.match(stdout.text, /Using runtime setup from explicit --runtime-setup: skip\/evidence-only/)
  assert(!stdout.text.includes('Runtime setup options:'))
  assert.deepEqual(calls.map((call) => call[0]), ['discover', 'validate', 'start', 'bridge-health', 'bridge-plan'])
  assert.deepEqual(result.skipped, ['register', 'smoke'])
})

test('quickstart generates bridge setup command without executing it and runs delegated smoke when configured', async () => {
  const calls = []
  const stdout = captureWritable()
  const answers = ['y', '1', 'y', 'y', 'n', 'y']
  const prompts = []
  const bridgeUrl = 'http://127.0.0.1:9911'
  const result = await quickstart(
    { path: '.', bridge: bridgeUrl, 'llm-endpoint': 'http://127.0.0.1:8642/v1' },
    {
      stdout,
      stderr: stdout,
      async prompt(question) {
        prompts.push(question)
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
          sources: [{
            id: 'first-wiki',
            title: 'First Wiki',
            protocol: 'llmwiki-http',
            status: 'ready',
            selected: true,
            url: 'http://127.0.0.1:11001',
            processId: 5151,
            logs: { stdout: 'first-wiki.out.log', stderr: 'first-wiki.err.log' },
          }],
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
  assert.match(stdout.text, /Using preconfigured LLM runtime from explicit flags/)
  assert.doesNotMatch(stdout.text, /Runtime setup options:/)
  assert.doesNotMatch(stdout.text, /existing LLM endpoint/)
  assert.equal(result.runtimeSetup.configured, true)
  assert.equal(result.runtimeSetup.baseUrl, 'http://127.0.0.1:8642/v1')
  assert.equal(result.runtimeSetup.model, 'local-model')
  assert.equal(result.runtimeSetup.profile, 'generic')
  assert.match(stdout.text, /Simple path: llmwiki-serve alone is enough when your coding agent can register the direct source MCP URL\(s\)/)
  assert.match(stdout.text, /Add llmwiki-agent-bridge only when you want one A2A\/MCP-style bridge endpoint/)
  assert.match(stdout.text, /Runtime path: connect an already running Hermes\/DeepAgents endpoint/)
  assert.match(stdout.text, /No llmwiki-agent-bridge is reachable at http:\/\/127\.0\.0\.1:9911 yet/)
  assert.match(stdout.text, /Safe manual start examples/)
  assert.match(stdout.text, /no global install/)
  assert.match(stdout.text, /PowerShell:\n    \$env:LLMWIKI_AGENT_BRIDGE_HOST='127\.0\.0\.1'; \$env:LLMWIKI_AGENT_BRIDGE_PORT='9911'; \$env:LLMWIKI_AGENT_BRIDGE_BASE_URL='http:\/\/127\.0\.0\.1:8642\/v1'; \$env:LLMWIKI_AGENT_BRIDGE_MODEL='local-model'; \$env:LLMWIKI_AGENT_BRIDGE_RUNTIME_PROFILE='generic'; npx --yes llmwiki-agent-bridge@0\.1\.0/)
  assert.match(stdout.text, /POSIX sh\/bash\/zsh:\n    LLMWIKI_AGENT_BRIDGE_HOST='127\.0\.0\.1' LLMWIKI_AGENT_BRIDGE_PORT='9911' LLMWIKI_AGENT_BRIDGE_BASE_URL='http:\/\/127\.0\.0\.1:8642\/v1' LLMWIKI_AGENT_BRIDGE_MODEL='local-model' LLMWIKI_AGENT_BRIDGE_RUNTIME_PROFILE='generic' npx --yes llmwiki-agent-bridge@0\.1\.0/)
  assert.match(stdout.text, /LLMWIKI_AGENT_BRIDGE_HOST=127\.0\.0\.1/)
  assert.match(stdout.text, /LLMWIKI_AGENT_BRIDGE_PORT=9911/)
  assert(prompts.some((prompt) => /Set up llmwiki-agent-bridge as one endpoint for the selected source\(s\)\?\nChoose yes to register these sources with a bridge or start one; choose no to finish with direct MCP URL\(s\)\.\n\[y\/N\]: $/.test(prompt)))
  assert(prompts.some((prompt) => /Start llmwiki-agent-bridge now in the background on http:\/\/127\.0\.0\.1:9911\?\nQuickstart will run the same command with the env values above detached, write logs under .*\.llmwiki-bridge-start[\\/]logs, then wait for bridge health\.\n\[y\/N\]: $/.test(prompt)))
})

test('quickstart prints delegated deferred bridge setup next steps when runtime is configured', async () => {
  const calls = []
  const stdout = captureWritable()
  const answers = ['y', '1', 'y', 'y', 'n', 'n']
  const bridgeUrl = 'http://127.0.0.1:9912'
  const configPath = join(mkdtempSync(join(tmpdir(), 'llmwiki-quickstart-deferred-')), '.llmwiki-bridge-start', 'sources.json')

  const result = await quickstart(
    { path: '.', bridge: bridgeUrl, 'llm-endpoint': 'http://127.0.0.1:8642/v1', config: configPath },
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
          sources: [{
            id: 'first-wiki',
            title: 'First Wiki',
            protocol: 'llmwiki-http',
            status: 'ready',
            selected: true,
            url: 'http://127.0.0.1:11001',
            processId: 5151,
            logs: { stdout: 'first-wiki.out.log', stderr: 'first-wiki.err.log' },
          }],
        }
      },
      async checkBridgeHealth(url) {
        calls.push(['bridge-health', url])
        return { ok: false, error: 'connection refused', url }
      },
      bridgeStartPlan(args) {
        calls.push(['bridge-plan', args])
        return { command: 'npx', args: ['--yes', 'llmwiki-agent-bridge@0.1.0'], packageName: 'llmwiki-agent-bridge@0.1.0' }
      },
      async registerSources(args) {
        calls.push(['register', args])
        throw new Error('register should not run when deferred bridge setup is declined')
      },
      async smokeBridge(args) {
        calls.push(['smoke', args])
        throw new Error('smoke should not run when deferred bridge setup is declined')
      },
    },
  )

  assert.deepEqual(calls.map((call) => call[0]), ['discover', 'validate', 'start', 'bridge-health', 'bridge-plan'])
  assert.deepEqual(result.skipped, ['register', 'smoke'])
  assert.equal(result.bridgeSetup.continueToBridge, false)
  assert.match(stdout.text, /Bridge setup instructions generated\. Skipping registration and smoke until the bridge is running\./)
  assert.match(stdout.text, /Bridge setup next steps:/)
  assert.match(stdout.text, /llmwiki-bridge-start register --bridge http:\/\/127\.0\.0\.1:9912 --config .*sources\.json/)
  assert.equal(result.smokeMode, 'delegated-runtime')
  assert.match(stdout.text, /llmwiki-bridge-start smoke --bridge http:\/\/127\.0\.0\.1:9912 --mode delegated-runtime/)
  assert.match(stdout.text, /Direct source MCP URL\(s\) remain usable meanwhile:\n  - http:\/\/127\.0\.0\.1:11001\/mcp\/stream/)
  assert.match(stdout.text, /Operational details\n/)
  assert.match(stdout.text, /Started source servers\s+1/)
  assert.match(stdout.text, /Bridge process\s+already running or manually started/)
  assert.match(stdout.text, /Details file\s+.*\.llmwiki-bridge-start[\\/]quickstart-handoff\.md/)
  assert.match(stdout.text, /Processes stay running after exit; full PIDs\/logs are in the details file\./)
  assert.match(stdout.text, /Safe next step: start the bridge with a manual example above, then run the register\/smoke commands shown above\./)
  assert.doesNotMatch(stdout.text, /first-wiki\.out\.log/)
  assert(result.runSummary?.path)
  assert(existsSync(result.runSummary.path))
  const deferredDetails = readFileSync(result.runSummary.path, 'utf8')
  assert.match(deferredDetails, /### First Wiki/)
  assert.match(deferredDetails, /PID 5151/)
  assert.match(deferredDetails, /first-wiki\.out\.log/)
  assert.match(deferredDetails, /Smoke mode: delegated-runtime/)
  assert.match(deferredDetails, /llmwiki-bridge-start smoke --bridge http:\/\/127\.0\.0\.1:9912 --mode delegated-runtime/)
  assert.match(deferredDetails, /already running or manually started; PID\/log path not captured by quickstart/)
})

test('quickstart keeps deferred bridge smoke next steps evidence-only when runtime is skipped', async () => {
  const calls = []
  const stdout = captureWritable()
  const answers = ['y', '1', 'y', 'y', '1', 'n', 'n']
  const bridgeUrl = 'http://127.0.0.1:9913'
  const configPath = join(mkdtempSync(join(tmpdir(), 'llmwiki-quickstart-deferred-skip-')), '.llmwiki-bridge-start', 'sources.json')

  const result = await quickstart(
    { path: '.', bridge: bridgeUrl, config: configPath },
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
          sources: [{
            id: 'first-wiki',
            title: 'First Wiki',
            protocol: 'llmwiki-http',
            status: 'ready',
            selected: true,
            url: 'http://127.0.0.1:11001',
            processId: 5152,
            logs: { stdout: 'first-wiki.out.log', stderr: 'first-wiki.err.log' },
          }],
        }
      },
      async checkBridgeHealth(url) {
        calls.push(['bridge-health', url])
        return { ok: false, error: 'connection refused', url }
      },
      bridgeStartPlan(args) {
        calls.push(['bridge-plan', args])
        return { command: 'npx', args: ['--yes', 'llmwiki-agent-bridge@0.1.0'], packageName: 'llmwiki-agent-bridge@0.1.0' }
      },
      async registerSources(args) {
        calls.push(['register', args])
        throw new Error('register should not run when deferred bridge setup is declined')
      },
      async smokeBridge(args) {
        calls.push(['smoke', args])
        throw new Error('smoke should not run when deferred bridge setup is declined')
      },
    },
  )

  assert.deepEqual(calls.map((call) => call[0]), ['discover', 'validate', 'start', 'bridge-health', 'bridge-plan'])
  assert.deepEqual(result.skipped, ['register', 'smoke'])
  assert.equal(result.smokeMode, 'evidence-only')
  assert.match(stdout.text, /Runtime setup: skip\/evidence-only/)
  assert.match(stdout.text, /llmwiki-bridge-start smoke --bridge http:\/\/127\.0\.0\.1:9913 --mode evidence-only/)
  const deferredDetails = readFileSync(result.runSummary.path, 'utf8')
  assert.match(deferredDetails, /Smoke mode: evidence-only/)
  assert.match(deferredDetails, /llmwiki-bridge-start smoke --bridge http:\/\/127\.0\.0\.1:9913 --mode evidence-only/)
})

test('quickstart registers started sources after starting bridge and passing health', async () => {
  const calls = []
  const stdout = captureWritable()
  const answers = ['y', '1', 'y', 'y', '2', 'http://127.0.0.1:9999/v1', 'demo-model', 'y']
  const configPath = join(mkdtempSync(join(tmpdir(), 'llmwiki-quickstart-bridge-')), '.llmwiki-bridge-start', 'sources.json')

  const result = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788', config: configPath },
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
          sources: [{
            id: 'first-wiki',
            title: 'First Wiki',
            protocol: 'llmwiki-http',
            status: 'ready',
            selected: true,
            url: 'http://127.0.0.1:11001',
            processId: 5151,
            logs: { stdout: 'first-wiki.out.log', stderr: 'first-wiki.err.log' },
          }],
        }
      },
      async checkBridgeHealth(bridgeUrl) {
        calls.push(['bridge-health', bridgeUrl])
        return { ok: false, error: 'connection refused', url: bridgeUrl }
      },
      bridgeStartPlan(args) {
        calls.push(['bridge-plan', args])
        return { command: 'npx.cmd', args: ['--yes', 'llmwiki-agent-bridge@0.1.0'], packageName: 'llmwiki-agent-bridge@0.1.0' }
      },
      async startBridgeCommand(plan, args) {
        calls.push(['bridge-start', plan, args])
        return { processId: 4242, logs: { stdout: 'bridge.out.log', stderr: 'bridge.err.log' } }
      },
      async waitForBridgeHealth(bridgeUrl, args) {
        calls.push(['bridge-wait', bridgeUrl, args])
        return { ok: true, status: 'ok', url: bridgeUrl }
      },
      async probeRuntimeEndpoint(args) {
        calls.push(['runtime-probe', args])
        return args.baseUrl === 'http://127.0.0.1:9999/v1'
          ? { ok: true, profile: args.profile, baseUrl: args.baseUrl, url: 'http://127.0.0.1:9999/health', status: 'ok' }
          : { ok: false, profile: args.profile, baseUrl: args.baseUrl, error: 'not running' }
      },
      async inspectRuntimeFramework(args) {
        calls.push(['framework', args.choice.id])
        return {
          framework: 'hermes',
          installed: true,
          version: '1.2.3',
          installCheck: { displayCommand: 'hermes --version' },
          checks: [
            { name: 'version', displayCommand: 'hermes --version', ok: true },
            { name: 'status', displayCommand: 'hermes status', ok: true },
            { name: 'doctor', displayCommand: 'hermes doctor', ok: true },
          ],
          runtime: { ok: true, baseUrl: 'http://127.0.0.1:9999/v1', url: 'http://127.0.0.1:9999/health' },
          endpointDefault: {
            value: 'http://127.0.0.1:9999/v1',
            source: 'Hermes /health',
            verified: true,
            health: { ok: true, baseUrl: 'http://127.0.0.1:9999/v1', url: 'http://127.0.0.1:9999/health', status: 'ok' },
          },
        }
      },
      async registerSources(args) {
        calls.push(['register', args])
        return {
          bridgeUrl: args.bridgeUrl,
          replace: args.replace,
          payload: {
            sources: [
              { id: 'existing-one', selected: false, url: 'http://127.0.0.1:12001' },
              { id: 'existing-two', selected: false, url: 'http://127.0.0.1:12002' },
              { id: 'first-wiki', selected: true, url: 'http://127.0.0.1:11001' },
              { id: 'existing-three', selected: false, url: 'http://127.0.0.1:12003' },
              { id: 'existing-four', selected: false, url: 'http://127.0.0.1:12004' },
            ],
          },
          response: { ok: true },
        }
      },
      async selectBridgeSmokeMode(args) {
        calls.push(['smoke-mode', args])
        assert.equal(args.options.llmEndpoint, 'http://127.0.0.1:9999/v1')
        assert.equal(args.options.llmModel, 'demo-model')
        assert.equal(args.options.runtimeProfile, 'hermes')
        return { mode: 'delegated-runtime', reason: 'test runtime configured' }
      },
      async smokeBridge(args) {
        calls.push(['smoke', args])
        return { bridgeUrl: args.bridgeUrl, mode: args.mode, status: { state: 'completed' }, text: '' }
      },
    },
  )

  assert.deepEqual(calls.map((call) => call[0]), ['discover', 'validate', 'start', 'framework', 'runtime-probe', 'bridge-health', 'bridge-plan', 'bridge-start', 'bridge-wait', 'register', 'smoke-mode', 'smoke'])
  assert.equal(result.bridgeSetup.executed, true)
  assert.equal(result.bridgeSetup.continueToBridge, true)
  assert.equal(result.bridgeSetup.health.ok, true)
  assert.equal(result.runtimeSetup.configured, true)
  assert.equal(result.runtimeSetup.baseUrl, 'http://127.0.0.1:9999/v1')
  assert.equal(result.runtimeSetup.model, 'demo-model')
  assert.equal(result.runtimeSetup.profile, 'hermes')
  assert.equal(calls.find((call) => call[0] === 'bridge-start')[2].runtime.configured, true)
  assert.equal(calls.find((call) => call[0] === 'bridge-start')[2].runtime.baseUrl, 'http://127.0.0.1:9999/v1')
  assert.equal(calls.find((call) => call[0] === 'smoke')[1].mode, 'delegated-runtime')
  assert.deepEqual([...calls.find((call) => call[0] === 'register')[1].selectedIds], ['first-wiki'])
  assert.equal(calls.find((call) => call[0] === 'register')[1].configPath, result.started.configPath)
  assert.equal(calls.find((call) => call[0] === 'register')[1].replace, false)
  assert.match(stdout.text, /Registered 5 total bridge source\(s\); 1 selected for this quickstart\. Register merges by default unless --replace is set\./)
  assert.match(stdout.text, /Operational details\n/)
  assert.match(stdout.text, /Started source servers\s+1/)
  assert.match(stdout.text, /Bridge process\s+started by quickstart/)
  assert.match(stdout.text, /Details file\s+.*\.llmwiki-bridge-start[\\/]quickstart-handoff\.md/)
  assert.match(stdout.text, /Processes stay running after exit; full PIDs\/logs are in the details file\./)
  assert.match(stdout.text, /Safe next step: connect your agent or script to the bridge endpoint above\./)
  const operationalDetails = stdout.text.slice(stdout.text.indexOf('Operational details'))
  assert.doesNotMatch(operationalDetails, /first-wiki\.out\.log/)
  assert.doesNotMatch(operationalDetails, /bridge\.out\.log/)
  assert(result.runSummary?.path)
  assert(existsSync(result.runSummary.path))
  const bridgeDetails = readFileSync(result.runSummary.path, 'utf8')
  assert.match(bridgeDetails, /### First Wiki/)
  assert.match(bridgeDetails, /PID 5151/)
  assert.match(bridgeDetails, /first-wiki\.out\.log/)
  assert.match(bridgeDetails, /PID 4242/)
  assert.match(bridgeDetails, /bridge\.out\.log/)
  assert.deepEqual(result.skipped, [])
})

test('quickstart prints final bridge handoff after successful smoke', async () => {
  const stdout = captureWritable()
  const answers = ['y', '1', 'y', 'y', '1']
  const bridgeUrl = 'http://127.0.0.1:8788'

  const result = await quickstart(
    { path: '.', bridge: bridgeUrl },
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
        return {
          roots: args.roots,
          count: 1,
          minScore: args.minScore,
          candidates: [{ rank: 1, path: 'first-wiki', score: 80, confidence: 'high', markdownCount: 20, signals: ['llmwiki-root:hot+index-or-overview', 'llmwiki-typed-dir', 'frontmatter:source_refs'] }],
        }
      },
      async validateCandidate(candidate) {
        return { ...candidate, startable: true, manifest: { title: 'First Wiki', source_id: 'first-wiki', page_count: 3, approved_page_count: 3 } }
      },
      async startSources(args) {
        return {
          configPath: args.configPath,
          sources: [{ id: 'first-wiki', title: 'First Wiki', protocol: 'llmwiki-http', status: 'ready', selected: true, url: 'http://127.0.0.1:11001' }],
        }
      },
      async checkBridgeHealth(url) {
        return { ok: true, status: 'ok', url }
      },
      async registerSources(args) {
        return {
          bridgeUrl: args.bridgeUrl,
          replace: args.replace,
          payload: { sources: [{ id: 'first-wiki', selected: true, url: 'http://127.0.0.1:11001' }] },
          response: { ok: true },
        }
      },
      async selectBridgeSmokeMode() {
        return { mode: 'evidence-only', reason: 'test bridge settings' }
      },
      async smokeBridge(args) {
        return { bridgeUrl: args.bridgeUrl, mode: args.mode, status: { state: 'completed' }, text: '' }
      },
    },
  )

  assert.deepEqual(result.skipped, [])
  assert.match(stdout.text, /Smoke complete: completed/)
  const handoffStart = stdout.text.indexOf('Bridge handoff')
  assert.notEqual(handoffStart, -1)
  const handoff = stdout.text.slice(handoffStart)
  assert.match(handoff, /Bridge handoff\n\n  ─+\n  Ready bridge endpoints/)
  assert.match(handoff, /MCP JSON-RPC\s+POST http:\/\/127\.0\.0\.1:8788\/mcp/)
  assert.match(handoff, /A2A answer\s+POST http:\/\/127\.0\.0\.1:8788\/message:send/)
  assert.match(handoff, /Settings\s+http:\/\/127\.0\.0\.1:8788\/settings/)
  assert.match(handoff, /Base URL\s+http:\/\/127\.0\.0\.1:8788/)
  assert.match(handoff, /Use the endpoint your agent or script supports; exact client configuration syntax varies by client\./)
  assert.doesNotMatch(handoff, /Streamable HTTP/)
  assert.doesNotMatch(handoff, /mcp\/stream/)
})

test('quickstart applies Hermes runtime settings to an already running bridge', async (t) => {
  const previousHermesBaseUrl = process.env.HERMES_BASE_URL
  const previousHermesModel = process.env.HERMES_MODEL
  t.after(() => {
    if (previousHermesBaseUrl === undefined) {
      delete process.env.HERMES_BASE_URL
    } else {
      process.env.HERMES_BASE_URL = previousHermesBaseUrl
    }
    if (previousHermesModel === undefined) {
      delete process.env.HERMES_MODEL
    } else {
      process.env.HERMES_MODEL = previousHermesModel
    }
  })
  process.env.HERMES_BASE_URL = 'http://legacy-hermes-env.example.invalid:8642/v1'
  process.env.HERMES_MODEL = 'pc-custom-hermes-model'

  const calls = []
  const stdout = captureWritable()
  const answers = ['y', '1', 'y', 'y', '2', 'http://127.0.0.1:9999/v1', '']
  const prompts = []
  const endpointPromptSnapshots = []

  const result = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788' },
    {
      stdout,
      stderr: stdout,
      async prompt(question) {
        prompts.push(question)
        if (/Hermes runtime base URL/.test(question)) {
          endpointPromptSnapshots.push(stdout.text)
        }
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
      async configureBridgeRuntime(args) {
        calls.push(['configure-runtime', args])
        return { ok: true, skipped: false, response: { status: 'saved', applied: ['runtimeProfile', 'baseUrl', 'model'] } }
      },
      async probeRuntimeEndpoint(args) {
        calls.push(['runtime-probe', args])
        return args.baseUrl === 'http://127.0.0.1:9999/v1'
          ? { ok: true, profile: args.profile, baseUrl: args.baseUrl, url: 'http://127.0.0.1:9999/health', status: 'ok' }
          : { ok: false, profile: args.profile, baseUrl: args.baseUrl, error: 'not running' }
      },
      async inspectRuntimeFramework(args) {
        calls.push(['framework', args.choice.id])
        return {
          framework: 'hermes',
          installed: true,
          version: '1.2.3',
          installCheck: { displayCommand: 'hermes --version' },
          checks: [
            { name: 'version', displayCommand: 'hermes --version', ok: true },
            { name: 'status', displayCommand: 'hermes status', ok: true },
            { name: 'doctor', displayCommand: 'hermes doctor', ok: true },
          ],
          runtime: { ok: false, baseUrl: 'http://127.0.0.1:8642/v1', error: 'not running' },
          endpointDefault: {
            value: '',
            source: '',
            probes: [{ baseUrl: 'http://127.0.0.1:8642/v1', source: 'Hermes /health', health: { ok: false, error: 'not running' } }],
          },
        }
      },
      async registerSources(args) {
        calls.push(['register', args])
        return {
          bridgeUrl: args.bridgeUrl,
          replace: args.replace,
          response: { ok: true },
        }
      },
      async selectBridgeSmokeMode(args) {
        calls.push(['smoke-mode', args])
        assert.equal(args.options.llmEndpoint, 'http://127.0.0.1:9999/v1')
        assert.equal(args.options.llmModel, 'hermes-agent')
        assert.equal(args.options.runtimeProfile, 'hermes')
        return { mode: 'delegated-runtime', reason: 'test Hermes runtime configured' }
      },
      async smokeBridge(args) {
        calls.push(['smoke', args])
        return { bridgeUrl: args.bridgeUrl, mode: args.mode, status: { state: 'completed' }, text: '' }
      },
    },
  )

  assert.deepEqual(calls.map((call) => call[0]), ['discover', 'validate', 'start', 'framework', 'runtime-probe', 'bridge-health', 'configure-runtime', 'register', 'smoke-mode', 'smoke'])
  assert.equal(result.runtimeSetup.configured, true)
  assert.equal(result.runtimeSetup.profile, 'hermes')
  assert.equal(result.runtimeSetup.model, 'hermes-agent')
  assert.equal(result.bridgeSetup.executed, false)
  assert.equal(result.bridgeSetup.runtimeConfiguration.ok, true)
  assert.equal(calls.find((call) => call[0] === 'configure-runtime')[1].runtime.profile, 'hermes')
  assert.equal(calls.find((call) => call[0] === 'configure-runtime')[1].runtime.baseUrl, 'http://127.0.0.1:9999/v1')
  assert.equal(calls.find((call) => call[0] === 'smoke')[1].mode, 'delegated-runtime')
  assert.match(stdout.text, /Registered 1 total bridge source\(s\); 1 selected for this quickstart/)
  assert.match(stdout.text, /Hermes CLI is installed\. QuickStart will not run an installer\./)
  assert.match(stdout.text, /Hermes install: `hermes --version` detected/)
  assert.match(stdout.text, /Hermes supported checks: status ok; doctor ok/)
  assert.doesNotMatch(stdout.text, /hermes config show --json/)
  assert.match(stdout.text, /Hermes runtime: CLI is installed, but no supported API health endpoint responded/)
  assert.match(stdout.text, /Hermes health check passed: http:\/\/127\.0\.0\.1:9999\/health/)
  assert.match(stdout.text, /Applying runtime settings to the running bridge/)
  assert(prompts.some((prompt) => /Hermes runtime base URL \(OpenAI-compatible, e\.g\. http:\/\/127\.0\.0\.1:8642\/v1; press Enter or type skip to continue evidence-only\)/.test(prompt)))
  assert(endpointPromptSnapshots.some((snapshot) => /Hermes install: `hermes --version` detected/.test(snapshot)))
  assert(endpointPromptSnapshots.some((snapshot) => /Hermes runtime: CLI is installed, but no supported API health endpoint responded/.test(snapshot)))
  assert(!stdout.text.includes('legacy-hermes-env.example.invalid'))
  assert(!prompts.join('\n').includes('legacy-hermes-env.example.invalid'))
  assert(!stdout.text.includes('pc-custom-hermes-model'))
})

test('quickstart guides DeepAgents runtime setup without endpoint inference when install is unavailable', async () => {
  const calls = []
  const stdout = captureWritable()
  const answers = ['y', '1', 'y', 'y', '3', 'skip', 'n', 'n']
  const prompts = []
  const endpointPromptSnapshots = []

  const result = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788' },
    {
      stdout,
      stderr: stdout,
      async prompt(question) {
        prompts.push(question)
        if (/DeepAgents runtime base URL/.test(question)) {
          endpointPromptSnapshots.push(stdout.text)
        }
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
        return { command: 'npx', args: ['--yes', 'llmwiki-agent-bridge@0.1.0'], packageName: 'llmwiki-agent-bridge@0.1.0' }
      },
      async inspectRuntimeFramework(args) {
        calls.push(['framework', args.choice.id])
        return {
          framework: 'deepagents',
          supported: true,
          command: 'dcode',
          installed: false,
          installCheck: { displayCommand: 'dcode --version' },
          checks: [
            { name: 'version', displayCommand: 'dcode --version', ok: false, error: 'CLI not detected' },
            { name: 'doctor', displayCommand: 'dcode doctor', ok: false, skipped: true },
            { name: 'config', displayCommand: 'dcode config show --json', ok: false, skipped: true },
          ],
          runtime: {
            ok: false,
            skipped: true,
            reason: 'DeepAgents Code has supported CLI diagnostics, but no registered local OpenAI-compatible runtime endpoint discovery contract in quickstart.',
          },
          endpointDefault: { value: '', source: '' },
          docs: {
            overview: 'https://docs.langchain.com/oss/python/deepagents/code/overview',
            configuration: 'https://docs.langchain.com/oss/python/deepagents/code/configuration',
          },
        }
      },
      runtimeInstallPlan(choice) {
        calls.push(['install-plan', choice.id])
        return {
          runtime: 'deepagents',
          autoInstallAvailable: false,
          command: null,
          args: [],
          reason: 'test fixture has no installer',
          docs: {
            install: 'https://docs.langchain.com/oss/python/deepagents/code/quickstart',
            providers: 'https://docs.langchain.com/oss/python/deepagents/code/providers',
          },
        }
      },
      async installRuntime() {
        throw new Error('runtime installer should not run when install plan is unavailable')
      },
      async startBridgeCommand(plan, args) {
        calls.push(['bridge-start', plan, args])
        throw new Error('bridge command should not run when background start is declined')
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

  assert.deepEqual(calls.map((call) => call[0]), ['discover', 'validate', 'start', 'install-plan', 'framework', 'bridge-health', 'bridge-plan'])
  assert.equal(result.runtimeSetup.choice, 'deepagents')
  assert.equal(result.runtimeSetup.configured, false)
  assert.equal(result.runtimeSetup.fallback, 'evidence-only')
  assert.equal(result.runtimeSetup.runtime.disabled, true)
  assert.deepEqual(result.skipped, ['register', 'smoke'])
  assert.match(stdout.text, /Runtime setup options:/)
  assert.match(stdout.text, /Hermes/)
  assert.match(stdout.text, /DeepAgents/)
  assert.doesNotMatch(stdout.text, /existing LLM endpoint/)
  assert.doesNotMatch(stdout.text, /\n  4\)/)
  assert.match(stdout.text, /QuickStart cannot auto-install DeepAgents Code on this OS\. test fixture has no installer/)
  assert.match(stdout.text, /DeepAgents Code install: `dcode --version` was not detected on PATH/)
  assert.match(stdout.text, /DeepAgents Code runtime: no supported OpenAI-compatible local endpoint discovery method is recorded/)
  assert.match(stdout.text, /--runtime-profile deepagents/)
  assert.match(stdout.text, /No runtime endpoint entered\. Continuing with evidence-only bridge mode/)
  assert.doesNotMatch(stdout.text, /Start DeepAgents so it exposes an OpenAI-compatible endpoint/)
  assert(prompts.some((prompt) => /Optional bridge runtime base URL \(OpenAI-compatible; DeepAgents is checked via dcode, but no DeepAgents endpoint is inferred; press Enter or type skip to continue evidence-only\)/.test(prompt)))
})

test('quickstart applies explicit DeepAgents ACP adapter to an already running bridge without endpoint prompt', async (t) => {
  const calls = []
  const stdout = captureWritable()
  const answers = ['y', '1', 'y', 'y']
  const prompts = []
  const inheritedRuntimeEnv = [
    'LLMWIKI_AGENT_BRIDGE_MODEL',
    'LLMWIKI_AGENT_BRIDGE_RUNTIME_PROFILE',
  ]
  const previousRuntimeEnv = new Map(inheritedRuntimeEnv.map((key) => [key, process.env[key]]))
  t.after(() => {
    for (const [key, value] of previousRuntimeEnv) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })
  process.env.LLMWIKI_AGENT_BRIDGE_MODEL = 'parent-shell-model'
  process.env.LLMWIKI_AGENT_BRIDGE_RUNTIME_PROFILE = 'generic'

  const result = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788', 'runtime-adapter': 'deepagents-acp', 'runtime-profile': 'generic', 'llm-model': 'cli-deepagents-model' },
    {
      stdout,
      stderr: stdout,
      async prompt(question) {
        prompts.push(question)
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
      runtimeInstallPlan(choice) {
        calls.push(['install-plan', choice.id])
        return {
          runtime: 'deepagents',
          autoInstallAvailable: false,
          command: null,
          args: [],
          reason: 'test fixture does not install',
        }
      },
      async inspectRuntimeFramework(args) {
        calls.push(['framework', args.choice.id])
        return {
          framework: 'deepagents',
          supported: true,
          installed: true,
          version: '2.0.0',
          installCheck: { displayCommand: 'dcode --version' },
          checks: [{ name: 'version', displayCommand: 'dcode --version', ok: true }],
          runtime: {
            ok: false,
            skipped: true,
            reason: 'DeepAgents Code has supported CLI diagnostics, but no registered local OpenAI-compatible runtime endpoint discovery contract in quickstart.',
          },
          endpointDefault: { value: '', source: '' },
        }
      },
      async checkBridgeHealth(bridgeUrl) {
        calls.push(['bridge-health', bridgeUrl])
        return { ok: true, status: 'ok', url: bridgeUrl }
      },
      async configureBridgeRuntime(args) {
        calls.push(['configure-runtime', args])
        return { ok: true, skipped: false, response: { status: 'saved', applied: ['runtimeProfile', 'runtimeAdapter', 'model'] } }
      },
      async registerSources(args) {
        calls.push(['register', args])
        return {
          bridgeUrl: args.bridgeUrl,
          replace: args.replace,
          response: { ok: true },
        }
      },
      async selectBridgeSmokeMode(args) {
        calls.push(['smoke-mode', args])
        assert.equal(args.options.runtimeAdapter, 'deepagents-acp')
        return { mode: 'delegated-runtime', reason: 'explicit runtime adapter configured (deepagents-acp)' }
      },
      async smokeBridge(args) {
        calls.push(['smoke', args])
        return { bridgeUrl: args.bridgeUrl, mode: args.mode, status: { state: 'completed' }, text: '' }
      },
    },
  )

  assert.deepEqual(calls.map((call) => call[0]), ['discover', 'validate', 'start', 'install-plan', 'framework', 'bridge-health', 'configure-runtime', 'register', 'smoke-mode', 'smoke'])
  assert.equal(result.runtimeSetup.choice, 'deepagents')
  assert.equal(result.runtimeSetup.configured, true)
  assert.equal(result.runtimeSetup.profile, 'deepagents')
  assert.equal(result.runtimeSetup.model, 'cli-deepagents-model')
  assert.equal(result.runtimeSetup.runtimeAdapter, 'deepagents-acp')
  assert.equal(result.runtimeSetup.baseUrl, '')
  assert.equal(result.runtimeSetup.runtimeOptions.runtimeProfile, 'deepagents')
  assert.equal(result.runtimeSetup.runtimeOptions.llmModel, 'cli-deepagents-model')
  assert.equal(result.bridgeSetup.runtimeConfiguration.ok, true)
  const runtime = calls.find((call) => call[0] === 'configure-runtime')[1].runtime
  assert.equal(runtime.profile, 'deepagents')
  assert.equal(runtime.model, 'cli-deepagents-model')
  assert.equal(runtime.runtimeAdapter, 'deepagents-acp')
  assert.equal(runtime.baseUrl, '')
  const smokeModeOptions = calls.find((call) => call[0] === 'smoke-mode')[1].options
  assert.equal(smokeModeOptions.runtimeProfile, 'deepagents')
  assert.equal(smokeModeOptions.llmModel, 'cli-deepagents-model')
  assert.equal(calls.find((call) => call[0] === 'smoke')[1].mode, 'delegated-runtime')
  assert.match(stdout.text, /Using runtime setup from explicit --runtime-adapter deepagents-acp: DeepAgents/)
  assert.match(stdout.text, /DeepAgents ACP adapter selected explicitly/)
  assert.doesNotMatch(prompts.join('\n'), /runtime base URL/)
})

test('quickstart installs a missing Hermes CLI only after explicit approval and rechecks before endpoint setup', async () => {
  const calls = []
  const stdout = captureWritable()
  const answers = ['y', '1', 'y', 'y', '2', 'y', '', '', 'n', 'n']
  const inspectResults = [
    {
      framework: 'hermes',
      supported: true,
      command: 'hermes',
      installed: false,
      installCheck: { displayCommand: 'hermes --version' },
      checks: [{ name: 'version', displayCommand: 'hermes --version', ok: false, error: 'CLI not detected' }],
      runtime: { ok: false, baseUrl: 'http://127.0.0.1:8642/v1', error: 'not running' },
      endpointDefault: { value: '', source: '' },
    },
    {
      framework: 'hermes',
      supported: true,
      command: 'hermes',
      installed: true,
      version: '1.2.3',
      installCheck: { displayCommand: 'hermes --version' },
      checks: [{ name: 'version', displayCommand: 'hermes --version', ok: true }],
      runtime: { ok: true, baseUrl: 'http://127.0.0.1:8642/v1', url: 'http://127.0.0.1:8642/health' },
      endpointDefault: {
        value: 'http://127.0.0.1:8642/v1',
        source: 'Hermes /health',
        verified: true,
        health: { ok: true, url: 'http://127.0.0.1:8642/health' },
      },
    },
  ]

  const result = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788' },
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
      runtimeInstallPlan(choice) {
        calls.push(['install-plan', choice.id])
        return {
          runtime: 'hermes',
          autoInstallAvailable: true,
          mode: 'remote-script',
          url: 'https://hermes-agent.nousresearch.com/install.sh',
          runner: { command: 'bash', argsBeforeScript: [] },
          scriptExtension: '.sh',
          displayCommand: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash',
          sourceUrl: 'https://hermes-agent.nousresearch.com/docs/',
          docs: { install: 'https://hermes-agent.nousresearch.com/docs/' },
          afterInstall: 'run `hermes setup --portal`, enable the API server, then run `hermes gateway` until /health responds.',
        }
      },
      async inspectRuntimeFramework(args) {
        calls.push(['framework', args.choice.id])
        return inspectResults.shift()
      },
      async installRuntime(plan) {
        calls.push(['install', plan])
        return { ok: true, command: plan, logs: { stdout: 'hermes-install.out.log', stderr: 'hermes-install.err.log' } }
      },
      async probeRuntimeEndpoint(args) {
        calls.push(['runtime-probe', args.baseUrl])
        return { ok: true, url: 'http://127.0.0.1:8642/health' }
      },
      async checkBridgeHealth(bridgeUrl) {
        calls.push(['bridge-health', bridgeUrl])
        return { ok: false, error: 'connection refused', url: bridgeUrl }
      },
      bridgeStartPlan(args) {
        calls.push(['bridge-plan', args])
        return { command: 'npx', args: ['--yes', 'llmwiki-agent-bridge@0.1.0'], packageName: 'llmwiki-agent-bridge@0.1.0' }
      },
      async startBridgeCommand() {
        throw new Error('bridge command should not run when background start is declined')
      },
    },
  )

  assert.deepEqual(calls.map((call) => call[0]), ['discover', 'validate', 'start', 'install-plan', 'framework', 'install', 'framework', 'runtime-probe', 'bridge-health', 'bridge-plan'])
  assert.equal(result.runtimeSetup.choice, 'hermes')
  assert.equal(result.runtimeSetup.configured, true)
  assert.equal(result.runtimeSetup.baseUrl, 'http://127.0.0.1:8642/v1')
  assert.equal(result.runtimeSetup.model, 'hermes-agent')
  assert.equal(result.runtimeSetup.profile, 'hermes')
  assert.match(stdout.text, /Hermes official install command is available for this OS/)
  assert.match(stdout.text, /Official install command: curl -fsSL https:\/\/hermes-agent\.nousresearch\.com\/install\.sh \| bash/)
  assert.match(stdout.text, /Installing Hermes with official installer/)
  assert.match(stdout.text, /Hermes installer completed; logs: hermes-install\.out\.log, hermes-install\.err\.log/)
  assert.match(stdout.text, /Rechecking Hermes CLI after install/)
  assert.match(stdout.text, /Hermes install: `hermes --version` detected/)
  assert.deepEqual(result.skipped, ['register', 'smoke'])
})

test('quickstart --yes does not run runtime installers unless --install-runtime is explicit', async () => {
  const calls = []
  const stdout = captureWritable()

  const result = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788', yes: true, setupBridge: true, runtimeSetup: 'hermes' },
    {
      stdout,
      stderr: stdout,
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
      runtimeInstallPlan(choice) {
        calls.push(['install-plan', choice.id])
        return {
          runtime: 'hermes',
          autoInstallAvailable: true,
          mode: 'remote-script',
          url: 'https://hermes-agent.nousresearch.com/install.sh',
          runner: { command: 'bash', argsBeforeScript: [] },
          scriptExtension: '.sh',
          displayCommand: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash',
          sourceUrl: 'https://hermes-agent.nousresearch.com/docs/',
          docs: { install: 'https://hermes-agent.nousresearch.com/docs/' },
        }
      },
      async inspectRuntimeFramework(args) {
        calls.push(['framework', args.choice.id])
        return {
          framework: 'hermes',
          installed: false,
          installCheck: { displayCommand: 'hermes --version' },
          checks: [{ name: 'version', displayCommand: 'hermes --version', ok: false, error: 'CLI not detected' }],
          runtime: { ok: false, baseUrl: 'http://127.0.0.1:8642/v1', error: 'not running' },
          endpointDefault: { value: '', source: '' },
        }
      },
      async installRuntime() {
        throw new Error('runtime installer should not run from --yes without --install-runtime')
      },
      async checkBridgeHealth(bridgeUrl) {
        calls.push(['bridge-health', bridgeUrl])
        return { ok: false, error: 'connection refused', url: bridgeUrl }
      },
      bridgeStartPlan(args) {
        calls.push(['bridge-plan', args])
        return { command: 'npx', args: ['--yes', 'llmwiki-agent-bridge@0.1.0'], packageName: 'llmwiki-agent-bridge@0.1.0' }
      },
      async startBridgeCommand() {
        throw new Error('bridge command should not run when background start default is no')
      },
    },
  )

  assert.deepEqual(calls.map((call) => call[0]), ['discover', 'validate', 'start', 'install-plan', 'framework', 'bridge-health', 'bridge-plan'])
  assert.equal(result.runtimeSetup.choice, 'hermes')
  assert.equal(result.runtimeSetup.configured, false)
  assert.match(stdout.text, /Skipping Hermes install in --yes automation\. Pass --install-runtime to allow installer execution\./)
  assert.deepEqual(result.skipped, ['register', 'smoke'])
})

test('quickstart --yes --install-runtime can run an approved runtime installer', async () => {
  const calls = []
  const stdout = captureWritable()
  const inspectResults = [
    {
      framework: 'hermes',
      installed: false,
      installCheck: { displayCommand: 'hermes --version' },
      checks: [{ name: 'version', displayCommand: 'hermes --version', ok: false, error: 'CLI not detected' }],
      runtime: { ok: false, baseUrl: 'http://127.0.0.1:8642/v1', error: 'not running' },
      endpointDefault: { value: '', source: '' },
    },
    {
      framework: 'hermes',
      installed: false,
      installCheck: { displayCommand: 'hermes --version' },
      checks: [{ name: 'version', displayCommand: 'hermes --version', ok: false, error: 'PATH not refreshed' }],
      runtime: { ok: false, baseUrl: 'http://127.0.0.1:8642/v1', error: 'not running' },
      endpointDefault: { value: '', source: '' },
    },
  ]

  const result = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788', yes: true, setupBridge: true, runtimeSetup: 'hermes', installRuntime: true },
    {
      stdout,
      stderr: stdout,
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
      runtimeInstallPlan(choice) {
        calls.push(['install-plan', choice.id])
        return {
          runtime: 'hermes',
          autoInstallAvailable: true,
          mode: 'remote-script',
          url: 'https://hermes-agent.nousresearch.com/install.sh',
          runner: { command: 'bash', argsBeforeScript: [] },
          scriptExtension: '.sh',
          displayCommand: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash',
          sourceUrl: 'https://hermes-agent.nousresearch.com/docs/',
          docs: { install: 'https://hermes-agent.nousresearch.com/docs/' },
        }
      },
      async inspectRuntimeFramework(args) {
        calls.push(['framework', args.choice.id])
        return inspectResults.shift()
      },
      async installRuntime(plan) {
        calls.push(['install', plan])
        return { ok: true, command: plan, logs: { stdout: 'hermes-install.out.log', stderr: 'hermes-install.err.log' } }
      },
      async checkBridgeHealth(bridgeUrl) {
        calls.push(['bridge-health', bridgeUrl])
        return { ok: false, error: 'connection refused', url: bridgeUrl }
      },
      bridgeStartPlan(args) {
        calls.push(['bridge-plan', args])
        return { command: 'npx', args: ['--yes', 'llmwiki-agent-bridge@0.1.0'], packageName: 'llmwiki-agent-bridge@0.1.0' }
      },
      async startBridgeCommand() {
        throw new Error('bridge command should not run when background start default is no')
      },
    },
  )

  assert.deepEqual(calls.map((call) => call[0]), ['discover', 'validate', 'start', 'install-plan', 'framework', 'install', 'framework', 'bridge-health', 'bridge-plan'])
  assert.equal(result.runtimeSetup.choice, 'hermes')
  assert.equal(result.runtimeSetup.configured, false)
  assert.match(stdout.text, /Selected: defaulted Yes/)
  assert.match(stdout.text, /Hermes installer completed; logs: hermes-install\.out\.log, hermes-install\.err\.log/)
  assert.match(stdout.text, /No runtime endpoint entered\. Continuing with evidence-only bridge mode/)
  assert.deepEqual(result.skipped, ['register', 'smoke'])
})

test('quickstart --no-install-runtime suppresses runtime installer prompts', async () => {
  const calls = []
  const prompts = []
  const stdout = captureWritable()
  const answers = ['y', '1', 'y', 'y', '2', 'skip', 'n', 'n']

  const result = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788', 'install-runtime': false },
    {
      stdout,
      stderr: stdout,
      async prompt(question) {
        prompts.push(question)
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
      runtimeInstallPlan(choice) {
        calls.push(['install-plan', choice.id])
        return {
          runtime: 'hermes',
          autoInstallAvailable: true,
          mode: 'remote-script',
          url: 'https://hermes-agent.nousresearch.com/install.sh',
          runner: { command: 'bash', argsBeforeScript: [] },
          scriptExtension: '.sh',
          displayCommand: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash',
          sourceUrl: 'https://hermes-agent.nousresearch.com/docs/',
          docs: { install: 'https://hermes-agent.nousresearch.com/docs/' },
        }
      },
      async inspectRuntimeFramework(args) {
        calls.push(['framework', args.choice.id])
        return {
          framework: 'hermes',
          installed: false,
          installCheck: { displayCommand: 'hermes --version' },
          checks: [{ name: 'version', displayCommand: 'hermes --version', ok: false, error: 'CLI not detected' }],
          runtime: { ok: false, baseUrl: 'http://127.0.0.1:8642/v1', error: 'not running' },
          endpointDefault: { value: '', source: '' },
        }
      },
      async installRuntime() {
        throw new Error('runtime installer should not run when --no-install-runtime is set')
      },
      async checkBridgeHealth(bridgeUrl) {
        calls.push(['bridge-health', bridgeUrl])
        return { ok: false, error: 'connection refused', url: bridgeUrl }
      },
      bridgeStartPlan(args) {
        calls.push(['bridge-plan', args])
        return { command: 'npx', args: ['--yes', 'llmwiki-agent-bridge@0.1.0'], packageName: 'llmwiki-agent-bridge@0.1.0' }
      },
      async startBridgeCommand() {
        throw new Error('bridge command should not run when background start is declined')
      },
    },
  )

  assert.deepEqual(calls.map((call) => call[0]), ['discover', 'validate', 'start', 'install-plan', 'framework', 'bridge-health', 'bridge-plan'])
  assert.equal(result.runtimeSetup.choice, 'hermes')
  assert.equal(result.runtimeSetup.configured, false)
  assert.match(stdout.text, /Runtime installer disabled by --no-install-runtime/)
  assert(!prompts.some((prompt) => /Install Hermes now/.test(prompt)))
  assert.deepEqual(result.skipped, ['register', 'smoke'])
})

test('quickstart falls back to evidence-only when approved runtime install throws', async () => {
  const calls = []
  const stdout = captureWritable()
  const answers = ['y', '1', 'y', 'y', '2', 'y', 'skip', 'n', 'n']

  const result = await quickstart(
    { path: '.', bridge: 'http://127.0.0.1:8788' },
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
      runtimeInstallPlan(choice) {
        calls.push(['install-plan', choice.id])
        return {
          runtime: 'hermes',
          autoInstallAvailable: true,
          mode: 'remote-script',
          url: 'https://hermes-agent.nousresearch.com/install.sh',
          runner: { command: 'bash', argsBeforeScript: [] },
          scriptExtension: '.sh',
          displayCommand: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash',
          sourceUrl: 'https://hermes-agent.nousresearch.com/docs/',
          docs: { install: 'https://hermes-agent.nousresearch.com/docs/' },
        }
      },
      async inspectRuntimeFramework(args) {
        calls.push(['framework', args.choice.id])
        return {
          framework: 'hermes',
          installed: false,
          installCheck: { displayCommand: 'hermes --version' },
          checks: [{ name: 'version', displayCommand: 'hermes --version', ok: false, error: 'CLI not detected' }],
          runtime: { ok: false, baseUrl: 'http://127.0.0.1:8642/v1', error: 'not running' },
          endpointDefault: { value: '', source: '' },
        }
      },
      async installRuntime(plan) {
        calls.push(['install', plan])
        throw new Error('installer unavailable in test')
      },
      async checkBridgeHealth(bridgeUrl) {
        calls.push(['bridge-health', bridgeUrl])
        return { ok: false, error: 'connection refused', url: bridgeUrl }
      },
      bridgeStartPlan(args) {
        calls.push(['bridge-plan', args])
        return { command: 'npx', args: ['--yes', 'llmwiki-agent-bridge@0.1.0'], packageName: 'llmwiki-agent-bridge@0.1.0' }
      },
      async startBridgeCommand() {
        throw new Error('bridge command should not run when background start is declined')
      },
    },
  )

  assert.deepEqual(calls.map((call) => call[0]), ['discover', 'validate', 'start', 'install-plan', 'framework', 'install', 'bridge-health', 'bridge-plan'])
  assert.equal(result.runtimeSetup.choice, 'hermes')
  assert.equal(result.runtimeSetup.configured, false)
  assert.equal(result.runtimeSetup.fallback, 'evidence-only')
  assert.match(stdout.text, /Hermes install failed; logs: not captured/)
  assert.match(stdout.text, /QuickStart will continue\. Enter a running endpoint below, or press Enter\/skip for evidence-only\./)
  assert.match(stdout.text, /No runtime endpoint entered\. Continuing with evidence-only bridge mode/)
  assert.deepEqual(result.skipped, ['register', 'smoke'])
})

test('runtimeInstallPlan uses official OS-specific installer allowlist', () => {
  const hermesWindows = runtimeInstallPlan({ id: 'hermes' }, { platform: 'win32' })
  assert.equal(hermesWindows.autoInstallAvailable, true)
  assert.equal(hermesWindows.mode, 'remote-script')
  assert.equal(hermesWindows.runner.command, 'powershell.exe')
  assert.equal(hermesWindows.url, 'https://hermes-agent.nousresearch.com/install.ps1')
  assert.match(hermesWindows.displayCommand, /install\.ps1/)

  const hermesLinux = runtimeInstallPlan({ id: 'hermes' }, { platform: 'linux' })
  assert.equal(hermesLinux.autoInstallAvailable, true)
  assert.equal(hermesLinux.runner.command, 'bash')
  assert.equal(hermesLinux.url, 'https://hermes-agent.nousresearch.com/install.sh')

  const hermesUnsupported = runtimeInstallPlan({ id: 'hermes' }, { platform: 'freebsd' })
  assert.equal(hermesUnsupported.autoInstallAvailable, false)
  assert.match(hermesUnsupported.reason, /not enabled by this allowlist/)

  const deepAgentsLinux = runtimeInstallPlan({ id: 'deepagents' }, { platform: 'linux' })
  assert.equal(deepAgentsLinux.autoInstallAvailable, true)
  assert.equal(deepAgentsLinux.runner.command, 'bash')
  assert.equal(deepAgentsLinux.url, 'https://langch.in/dcode')

  const deepAgentsWindows = runtimeInstallPlan({ id: 'deepagents' }, { platform: 'win32' })
  assert.equal(deepAgentsWindows.autoInstallAvailable, false)
  assert.match(deepAgentsWindows.reason, /not support native Windows/)

  const deepAgentsUnsupported = runtimeInstallPlan({ id: 'deepagents' }, { platform: 'android' })
  assert.equal(deepAgentsUnsupported.autoInstallAvailable, false)
  assert.match(deepAgentsUnsupported.reason, /not enabled by this allowlist/)
})

test('scrubInstallerEnv prepends HOME and XDG user bins without leaking secrets', () => {
  const home = join(tmpdir(), 'llmwiki-installer-home')
  const xdgDataHome = join(tmpdir(), 'llmwiki-installer-xdg', 'share')

  const clean = scrubInstallerEnv({
    PATH: 'safe-path',
    HOME: home,
    XDG_DATA_HOME: xdgDataHome,
    LC_ALL: 'C',
    PWD: process.cwd(),
    OPENAI_API_KEY: 'secret-openai',
    ANTHROPIC_API_KEY: 'secret-anthropic',
    HERMES_BASE_URL: 'http://private-hermes.example.invalid/v1',
  })

  assert.deepEqual(clean.PATH.split(delimiter), [
    join(home, '.local', 'bin'),
    join(home, 'bin'),
    join(home, '.bin'),
    join(tmpdir(), 'llmwiki-installer-xdg', 'bin'),
    'safe-path',
  ])
  assert.equal(clean.HOME, home)
  assert.equal(clean.XDG_DATA_HOME, xdgDataHome)
  assert.equal(clean.LC_ALL, 'C')
  assert.equal(clean.PWD, undefined)
  assert.equal(clean.OPENAI_API_KEY, undefined)
  assert.equal(clean.ANTHROPIC_API_KEY, undefined)
  assert.equal(clean.HERMES_BASE_URL, undefined)
})

test('scrubInstallerEnv avoids duplicate user bins and preserves Path casing', () => {
  const home = join(tmpdir(), 'llmwiki-installer-home-dupe')
  const homeLocalBin = join(home, '.local', 'bin')
  const existingToolBin = join(home, 'tools', 'bin')

  const clean = scrubInstallerEnv({
    Path: [homeLocalBin, existingToolBin].join(delimiter),
    HOME: home,
    XDG_DATA_HOME: join(home, '.local', 'share'),
  })

  assert.equal(clean.PATH, undefined)
  assert.deepEqual(clean.Path.split(delimiter), [
    join(home, 'bin'),
    join(home, '.bin'),
    homeLocalBin,
    existingToolBin,
  ])
  assert.equal(clean.Path.split(delimiter).filter((entry) => entry === homeLocalBin).length, 1)
})

test('runRuntimeInstallPlan downloads official script, runs fixed argv, scrubs env, and writes logs', async () => {
  const logDir = mkdtempSync(join(tmpdir(), 'llmwiki-runtime-install-'))
  const home = join(logDir, 'home')
  const xdgDataHome = join(logDir, 'xdg', 'share')
  const calls = []
  const plan = {
    runtime: 'hermes',
    autoInstallAvailable: true,
    mode: 'remote-script',
    url: 'https://hermes-agent.nousresearch.com/install.sh',
    runner: { command: 'bash', argsBeforeScript: [] },
    scriptExtension: '.sh',
    displayCommand: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash',
  }

  const result = await runRuntimeInstallPlan(plan, {
    logDir,
    env: {
      PATH: 'safe-path',
      HOME: home,
      XDG_DATA_HOME: xdgDataHome,
      LC_ALL: 'C',
      KEEP_ME: 'drop-me',
      OPENAI_API_KEY: 'secret-openai',
      ANTHROPIC_API_KEY: 'secret-anthropic',
      GOOGLE_API_KEY: 'secret-google',
      GROQ_API_KEY: 'secret-groq',
      COHERE_API_KEY: 'secret-cohere',
      LANGSMITH_API_KEY: 'secret-langsmith',
      TAVILY_API_KEY: 'secret-tavily',
      HERMES_BASE_URL: 'http://private-hermes.example.invalid/v1',
      LLMWIKI_AGENT_BRIDGE_BASE_URL: 'http://private-bridge.example.invalid/v1',
    },
    async downloader(url, destination, options) {
      calls.push({ type: 'download', url, destination, options })
      writeFileSync(destination, '#!/usr/bin/env bash\nexit 0\n', 'utf8')
      return { path: destination, bytes: 27, url }
    },
    async commandRunner(command, args, options) {
      calls.push({ type: 'run', command, args, options })
      return { status: 0, signal: null, stdout: 'installed\n', stderr: '' }
    },
  })

  const download = calls.find((call) => call.type === 'download')
  const run = calls.find((call) => call.type === 'run')
  assert(download)
  assert(run)
  assert.equal(download.url, 'https://hermes-agent.nousresearch.com/install.sh')
  assert.equal(run.command, 'bash')
  assert.deepEqual(run.args, [download.destination])
  assert.deepEqual(run.options.env.PATH.split(delimiter), [
    join(home, '.local', 'bin'),
    join(home, 'bin'),
    join(home, '.bin'),
    join(logDir, 'xdg', 'bin'),
    'safe-path',
  ])
  assert.equal(run.options.env.HOME, home)
  assert.equal(run.options.env.XDG_DATA_HOME, xdgDataHome)
  assert.equal(run.options.env.LC_ALL, 'C')
  assert.equal(run.options.env.KEEP_ME, undefined)
  assert.equal(run.options.env.OPENAI_API_KEY, undefined)
  assert.equal(run.options.env.ANTHROPIC_API_KEY, undefined)
  assert.equal(run.options.env.GOOGLE_API_KEY, undefined)
  assert.equal(run.options.env.GROQ_API_KEY, undefined)
  assert.equal(run.options.env.COHERE_API_KEY, undefined)
  assert.equal(run.options.env.LANGSMITH_API_KEY, undefined)
  assert.equal(run.options.env.TAVILY_API_KEY, undefined)
  assert.equal(run.options.env.HERMES_BASE_URL, undefined)
  assert.equal(run.options.env.LLMWIKI_AGENT_BRIDGE_BASE_URL, undefined)
  assert.equal(result.ok, true)
  assert.equal(result.script.path, download.destination)
  assert.equal(readFileSync(result.logs.stdout, 'utf8'), 'installed\n')
  assert.equal(readFileSync(result.logs.stderr, 'utf8'), '')
})

test('downloadRuntimeInstallerScript rejects HTTP final URLs after redirects', async (t) => {
  const previousFetch = globalThis.fetch
  const logDir = mkdtempSync(join(tmpdir(), 'llmwiki-runtime-download-'))
  const destination = join(logDir, 'installer.sh')
  globalThis.fetch = async () => ({
    ok: true,
    url: 'http://example.invalid/install.sh',
    async arrayBuffer() {
      return Buffer.from('#!/usr/bin/env bash\n')
    },
  })
  t.after(() => {
    globalThis.fetch = previousFetch
  })

  await assert.rejects(
    () => downloadRuntimeInstallerScript('https://example.invalid/install.sh', destination),
    /final URL must use https: http:/,
  )
})

test('startBridgeCommand delegates Windows .cmd bridge commands directly to cross-platform spawn adapter', () => {
  const logDir = mkdtempSync(join(tmpdir(), 'llmwiki-bridge-start-cmd-'))
  const calls = []
  const child = {
    pid: 4242,
    unref() {
      calls.push({ type: 'unref' })
    },
  }

  const started = startBridgeCommand(
    { command: 'npx.cmd', args: ['--yes', 'llmwiki-agent-bridge@0.1.0'], source: 'npx-package' },
    {
      bridgeUrl: 'http://127.0.0.1:8788',
      logDir,
      runtime: { configured: true, baseUrl: 'http://127.0.0.1:9999/v1', model: 'deepagents-local', profile: 'deepagents' },
      spawnProcess(command, args, options) {
        calls.push({ type: 'spawn', command, args, options })
        return child
      },
    },
  )

  const spawnCall = calls.find((call) => call.type === 'spawn')
  assert(spawnCall)
  assert.equal(spawnCall.command, 'npx.cmd')
  assert.deepEqual(spawnCall.args, ['--yes', 'llmwiki-agent-bridge@0.1.0'])
  assert.equal(spawnCall.options.cwd, process.cwd())
  assert.equal(spawnCall.options.detached, true)
  assert.equal(spawnCall.options.windowsHide, true)
  assert.equal(spawnCall.options.windowsVerbatimArguments, undefined)
  assert.equal(spawnCall.options.shell, undefined)
  assert.equal(spawnCall.options.env.LLMWIKI_AGENT_BRIDGE_HOST, '127.0.0.1')
  assert.equal(spawnCall.options.env.LLMWIKI_AGENT_BRIDGE_PORT, '8788')
  assert.equal(spawnCall.options.env.LLMWIKI_AGENT_BRIDGE_BASE_URL, 'http://127.0.0.1:9999/v1')
  assert.equal(spawnCall.options.env.LLMWIKI_AGENT_BRIDGE_MODEL, 'deepagents-local')
  assert.equal(spawnCall.options.env.LLMWIKI_AGENT_BRIDGE_RUNTIME_PROFILE, 'deepagents')
  assert.equal(spawnCall.options.env.LLMWIKI_AGENT_BRIDGE_RUNTIME_ADAPTER, undefined)
  assert.equal(spawnCall.options.stdio[0], 'ignore')
  assert(Number.isInteger(spawnCall.options.stdio[1]))
  assert(Number.isInteger(spawnCall.options.stdio[2]))
  assert.deepEqual(calls.at(-1), { type: 'unref' })
  assert.equal(started.command, 'npx.cmd')
  assert.deepEqual(started.args, ['--yes', 'llmwiki-agent-bridge@0.1.0'])
  assert.equal(started.processId, 4242)
  assert.match(started.logs.stdout, /llmwiki-agent-bridge-127\.0\.0\.1-8788\.out\.log$/)
  assert.match(started.logs.stderr, /llmwiki-agent-bridge-127\.0\.0\.1-8788\.err\.log$/)
})

test('startBridgeCommand passes explicit DeepAgents ACP runtime adapter env', () => {
  const logDir = mkdtempSync(join(tmpdir(), 'llmwiki-bridge-start-acp-env-'))
  const calls = []
  const child = {
    pid: 4244,
    unref() {
      calls.push({ type: 'unref' })
    },
  }

  startBridgeCommand(
    { command: 'npx', args: ['--yes', 'llmwiki-agent-bridge@0.1.0'], source: 'npx-package' },
    {
      bridgeUrl: 'http://127.0.0.1:8788',
      logDir,
      runtime: { configured: true, baseUrl: '', model: 'deepagents-local', profile: 'deepagents', runtimeAdapter: 'deepagents-acp' },
      spawnProcess(command, args, options) {
        calls.push({ type: 'spawn', command, args, options })
        return child
      },
    },
  )

  const spawnCall = calls.find((call) => call.type === 'spawn')
  assert(spawnCall)
  assert.equal(spawnCall.options.env.LLMWIKI_AGENT_BRIDGE_HOST, '127.0.0.1')
  assert.equal(spawnCall.options.env.LLMWIKI_AGENT_BRIDGE_PORT, '8788')
  assert.equal(spawnCall.options.env.LLMWIKI_AGENT_BRIDGE_BASE_URL, undefined)
  assert.equal(spawnCall.options.env.LLMWIKI_AGENT_BRIDGE_MODEL, 'deepagents-local')
  assert.equal(spawnCall.options.env.LLMWIKI_AGENT_BRIDGE_RUNTIME_PROFILE, 'deepagents')
  assert.equal(spawnCall.options.env.LLMWIKI_AGENT_BRIDGE_RUNTIME_ADAPTER, 'deepagents-acp')
  assert.deepEqual(calls.at(-1), { type: 'unref' })
})

test('startBridgeCommand scrubs inherited adapter env before applying configured runtime env', () => {
  const logDir = mkdtempSync(join(tmpdir(), 'llmwiki-bridge-start-configured-env-'))
  const scrubbedKeys = [
    'LLMWIKI_AGENT_BRIDGE_RUNTIME_ADAPTER',
    'LLMWIKI_AGENT_BRIDGE_DEEPAGENTS_ACP_COMMAND',
    'LLMWIKI_AGENT_BRIDGE_DEEPAGENTS_ACP_ARGS',
    'LLMWIKI_AGENT_BRIDGE_DEEPAGENTS_ACP_CWD',
    'HERMES_A2A_BRIDGE_RUNTIME_ADAPTER',
  ]
  const previous = new Map(scrubbedKeys.map((key) => [key, process.env[key]]))
  const calls = []
  const child = {
    pid: 4245,
    unref() {
      calls.push({ type: 'unref' })
    },
  }

  try {
    for (const key of scrubbedKeys) {
      process.env[key] = `canary-${key}`
    }

    startBridgeCommand(
      { command: 'npx', args: ['--yes', 'llmwiki-agent-bridge@0.1.0'], source: 'npx-package' },
      {
        bridgeUrl: 'http://127.0.0.1:8788',
        logDir,
        runtime: { configured: true, baseUrl: 'http://127.0.0.1:9999/v1', model: 'deepagents-local', profile: 'deepagents', runtimeAdapter: '' },
        spawnProcess(command, args, options) {
          calls.push({ type: 'spawn', command, args, options })
          return child
        },
      },
    )
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }

  const spawnCall = calls.find((call) => call.type === 'spawn')
  assert(spawnCall)
  assert.equal(spawnCall.options.env.LLMWIKI_AGENT_BRIDGE_BASE_URL, 'http://127.0.0.1:9999/v1')
  assert.equal(spawnCall.options.env.LLMWIKI_AGENT_BRIDGE_MODEL, 'deepagents-local')
  assert.equal(spawnCall.options.env.LLMWIKI_AGENT_BRIDGE_RUNTIME_PROFILE, 'deepagents')
  for (const key of scrubbedKeys) {
    assert.equal(Object.hasOwn(spawnCall.options.env, key), false, `${key} should be scrubbed`)
  }
  assert.deepEqual(calls.at(-1), { type: 'unref' })
})

test('startBridgeCommand scrubs runtime and API key env when evidence-only runtime is selected', () => {
  const logDir = mkdtempSync(join(tmpdir(), 'llmwiki-bridge-start-env-'))
  const scrubbedKeys = [
    'LLMWIKI_AGENT_BRIDGE_BASE_URL',
    'LLMWIKI_AGENT_BRIDGE_MODEL',
    'LLMWIKI_AGENT_BRIDGE_API_KEY',
    'LLMWIKI_AGENT_BRIDGE_RUNTIME_PROFILE',
    'LLMWIKI_AGENT_BRIDGE_RUNTIME_ADAPTER',
    'LLMWIKI_AGENT_BRIDGE_DEEPAGENTS_ACP_COMMAND',
    'LLMWIKI_AGENT_BRIDGE_DEEPAGENTS_ACP_ARGS',
    'LLMWIKI_AGENT_BRIDGE_DEEPAGENTS_ACP_CWD',
    'HERMES_BASE_URL',
    'HERMES_MODEL',
    'HERMES_API_KEY',
    'HERMES_A2A_BRIDGE_RUNTIME_ADAPTER',
    'HERMES_A2A_BRIDGE_RUNTIME_PROFILE',
    'HERMES_A2A_BRIDGE_BEARER_TOKEN',
    'DEEPAGENTS_BASE_URL',
    'DEEPAGENTS_MODEL',
    'DEEPAGENTS_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_MODEL',
    'OPENAI_API_KEY',
  ]
  const previous = new Map(scrubbedKeys.map((key) => [key, process.env[key]]))
  const calls = []
  const child = {
    pid: 4343,
    unref() {
      calls.push({ type: 'unref' })
    },
  }

  try {
    for (const key of scrubbedKeys) {
      process.env[key] = `canary-${key}`
    }
    process.env.LLMWIKI_BRIDGE_START_KEEP_ME = 'normal-env-canary'

    startBridgeCommand(
      { command: 'npx', args: ['--yes', 'llmwiki-agent-bridge@0.1.0'], source: 'npx-package' },
      {
        bridgeUrl: 'http://127.0.0.1:8788',
        logDir,
        runtime: { configured: false, disabled: true, baseUrl: '', model: 'local-model', profile: 'generic' },
        spawnProcess(command, args, options) {
          calls.push({ type: 'spawn', command, args, options })
          return child
        },
      },
    )
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    delete process.env.LLMWIKI_BRIDGE_START_KEEP_ME
  }

  const spawnCall = calls.find((call) => call.type === 'spawn')
  assert(spawnCall)
  for (const key of scrubbedKeys) {
    assert.equal(Object.hasOwn(spawnCall.options.env, key), false, `${key} should be scrubbed`)
  }
  assert.equal(spawnCall.options.env.LLMWIKI_BRIDGE_START_KEEP_ME, 'normal-env-canary')
  assert.equal(spawnCall.options.env.LLMWIKI_AGENT_BRIDGE_HOST, '127.0.0.1')
  assert.equal(spawnCall.options.env.LLMWIKI_AGENT_BRIDGE_PORT, '8788')
  assert.deepEqual(calls.at(-1), { type: 'unref' })
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
  assert.match(stdout.text, /Registered 1 total bridge source\(s\); 1 selected for this quickstart/)
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
  assert.equal(runtime.runtimeAdapter, '')

  const disabled = detectLlmRuntime({ noLlmRuntime: true }, { LLMWIKI_AGENT_BRIDGE_BASE_URL: 'http://127.0.0.1:8642/v1' })
  assert.equal(disabled.configured, false)
  assert.equal(disabled.disabled, true)

  const legacyOnly = detectLlmRuntime({}, {
    HERMES_BASE_URL: 'http://legacy-hermes-env.example.invalid:8642/v1',
    HERMES_MODEL: 'pc-custom-hermes-model',
    DEEPAGENTS_BASE_URL: 'http://127.0.0.1:9998/v1',
    OPENAI_BASE_URL: 'http://127.0.0.1:9997/v1',
  })
  assert.equal(legacyOnly.configured, false)

  const standardEnv = detectLlmRuntime({}, {
    LLMWIKI_AGENT_BRIDGE_BASE_URL: 'http://127.0.0.1:8642/v1',
    LLMWIKI_AGENT_BRIDGE_MODEL: 'bridge-model',
  })
  assert.equal(standardEnv.configured, true)
  assert.equal(standardEnv.baseUrl, 'http://127.0.0.1:8642/v1')
  assert.equal(standardEnv.model, 'bridge-model')

  const deepAgentsAcp = detectLlmRuntime({ 'runtime-adapter': 'acp' }, {})
  assert.equal(deepAgentsAcp.configured, true)
  assert.equal(deepAgentsAcp.baseUrl, '')
  assert.equal(deepAgentsAcp.model, 'deepagents-local')
  assert.equal(deepAgentsAcp.profile, 'deepagents')
  assert.equal(deepAgentsAcp.runtimeAdapter, 'deepagents-acp')

  const deepAgentsEndpointCompatibility = detectLlmRuntime({ 'llm-endpoint': 'http://127.0.0.1:9999/v1', 'runtime-profile': 'deepagents' }, {})
  assert.equal(deepAgentsEndpointCompatibility.configured, true)
  assert.equal(deepAgentsEndpointCompatibility.profile, 'deepagents')
  assert.equal(deepAgentsEndpointCompatibility.runtimeAdapter, '')

  const inheritedAdapterOnly = detectLlmRuntime({}, {
    LLMWIKI_AGENT_BRIDGE_RUNTIME_ADAPTER: 'deepagents-acp',
  })
  assert.equal(inheritedAdapterOnly.configured, false)
  assert.equal(inheritedAdapterOnly.runtimeAdapter, '')

  const inheritedAdapterWithEndpoint = detectLlmRuntime({}, {
    LLMWIKI_AGENT_BRIDGE_BASE_URL: 'http://127.0.0.1:9999/v1',
    LLMWIKI_AGENT_BRIDGE_MODEL: 'deepagents-local',
    LLMWIKI_AGENT_BRIDGE_RUNTIME_PROFILE: 'deepagents',
    LLMWIKI_AGENT_BRIDGE_RUNTIME_ADAPTER: 'deepagents-acp',
  })
  assert.equal(inheritedAdapterWithEndpoint.configured, true)
  assert.equal(inheritedAdapterWithEndpoint.baseUrl, 'http://127.0.0.1:9999/v1')
  assert.equal(inheritedAdapterWithEndpoint.profile, 'deepagents')
  assert.equal(inheritedAdapterWithEndpoint.runtimeAdapter, '')
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

  const legacyEnv = await selectBridgeSmokeMode({
    env: { HERMES_BASE_URL: 'http://legacy-hermes-env.example.invalid:8642/v1' },
    inspectBridgeRuntime: async () => ({ configured: false, reason: 'no explicit LLM endpoint detected in bridge settings' }),
  })
  assert.equal(legacyEnv.mode, 'evidence-only')

  const skippedRuntime = await selectBridgeSmokeMode({
    options: { noLlmRuntime: true },
    env: { LLMWIKI_AGENT_BRIDGE_BASE_URL: 'http://127.0.0.1:8642/v1' },
    inspectBridgeRuntime: async () => {
      throw new Error('settings should not be inspected when runtime setup selected evidence-only')
    },
  })
  assert.equal(skippedRuntime.mode, 'evidence-only')

  const delegatedFromSettings = await selectBridgeSmokeMode({
    env: {},
    inspectBridgeRuntime: async () => ({ configured: true, reason: 'LLM endpoint configured in bridge settings' }),
  })
  assert.equal(delegatedFromSettings.mode, 'delegated-runtime')

  const forced = await selectBridgeSmokeMode({ options: { mode: 'hybrid' }, env: {} })
  assert.equal(forced.mode, 'hybrid')
})

test('probeRuntimeEndpoint verifies Hermes /health and /v1/health without env defaults', async () => {
  const fetchCalls = []
  const result = await probeRuntimeEndpoint({
    baseUrl: 'http://127.0.0.1:8642/v1',
    profile: 'hermes',
    async fetchJson(url) {
      fetchCalls.push(String(url))
      if (String(url) === 'http://127.0.0.1:8642/v1/health') {
        return { status: 'ready' }
      }
      throw new Error('not found')
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.url, 'http://127.0.0.1:8642/v1/health')
  assert.equal(result.status, 'ready')
  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:8642/health',
    'http://127.0.0.1:8642/v1/health',
  ])

  const generic = await probeRuntimeEndpoint({
    baseUrl: 'http://127.0.0.1:8642/v1',
    profile: 'deepagents',
    async fetchJson() {
      throw new Error('DeepAgents probe should not call network health endpoints')
    },
  })
  assert.equal(generic.ok, true)
  assert.equal(generic.skipped, true)
  assert.match(generic.reason, /no registered framework health probe/)
})

test('inspectRuntimeFramework checks Hermes with supported CLI and health probe', async () => {
  const calls = []
  const result = await inspectRuntimeFramework({
    choice: { id: 'hermes', profile: 'hermes' },
    env: {
      HERMES_BASE_URL: 'http://legacy-hermes-env.example.invalid:8642/v1',
      OPENAI_BASE_URL: 'http://legacy-openai-env.example.invalid/v1',
    },
    async commandRunner(command, args, options) {
      calls.push(['command', command, args, options])
      assert.equal(command, 'hermes')
      assert.equal(options.timeoutMs, 1500)
      assert.equal(options.maxBuffer, 64 * 1024)
      if (args[0] === '--version') {
        return { status: 0, stdout: 'hermes 1.2.3\n', stderr: '' }
      }
      if (args[0] === 'status') {
        return { status: 0, stdout: 'Hermes status ok\n', stderr: '' }
      }
      if (args[0] === 'doctor') {
        return { status: 0, stdout: 'Hermes doctor ok\n', stderr: '' }
      }
      throw new Error(`unexpected Hermes command: ${args.join(' ')}`)
    },
    async probe(args) {
      calls.push(['probe', args])
      assert.equal(args.baseUrl, 'http://127.0.0.1:8642/v1')
      assert.equal(args.profile, 'hermes')
      return { ok: true, baseUrl: args.baseUrl, profile: args.profile, url: 'http://127.0.0.1:8642/health', status: 'ok' }
    },
  })

  assert.equal(result.framework, 'hermes')
  assert.equal(result.supported, true)
  assert.equal(result.installed, true)
  assert.equal(result.version, '1.2.3')
  assert.equal(result.installCheck.displayCommand, 'hermes --version')
  assert.equal(result.runtime.ok, true)
  assert.equal(result.endpointDefault.value, 'http://127.0.0.1:8642/v1')
  assert.equal(result.endpointDefault.verified, true)
  assert(!JSON.stringify(result).includes('api_key'))
  assert(!JSON.stringify(result).includes('"secret"'))
  assert(!JSON.stringify(result).includes('legacy-hermes-env.example.invalid'))
  assert(!JSON.stringify(result).includes('legacy-openai-env.example.invalid'))
  assert.deepEqual(calls.map((call) => call[0]), ['command', 'command', 'command', 'probe'])
  assert.deepEqual(calls.filter((call) => call[0] === 'command').map((call) => call[2]), [
    ['--version'],
    ['status'],
    ['doctor'],
  ])
})

test('inspectRuntimeFramework checks DeepAgents with supported dcode CLI without endpoint inference', async () => {
  const calls = []
  const result = await inspectRuntimeFramework({
    choice: { id: 'deepagents', profile: 'deepagents' },
    env: {
      DEEPAGENTS_BASE_URL: 'http://legacy-deepagents-env.example.invalid/v1',
      OPENAI_BASE_URL: 'http://legacy-openai-env.example.invalid/v1',
    },
    async commandRunner(command, args, options) {
      calls.push(['command', command, args, options])
      assert.equal(command, 'dcode')
      assert.equal(options.timeoutMs, 1500)
      assert.equal(options.maxBuffer, 64 * 1024)
      if (args[0] === '--version') {
        return { status: 0, stdout: 'dcode 0.4.5\n', stderr: '' }
      }
      if (args[0] === 'doctor') {
        return { status: 0, stdout: 'DeepAgents doctor ok\n', stderr: '' }
      }
      if (args.join(' ') === 'config show --json') {
        return { status: 0, stdout: JSON.stringify({ model: 'openai:gpt-5.5', endpoint: 'http://from-dcode-config.example.invalid/v1', api_key: 'secret' }), stderr: '' }
      }
      throw new Error(`unexpected DeepAgents command: ${args.join(' ')}`)
    },
    async probe() {
      throw new Error('DeepAgents inspection should not infer an endpoint through Hermes-style health probing')
    },
  })

  assert.equal(result.framework, 'deepagents')
  assert.equal(result.supported, true)
  assert.equal(result.installed, true)
  assert.equal(result.version, '0.4.5')
  assert.equal(result.installCheck.displayCommand, 'dcode --version')
  assert.equal(result.runtime.ok, false)
  assert.equal(result.runtime.skipped, true)
  assert.match(result.runtime.reason, /no registered local OpenAI-compatible runtime endpoint discovery contract/)
  assert.equal(result.endpointDefault.value, '')
  assert.equal(result.checks.find((check) => check.name === 'config').safeConfig.ok, false)
  assert(!JSON.stringify(result).includes('api_key'))
  assert(!JSON.stringify(result).includes('"secret"'))
  assert(!JSON.stringify(result).includes('from-dcode-config.example.invalid'))
  assert(!JSON.stringify(result).includes('legacy-deepagents-env.example.invalid'))
  assert(!JSON.stringify(result).includes('legacy-openai-env.example.invalid'))
  assert.deepEqual(calls.map((call) => call[0]), ['command', 'command', 'command'])
  assert.deepEqual(calls.map((call) => call[2]), [
    ['--version'],
    ['doctor'],
    ['config', 'show', '--json'],
  ])
})

test('configureBridgeRuntime saves only runtime connection fields', async (t) => {
  let server
  let received = null
  const receivedBody = new Promise((resolveBody) => {
    server = createServer((request, response) => {
      let raw = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => {
        raw += chunk
      })
      request.on('end', () => {
        received = {
          method: request.method,
          url: request.url,
          headers: request.headers,
          body: JSON.parse(raw),
        }
        resolveBody(received)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ status: 'saved', applied: ['runtimeProfile', 'baseUrl', 'model'] }))
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
  const result = await configureBridgeRuntime({
    bridgeUrl: `http://127.0.0.1:${address.port}`,
    runtime: {
      configured: true,
      baseUrl: 'http://127.0.0.1:8642/v1/',
      model: 'deepagents-local',
      profile: 'deep-agents',
    },
  })
  const request = await receivedBody

  assert.equal(result.ok, true)
  assert.equal(request.method, 'PUT')
  assert.equal(request.url, '/settings/config.json')
  assert.equal(request.headers['content-type'], 'application/json')
  assert.deepEqual(request.body, {
    runtimeProfile: 'deepagents',
    baseUrl: 'http://127.0.0.1:8642/v1',
    model: 'deepagents-local',
  })
  assert.equal(Object.hasOwn(request.body, 'runtimeAdapter'), false)
  assert.equal(Object.hasOwn(request.body, 'apiKey'), false)
  assert.equal(Object.hasOwn(request.body, 'bridgeBearerToken'), false)
})

test('configureBridgeRuntime sends explicit DeepAgents ACP runtime adapter setting', async (t) => {
  let server
  let received = null
  const receivedBody = new Promise((resolveBody) => {
    server = createServer((request, response) => {
      let raw = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => {
        raw += chunk
      })
      request.on('end', () => {
        received = {
          method: request.method,
          url: request.url,
          headers: request.headers,
          body: JSON.parse(raw),
        }
        resolveBody(received)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ status: 'saved', applied: ['runtimeProfile', 'runtimeAdapter', 'model'] }))
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
  const result = await configureBridgeRuntime({
    bridgeUrl: `http://127.0.0.1:${address.port}`,
    runtime: {
      configured: true,
      baseUrl: '',
      model: 'deepagents-local',
      profile: 'deepagents',
      runtimeAdapter: 'deepagents-acp',
    },
  })
  const request = await receivedBody

  assert.equal(result.ok, true)
  assert.equal(request.method, 'PUT')
  assert.equal(request.url, '/settings/config.json')
  assert.equal(request.headers['content-type'], 'application/json')
  assert.deepEqual(request.body, {
    runtimeProfile: 'deepagents',
    model: 'deepagents-local',
    runtimeAdapter: 'deepagents-acp',
  })
  assert.equal(Object.hasOwn(request.body, 'baseUrl'), false)
  assert.equal(Object.hasOwn(request.body, 'apiKey'), false)
  assert.equal(Object.hasOwn(request.body, 'bridgeBearerToken'), false)
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

test('discoverCandidates keeps both Obsidian vault root and strong direct child wiki source', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-obsidian-'))
  const wiki = join(root, 'wiki')
  mkdirSync(join(root, '.obsidian'), { recursive: true })
  mkdirSync(join(wiki, 'concepts'), { recursive: true })
  writeFileSync(join(root, 'root-note.md'), '# Root Note\n')
  writeFileSync(join(wiki, 'index.md'), '---\nreview_state: approved\nsource_refs: [SRC]\n---\n# Index\n')
  writeFileSync(join(wiki, 'hot.md'), '# Hot\n')
  writeFileSync(join(wiki, 'concepts', 'topic.md'), '# Topic\n')

  const result = await discoverCandidates({ roots: [root], maxDepth: 3, validate: false })
  assert(result.candidates.some((candidate) => candidate.path === wiki))
  assert(result.candidates.some((candidate) => candidate.path === root))
  assert.equal(result.candidates.find((candidate) => candidate.path === wiki).variant, 'native-llmwiki-openwiki')
  assert.equal(result.candidates.find((candidate) => candidate.path === root).variant, 'obsidian-vault')
})

test('discoverCandidates keeps app roots and strong child wiki sources for supported app variants', async () => {
  const variants = [
    {
      name: 'logseq',
      variant: 'logseq-graph',
      setup(root) {
        mkdirSync(join(root, 'logseq'), { recursive: true })
        writeFileSync(join(root, 'logseq', 'config.edn'), '{}\n')
      },
    },
    {
      name: 'dendron',
      variant: 'dendron-workspace',
      setup(root) {
        writeFileSync(join(root, 'dendron.yml'), 'version: 5\n')
      },
    },
    {
      name: 'foam',
      variant: 'foam-workspace',
      setup(root) {
        mkdirSync(join(root, '.foam'), { recursive: true })
      },
    },
    {
      name: 'quartz',
      variant: 'quartz-source',
      setup(root) {
        writeFileSync(join(root, 'quartz.config.ts'), 'export default {}\n')
      },
    },
  ]

  for (const variant of variants) {
    const root = mkdtempSync(join(tmpdir(), `llmwiki-${variant.name}-`))
    const wiki = join(root, 'wiki')
    variant.setup(root)
    mkdirSync(join(wiki, 'concepts'), { recursive: true })
    writeFileSync(join(root, 'root-note.md'), '# Root Note\n')
    writeFileSync(join(wiki, 'index.md'), '---\nreview_state: approved\nsource_refs: [SRC]\n---\n# Index\n')
    writeFileSync(join(wiki, 'hot.md'), '# Hot\n')
    writeFileSync(join(wiki, 'concepts', 'topic.md'), '# Topic\n')

    const result = await discoverCandidates({ roots: [root], maxDepth: 3, validate: false })
    assert(result.candidates.some((candidate) => candidate.path === wiki), `${variant.name} child wiki missing`)
    assert(result.candidates.some((candidate) => candidate.path === root), `${variant.name} root missing`)
    assert.equal(result.candidates.find((candidate) => candidate.path === wiki).variant, 'native-llmwiki-openwiki')
    assert.equal(result.candidates.find((candidate) => candidate.path === root).variant, variant.variant)
  }
})

test('discoverCandidates keeps Obsidian vault root over weak direct child wiki', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-obsidian-weak-child-'))
  const wiki = join(root, 'wiki')
  mkdirSync(join(root, '.obsidian'), { recursive: true })
  mkdirSync(wiki, { recursive: true })
  writeFileSync(join(root, 'root-note.md'), '# Root Note\n')
  writeFileSync(join(wiki, 'index.md'), '# Weak child index\n')

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

test('scoreCandidate treats sources frontmatter alias as strong projection evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-native-sources-alias-'))
  mkdirSync(join(root, 'concepts'), { recursive: true })
  writeFileSync(join(root, 'hot.md'), '# Hot\n')
  writeFileSync(join(root, 'index.md'), '---\nsources: [SRC]\n---\n# Index\n')
  writeFileSync(join(root, 'concepts', 'topic.md'), '# Topic\n')

  const scored = scoreCandidate(root)
  assert.equal(scored.variant, 'native-llmwiki-openwiki')
  assert(scored.signals.includes('frontmatter:source_refs'))
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

test('scoreCandidate accepts small source-like wiki roots with hot index and typed content as LLMWiki Markdown', () => {
  const parent = mkdtempSync(join(tmpdir(), 'small-llmwiki-markdown-parent-'))
  const root = join(parent, 'wiki')
  mkdirSync(join(root, 'concepts'), { recursive: true })
  writeFileSync(join(root, 'index.md'), '# Small Wiki\n')
  writeFileSync(join(root, 'hot.md'), '# Hot\n')
  writeFileSync(join(root, 'concepts', 'topic.md'), '# Topic\n')

  const scored = scoreCandidate(root)
  assert.equal(scored.variant, 'llmwiki-markdown')
  assert.equal(scored.variantLabel, 'LLMWiki Markdown')
  assert(scored.markdownCount < 50)
  assert(scored.score >= 30)
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

test('review_state and wiki_title without source_refs do not classify docs-like folders as Native', () => {
  const parent = mkdtempSync(join(tmpdir(), 'llmwiki-docs-review-title-parent-'))
  const root = join(parent, 'docs')
  mkdirSync(join(root, 'concepts'), { recursive: true })
  writeFileSync(join(root, 'index.md'), '---\nreview_state: approved\nwiki_title: Docs Like\n---\n# Index\n')
  writeFileSync(join(root, 'hot.md'), '# Hot\n')
  writeFileSync(join(root, 'concepts', 'topic.md'), '# Topic\n')

  const scored = scoreCandidate(root)
  assert.equal(scored.variant, 'generic-markdown')
  assert.equal(scored.variantLabel, 'Generic Markdown')
  assert(scored.signals.includes('frontmatter:review_state'))
  assert(scored.signals.includes('frontmatter:wiki_title'))
  assert(!scored.signals.includes('frontmatter:source_refs'))
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
    { path: '.', minScore: '10', 'include-additional': true },
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

test('registerSources selectedIds selects only requested sources while preserving stale entries', async (t) => {
  const configPath = join(mkdtempSync(join(tmpdir(), 'llmwiki-register-selected-')), 'sources.json')
  writeFileSync(configPath, JSON.stringify({
    version: 1,
    sources: [
      {
        id: 'wiki-index',
        name: 'Wiki Index',
        title: 'Wiki Index',
        protocol: 'llmwiki-http',
        status: 'ready',
        selected: true,
        url: 'http://127.0.0.1:11001',
      },
      {
        id: 'onharu-wiki-index',
        name: 'Onharu Wiki Index',
        title: 'Onharu Wiki Index',
        protocol: 'llmwiki-http',
        status: 'ready',
        selected: false,
        url: 'http://127.0.0.1:11002',
      },
    ],
  }))

  let savedPayload = null
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/settings/sources.json') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        sources: [
          {
            id: 'local-sample',
            name: 'Local sample LLMWiki',
            title: 'Local sample LLMWiki',
            protocol: 'llmwiki-http',
            status: 'ready',
            selected: true,
            url: 'http://127.0.0.1:8765',
          },
          {
            id: 'wiki-index',
            name: 'Old Wiki Index',
            title: 'Old Wiki Index',
            protocol: 'llmwiki-http',
            status: 'ready',
            selected: false,
            url: 'http://127.0.0.1:19999',
          },
        ],
      }))
      return
    }
    if (request.method === 'PUT' && request.url === '/settings/sources.json') {
      let raw = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => {
        raw += chunk
      })
      request.on('end', () => {
        savedPayload = JSON.parse(raw)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ status: 'saved', sources: savedPayload.sources }))
      })
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'not found' }))
  })
  await new Promise((resolveListen) => {
    server.listen(0, '127.0.0.1', resolveListen)
  })
  t.after(() => {
    server.close()
  })

  const address = server.address()
  const result = await registerSources({
    bridgeUrl: `http://127.0.0.1:${address.port}`,
    configPath,
    selectedIds: new Set(['wiki-index', 'onharu-wiki-index']),
  })

  assert.equal(result.payload.sources.length, 3)
  assert.equal(savedPayload.sources.find((source) => source.id === 'local-sample').selected, false)
  assert.equal(savedPayload.sources.find((source) => source.id === 'wiki-index').selected, true)
  assert.equal(savedPayload.sources.find((source) => source.id === 'onharu-wiki-index').selected, true)
  assert.equal(savedPayload.sources.find((source) => source.id === 'wiki-index').url, 'http://127.0.0.1:11001')
  assert.equal(savedPayload.sources.find((source) => source.id === 'local-sample').url, 'http://127.0.0.1:8765')
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

function disableCiEnvironmentForTtyTest(t) {
  const keys = ['CI', 'GITHUB_ACTIONS', 'TF_BUILD', 'BUILD_BUILDID']
  const previous = new Map(keys.map((key) => [key, process.env[key]]))
  for (const key of keys) {
    delete process.env[key]
  }
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })
}

function captureTtyWritable() {
  const stream = captureWritable()
  Object.defineProperty(stream, 'isTTY', { value: true })
  stream.columns = 80
  stream.rows = 24
  return stream
}

function ttyReadable() {
  const stream = new Readable({
    read() {},
  })
  Object.defineProperty(stream, 'isTTY', { value: true })
  stream.setRawMode = () => stream
  return stream
}

function nonTtyReadable() {
  return new Readable({
    read() {},
  })
}

function noopProgress() {
  return {
    start() {},
    stop() {},
    error() {},
  }
}

async function runQuickstartScreenTransitionFixture({ stdin = ttyReadable(), stdout = captureTtyWritable(), options = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-screen-transition-'))
  const sourcePath = join(root, 'screen-transition-wiki')
  const configPath = join(root, 'sources.json')
  const answers = ['y', '', 'y', 'n']
  const candidate = {
    rank: 1,
    path: sourcePath,
    score: 80,
    confidence: 'high',
    markdownCount: 20,
    signals: ['llmwiki-root:hot+index-or-overview', 'llmwiki-typed-dir', 'frontmatter:source_refs'],
  }

  const result = await quickstart(
    { path: '.', config: configPath, ...options },
    {
      stdin,
      stdout,
      stderr: stdout,
      createDiscoveryProgress: noopProgress,
      createValidationProgress: noopProgress,
      async prompt() {
        return answers.shift()
      },
    },
    {
      resolveServeInvocation() {
        return { command: 'mock-serve', baseArgs: [], cwd: process.cwd() }
      },
      async discoverCandidates(args) {
        return { roots: args.roots, count: 1, minScore: args.minScore, candidates: [candidate] }
      },
      async validateCandidate(selected) {
        return {
          ...selected,
          startable: true,
          manifest: {
            title: 'Screen Transition Wiki',
            source_id: 'screen-transition-wiki',
            page_count: 1,
            approved_page_count: 1,
          },
        }
      },
      async startSources(args) {
        return {
          configPath: args.configPath,
          sources: [{
            id: 'screen-transition-wiki',
            title: 'Screen Transition Wiki',
            protocol: 'llmwiki-http',
            status: 'ready',
            selected: true,
            path: sourcePath,
            url: 'http://127.0.0.1:11001',
          }],
        }
      },
    },
  )

  return { result, sourcePath }
}

function writeServeStubScript(root, { neverHealthy = false, pidFile = '', portFile = '' } = {}) {
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
  const portFile = ${JSON.stringify(portFile)}
  if (portFile) {
    writeFileSync(portFile, String(port))
  }
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

async function occupyHealthPortWithNextAvailable() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const port = await freePort()
    if (port >= 65535 || !await canListenOnPort(port + 1)) {
      continue
    }
    const server = createServer((request, response) => {
      if (request.url === '/health') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ status: 'existing' }))
        return
      }
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found')
    })
    try {
      await listenOnPort(server, port)
      return { server, port, nextPort: port + 1 }
    } catch {
      await closeServer(server)
    }
  }
  throw new Error('Could not reserve adjacent test ports')
}

async function freePort() {
  const server = createServer()
  await listenOnPort(server, 0)
  const { port } = server.address()
  await closeServer(server)
  return port
}

async function canListenOnPort(port) {
  const server = createServer()
  try {
    await listenOnPort(server, port)
    return true
  } catch {
    return false
  } finally {
    await closeServer(server)
  }
}

function listenOnPort(server, port) {
  return new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })
}

function closeServer(server) {
  return new Promise((resolveClose) => {
    try {
      server.close(() => resolveClose())
    } catch {
      resolveClose()
    }
  })
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

async function waitForFile(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      return
    }
    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, 25)
    })
  }
  throw new Error(`Timed out waiting for file: ${path}`)
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

function countOccurrences(text, needle) {
  return String(text).split(needle).length - 1
}
