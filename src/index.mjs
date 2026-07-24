import { spawn as nodeSpawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { cancel as clackCancel, confirm as clackConfirm, isCancel as isClackCancel, multiselect as clackMultiselect, spinner as clackSpinner } from '@clack/prompts'
import crossSpawn from 'cross-spawn'
import { cursor, erase } from 'sisteransi'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8788'
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT_START = 11001
const DEFAULT_MAX_DEPTH = 9
const DEFAULT_DISCOVER_LIMIT = 30
const DEFAULT_MIN_SCORE = 30
const FAST_DISCOVERY_EXTRA_DEPTH = 4
const FAST_DISCOVERY_TIMEOUT_MS = 30000
const FAST_DISCOVERY_MAX_BUFFER = 32 * 1024 * 1024
const ASYNC_DISCOVERY_YIELD_EVERY = 64
const DEFAULT_SOURCE_HEALTH_TIMEOUT_MS = 15000
const DEFAULT_SOURCE_HEALTH_INTERVAL_MS = 500
const SOURCE_PORT_PROBE_MAX_ATTEMPTS = 200
const DEFAULT_DISCOVERY_PROGRESS_INTERVAL_MS = 1000
const DEFAULT_DISCOVERY_PROGRESS_MESSAGE = 'Searching local folders for LLMWiki candidates...'
const DEFAULT_TERMINAL_ROW_FALLBACK = 1000
const DEFAULT_BRIDGE_PACKAGE_SPEC = 'llmwiki-agent-bridge@0.1.0'
const DEFAULT_BRIDGE_RUNTIME_BASE_URL = 'http://127.0.0.1:8642/v1'
const DEFAULT_RUNTIME_FRAMEWORK_DETECTION_TIMEOUT_MS = 1500
const RUNTIME_FRAMEWORK_COMMAND_MAX_BUFFER = 64 * 1024
const BRIDGE_MODE_EVIDENCE_ONLY = 'evidence-only'
const BRIDGE_MODE_DELEGATED_RUNTIME = 'delegated-runtime'
const BRIDGE_ORCHESTRATION_MODES = new Set([BRIDGE_MODE_EVIDENCE_ONLY, BRIDGE_MODE_DELEGATED_RUNTIME, 'hybrid'])
const RUNTIME_PROFILES = new Set(['generic', 'hermes', 'deepagents'])
const BRIDGE_RUNTIME_ENV_KEYS_TO_SCRUB = [
  'LLMWIKI_AGENT_BRIDGE_BASE_URL',
  'LLMWIKI_AGENT_BRIDGE_MODEL',
  'LLMWIKI_AGENT_BRIDGE_API_KEY',
  'LLMWIKI_AGENT_BRIDGE_RUNTIME_PROFILE',
  'HERMES_BASE_URL',
  'HERMES_MODEL',
  'HERMES_API_KEY',
  'HERMES_A2A_BRIDGE_RUNTIME_PROFILE',
  'HERMES_A2A_BRIDGE_RUNTIME_ID',
  'HERMES_A2A_BRIDGE_RUNTIME_NAME',
  'HERMES_A2A_BRIDGE_RUNTIME',
  'HERMES_A2A_BRIDGE_AGENT_RUNTIME',
  'HERMES_A2A_BRIDGE_PROVIDER_ORGANIZATION',
  'HERMES_A2A_BRIDGE_BEARER_TOKEN',
  'DEEPAGENTS_BASE_URL',
  'DEEPAGENTS_MODEL',
  'DEEPAGENTS_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'OPENAI_API_KEY',
]
const RUNTIME_SETUP_SKIP = 'skip'
const RUNTIME_SETUP_EXISTING = 'existing'
const RUNTIME_SETUP_HERMES = 'hermes'
const RUNTIME_SETUP_DEEPAGENTS = 'deepagents'
const RUNTIME_SETUP_CHOICES = [
  {
    id: RUNTIME_SETUP_SKIP,
    rank: '1',
    label: 'skip/evidence-only',
    aliases: ['1', 'skip', 's', 'evidence', 'evidence-only', 'none'],
    model: 'local-model',
    profile: 'generic',
  },
  {
    id: RUNTIME_SETUP_HERMES,
    rank: '2',
    label: 'Hermes',
    aliases: ['2', 'hermes'],
    model: 'hermes-agent',
    profile: 'hermes',
  },
  {
    id: RUNTIME_SETUP_DEEPAGENTS,
    rank: '3',
    label: 'DeepAgents',
    aliases: ['3', 'deepagents', 'deep-agents'],
    model: 'deepagents-local',
    profile: 'deepagents',
  },
]
const RUNTIME_SETUP_COMPAT_CHOICES = [
  ...RUNTIME_SETUP_CHOICES,
  {
    id: RUNTIME_SETUP_EXISTING,
    rank: 'existing',
    label: 'preconfigured LLM endpoint',
    aliases: ['existing', 'endpoint', 'llm', 'existing-endpoint', 'existing-llm-endpoint'],
    model: 'local-model',
    profile: 'generic',
  },
]
const QUICKSTART_CLEAR_SCREEN_OPT_OUT_ENV = [
  'LLMWIKI_BRIDGE_START_NO_CLEAR_SCREEN',
  'LLMWIKI_BRIDGE_START_DISABLE_SCREEN_CLEAR',
  'LLMWIKI_BRIDGE_START_NO_CLEAR',
  'LLMWIKI_QUICKSTART_NO_CLEAR_SCREEN',
]
const QUICKSTART_STEP_TOTAL = 5
const QUICKSTART_SELECTION_PROMPT = 'Select source folders to start (comma-separated ranks, "all", or "q"; default 1)'
const GENERIC_MARKDOWN_SCORE_CAP = 25
const VARIANT_NATIVE_LLMWIKI = 'native-llmwiki-openwiki'
const VARIANT_LLMWIKI_MARKDOWN = 'llmwiki-markdown'
const VARIANT_OBSIDIAN = 'obsidian-vault'
const VARIANT_LOGSEQ = 'logseq-graph'
const VARIANT_DENDRON = 'dendron-workspace'
const VARIANT_FOAM = 'foam-workspace'
const VARIANT_QUARTZ = 'quartz-source'
const VARIANT_GENERIC_MARKDOWN = 'generic-markdown'
const VARIANT_LABELS = {
  [VARIANT_NATIVE_LLMWIKI]: 'Native LLMWiki/OpenWiki',
  [VARIANT_LLMWIKI_MARKDOWN]: 'LLMWiki Markdown',
  [VARIANT_OBSIDIAN]: 'Obsidian vault',
  [VARIANT_LOGSEQ]: 'Logseq graph',
  [VARIANT_DENDRON]: 'Dendron workspace',
  [VARIANT_FOAM]: 'Foam workspace',
  [VARIANT_QUARTZ]: 'Quartz source',
  [VARIANT_GENERIC_MARKDOWN]: 'Generic Markdown',
}
const ADAPTER_VARIANTS = {
  'llmwiki-markdown': VARIANT_LLMWIKI_MARKDOWN,
  'generic-markdown': VARIANT_GENERIC_MARKDOWN,
}
const QUICKSTART_RECOMMENDED_VARIANTS = new Set([
  VARIANT_NATIVE_LLMWIKI,
  VARIANT_LLMWIKI_MARKDOWN,
])
const QUICKSTART_NOISY_PATH_HINTS = [
  'benchmark',
  'demo',
  'e2e',
  'example',
  'examples',
  'fixture',
  'sample',
  'smoke',
  'starter',
  'template',
]
const ADDITIONAL_REASON_APP_VAULT = 'app-vault'
const ADDITIONAL_REASON_GENERIC = 'generic-markdown'
const ADDITIONAL_REASON_NOISY_PATH = 'noisy-path'
const ANSI_CODES = {
  reset: '\u001b[0m',
  boldCyan: '\u001b[1;36m',
  cyan: '\u001b[36m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
}
const STATUS_MARKER_STYLES = {
  info: ['info', 'cyan'],
  ok: ['ok', 'green'],
  run: ['run', 'cyan'],
  skip: ['skip', 'yellow'],
  fail: ['fail', 'red'],
}

const SKIP_DIR_NAMES = new Set([
  '.antigravity',
  '.angular',
  '.bun',
  '.cache',
  '.cargo',
  '.claude',
  '.codex',
  '.cursor',
  '.dart_tool',
  '.docker',
  '.gradle',
  '.git',
  '.hg',
  '.idea',
  '.ipynb_checkpoints',
  '.next',
  '.npm',
  '.nuget',
  '.nx',
  '.parcel-cache',
  '.pnpm-store',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.rustup',
  '.runtime-logs',
  '.serverless',
  '.svelte-kit',
  '.svn',
  '.terraform',
  '.tox',
  '.turbo',
  '.tmp',
  '.venv',
  '.vercel',
  '.vscode',
  '.vscode-test',
  '.yarn',
  '_worktrees',
  '__pycache__',
  '__fixtures__',
  'appdata',
  'build',
  'cache',
  'caches',
  'coverage',
  'dist',
  'downloads',
  'examples',
  'fixtures',
  'logs',
  'node_modules',
  'output',
  'program files',
  'program files (x86)',
  'smoke',
  'temp',
  'test',
  'tests',
  'tmp',
  'uploads',
  'venv',
  'variant-smoke',
  'variants',
  'vendor',
  'windows',
])

const LLMWIKI_WORK_INTERNAL_DIRS = new Set([
  'e2e-public',
  'input',
  'sources',
])

const LLMWIKI_TYPED_DIRS = [
  'concepts',
  'entities',
  'sources',
  'queries',
  'comparisons',
  'synthesis',
  'syntheses',
  'projects',
  'categories',
  'questions',
]

const HUB_FILES = ['index.md', 'overview.md', 'hot.md', 'critical_facts.md']
const QUARTZ_CONFIGS = [
  'quartz.config.ts',
  'quartz.config.js',
  'quartz.config.yaml',
  'quartz.config.yml',
]

const FAST_DISCOVERY_MARKER_GLOBS = [
  '.wiki-compiler.json',
  'hot.md',
  'graph/graph.json',
  '.obsidian/**',
  'logseq/config.edn',
  'dendron.yml',
  '.foam/**',
  'quartz.config.ts',
  'quartz.config.js',
  'quartz.config.yaml',
  'quartz.config.yml',
  ...LLMWIKI_TYPED_DIRS.map((name) => `${name}/**/*.md`),
  ...LLMWIKI_TYPED_DIRS.map((name) => `${name}/**/*.org`),
]

const FAST_DISCOVERY_GENERIC_GLOBS = [
  '*.md',
  '**/*.md',
  '*.org',
  '**/*.org',
  '.vscode/extensions.json',
]

const FAST_DISCOVERY_EXCLUDE_GLOBS = [
  '!AppData/**',
  '!Applications/**',
  '!Library/**',
  '!System/**',
  '!Windows/**',
  '!Program Files/**',
  '!Program Files (x86)/**',
  '!.cursor-tutor*/**',
  '!node_modules/**',
  '!.git/**',
  '!.hg/**',
  '!.svn/**',
  '!dist/**',
  '!Downloads/**',
  '!build/**',
  '!logs/**',
  '!output/**',
  '!uploads/**',
  '!venv/**',
  '!.venv/**',
  '!.cache/**',
  '!__pycache__/**',
  '!smoke/**',
  '!variant-smoke/**',
  '!variants/**',
  '!.llmwiki-work/e2e-public/**',
  '!.llmwiki-work/input/**',
  '!.llmwiki-work/sources/**',
]

export async function runCli(argv, io = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }) {
  const { command, options } = parseArgs(argv)
  if (options.help || command === 'help') {
    io.stdout.write(helpText())
    return
  }
  if (!command || command === 'quickstart') {
    const json = boolOption(options.json)
    const result = await quickstart(options, json ? { ...io, stdout: io.stderr || io.stdout } : io)
    if (json) {
      writeResult(result, options, io)
    }
    return
  }
  if (command === 'discover') {
    const roots = discoverRootsFromOptions(options)
    const candidates = await discoverCandidates({
      roots,
      maxDepth: intOption(options.depth, DEFAULT_MAX_DEPTH),
      limit: intOption(options.limit, DEFAULT_DISCOVER_LIMIT),
      minScore: intOption(options.minScore ?? options['min-score'], DEFAULT_MIN_SCORE),
      validate: boolOption(options.validate),
      serveInvocation: resolveServeInvocation(options),
    })
    writeResult(candidates, options, io)
    return
  }
  if (command === 'doctor') {
    const result = await doctor({ bridgeUrl: stringOption(options.bridge, DEFAULT_BRIDGE_URL), serveInvocation: resolveServeInvocation(options) })
    writeResult(result, options, io)
    return
  }
  if (command === 'start') {
    const result = await startSources({
      paths: arrayOption(options.path),
      host: stringOption(options.host, DEFAULT_HOST),
      portStart: intOption(options.portStart ?? options['port-start'], DEFAULT_PORT_START),
      ports: arrayOption(options.port).map((value) => Number.parseInt(value, 10)).filter(Number.isInteger),
      serveInvocation: resolveServeInvocation(options),
      configPath: stringOption(options.config, defaultConfigPath()),
      logDir: stringOption(options.logDir ?? options['log-dir'], defaultLogDir()),
    })
    writeResult(result, options, io)
    return
  }
  if (command === 'register') {
    const result = await registerSources({
      bridgeUrl: stringOption(options.bridge, DEFAULT_BRIDGE_URL),
      configPath: stringOption(options.config, defaultConfigPath()),
      sourceUrls: arrayOption(options.sourceUrl ?? options['source-url']),
      selectedIds: new Set(arrayOption(options.selected)),
      selectFirst: boolOption(options.selectFirst ?? options['select-first']),
      replace: boolOption(options.replace),
    })
    writeResult(result, options, io)
    return
  }
  if (command === 'smoke') {
    const result = await smokeBridge({
      bridgeUrl: stringOption(options.bridge, DEFAULT_BRIDGE_URL),
      query: stringOption(options.query, 'What LLMWiki sources are available and what are they for?'),
      mode: bridgeModeOption(options.mode ?? options['orchestration-mode'], BRIDGE_MODE_EVIDENCE_ONLY),
    })
    writeResult(result, options, io)
    return
  }
  throw new Error(`Unknown command: ${command}`)
}

export async function quickstart(options = {}, io = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }, commands = {}) {
  const runtime = {
    discoverCandidates,
    validateCandidate,
    startSources,
    registerSources,
    smokeBridge,
    resolveServeInvocation,
    checkBridgeHealth,
    probeRuntimeEndpoint,
    inspectRuntimeFramework,
    bridgeStartPlan,
    startBridgeCommand,
    waitForBridgeHealth,
    selectBridgeSmokeMode,
    configureBridgeRuntime,
    ...commands,
  }
  const output = io.stdout || process.stdout
  const ui = createQuickstartUi(io, options)
  const prompter = createQuickstartPrompter(io, { yes: boolOption(options.yes ?? options.y) })
  const bridgeUrl = stringOption(options.bridge, DEFAULT_BRIDGE_URL)
  const configPath = stringOption(options.config, defaultConfigPath())
  const serveInvocation = runtime.resolveServeInvocation(options)
  const roots = discoverRootsFromOptions(options)
  const result = {
    command: 'quickstart',
    roots,
    autoDiscover: false,
    selected: [],
    validated: [],
    started: null,
    sourceUrls: [],
    runtimeSetup: null,
    bridgeSetup: null,
    registered: null,
    smoked: null,
    smokeMode: null,
    runSummary: null,
    skipped: [],
  }

  try {
    output.write(formatQuickstartBanner(ui))
    writeQuickstartIntro(output, ui)

    writeQuickstartStep(output, ui, 1, QUICKSTART_STEP_TOTAL, 'Discover sources')
    writeStatus(output, ui, 'info', 'Will scan these root folder(s):')
    output.write(formatQuickstartScanRoots(roots))
    if (!await confirmQuickstart(prompter, formatQuickstartDiscoveryPrompt(options), true)) {
      writeStatus(output, ui, 'skip', 'Skipped discovery.')
      output.write(formatQuickstartDiscoveryDeclineNextAction(options))
      result.skipped.push('discovery', 'selection', 'start', 'bridge-setup', 'register', 'smoke')
      return result
    }
    result.autoDiscover = true

    writeStatus(output, ui, 'run', 'Discovery scans candidates without validation; validation runs only if you start selected sources.')
    const discoveryProgressFactory = io.createDiscoveryProgress || createQuickstartDiscoveryProgress
    const discoveryProgress = discoveryProgressFactory(io, ui)
    discoveryProgress.start(DEFAULT_DISCOVERY_PROGRESS_MESSAGE)
    let discovery
    try {
      discovery = await runtime.discoverCandidates({
        roots,
        maxDepth: intOption(options.depth, DEFAULT_MAX_DEPTH),
        limit: intOption(options.limit, DEFAULT_DISCOVER_LIMIT),
        minScore: intOption(options.minScore ?? options['min-score'], DEFAULT_MIN_SCORE),
        validate: false,
        serveInvocation,
      })
      discoveryProgress.stop(formatQuickstartDiscoveryProgressSummary(discovery))
    } catch (error) {
      discoveryProgress.error('Discovery failed before candidate selection.')
      throw error
    }
    result.discovery = discovery

    if (!discovery.candidates.length) {
      writeStatus(output, ui, 'skip', 'No LLMWiki candidates found.')
      output.write('Try --path DIR or --min-score 10 for generic Markdown folders.\n')
      result.skipped.push('selection', 'start', 'bridge-setup', 'register', 'smoke')
      return result
    }

    writeQuickstartStep(output, ui, 2, QUICKSTART_STEP_TOTAL, 'Choose source folders')
    const candidatePlan = planQuickstartCandidateSelection(discovery.candidates, options)
    result.candidateSelection = summarizeQuickstartCandidateSelection(candidatePlan)
    if (!candidatePlan.visibleCandidates.length) {
      writeStatus(output, ui, 'skip', 'No recommended LLMWiki source folders found.')
      output.write('Use --include-additional to review advanced/lower-priority app vaults, examples, and generic Markdown candidates.\n')
      result.skipped.push('selection', 'start', 'bridge-setup', 'register', 'smoke')
      return result
    }
    writeStatus(output, ui, 'ok', formatQuickstartCandidateCount(candidatePlan))
    writeStatus(output, ui, 'info', 'Recommended source types: Native LLMWiki/OpenWiki is a compiled projection; LLMWiki Markdown is a source-like wiki served by the Markdown adapter.')
    if (candidatePlan.hiddenAdditionalCount > 0) {
      const reasonText = formatAdditionalReasonCounts(candidatePlan.additionalReasonCounts)
      writeStatus(output, ui, 'info', `${candidatePlan.hiddenAdditionalCount} advanced/lower-priority candidate(s) hidden by default${reasonText ? ` (${reasonText})` : ''}. Use --include-additional to review app vaults, examples, demos, starter/e2e sources, and generic Markdown candidates.`)
    }
    output.write(formatQuickstartCandidateGroups(candidatePlan.groups))
    writePathRedactionNotice(output, ui)

    const selected = await prompter.selectCandidates(candidatePlan.visibleCandidates)
    result.selected = selected.map(summarizeCandidateForFlow)
    if (!selected.length) {
      writeStatus(output, ui, 'skip', 'Quickstart cancelled before starting sources.')
      result.skipped.push('start', 'bridge-setup', 'register', 'smoke')
      return result
    }
    if (ui.screenTransitions) {
      writeQuickstartStep(output, ui, 3, QUICKSTART_STEP_TOTAL, 'Validate and start local sources')
      output.write(formatSelectedSourceEcho(selected, candidatePlan.visibleCandidates))
    } else {
      output.write(formatSelectedSourceEcho(selected, candidatePlan.visibleCandidates))
      writeQuickstartStep(output, ui, 3, QUICKSTART_STEP_TOTAL, 'Validate and start local sources')
    }
    if (!await confirmQuickstart(prompter, `Start ${selected.length} selected source server(s) on loopback?\nThis validates each selected folder first.`, true)) {
      writeStatus(output, ui, 'skip', 'Skipped source startup. No source servers were started.')
      result.skipped.push('start', 'bridge-setup', 'register', 'smoke')
      return result
    }

    const validationProgressFactory = io.createValidationProgress || createQuickstartValidationProgress
    const validationProgress = validationProgressFactory(io, ui)
    validationProgress.start(formatQuickstartValidationProgressMessage(selected.length))
    let validated
    try {
      validated = await Promise.all(selected.map((candidate) => runtime.validateCandidate(candidate, serveInvocation)))
      validationProgress.stop()
    } catch (error) {
      validationProgress.error('Validation failed before source startup.')
      throw error
    }
    result.validated = validated.map(summarizeCandidateForFlow)
    for (const candidate of validated) {
      const name = candidate.manifest?.title || basename(candidate.path)
      writeStatus(output, ui, candidate.startable ? 'ok' : 'fail', `${name} (${candidate.path})`)
      if (!candidate.startable && candidate.validationError) {
        output.write(`  ${candidate.validationError}\n`)
      }
    }
    const startable = validated.filter((candidate) => candidate.startable)
    if (!startable.length) {
      writeStatus(output, ui, 'fail', 'No selected candidates validated successfully; stopping before source startup or bridge setup.')
      result.skipped.push('start', 'bridge-setup', 'register', 'smoke')
      return result
    }
    result.started = await runtime.startSources({
      paths: startable.map((candidate) => candidate.path),
      host: stringOption(options.host, DEFAULT_HOST),
      portStart: intOption(options.portStart ?? options['port-start'], DEFAULT_PORT_START),
      ports: arrayOption(options.port).map((value) => Number.parseInt(value, 10)).filter(Number.isInteger),
      serveInvocation,
      configPath,
      logDir: stringOption(options.logDir ?? options['log-dir'], defaultLogDir()),
    })
    result.sourceUrls = sourceUrlsFromStartedSources(result.started.sources)
    writeStatus(output, ui, 'ok', `Started ${result.started.sources.length} source server(s). Config: ${result.started.configPath}`)
    writeQuickstartPortFallbackInfo(output, ui, result.started.sources)
    writeStatus(output, ui, 'info', 'Started source endpoint(s) are healthy. If you skip bridge setup, quickstart will print MCP Streamable HTTP registration URL(s).')

    writeQuickstartStep(output, ui, 4, QUICKSTART_STEP_TOTAL, 'Optional bridge setup')
    writeStatus(output, ui, 'info', 'llmwiki-agent-bridge is optional. Add it when you want one A2A/MCP-style endpoint that can fan out across all selected sources or use a configured LLM runtime.')
    writeStatus(output, ui, 'info', 'If you skip bridge setup, the direct MCP Streamable HTTP URL(s) printed below are ready to use.')
    if (!await confirmQuickstart(prompter, `Set up llmwiki-agent-bridge as one endpoint for the selected source(s)?\nChoose yes to register these sources with a bridge or start one; choose no to finish with direct MCP URL(s).`, boolOption(options.setupBridge ?? options['setup-bridge']))) {
      writeStatus(output, ui, 'skip', 'Skipped bridge setup. Quickstart complete with direct local source endpoint(s).')
      result.runSummary = writeQuickstartRunSummary({
        sources: result.started.sources,
        configPath: result.started.configPath,
        mode: 'direct',
      })
      output.write(formatCodingAgentRegistrationHandoff(result.started.sources))
      output.write(formatLocalProcessLifecycleNote({ sources: result.started.sources, mode: 'direct', runSummary: result.runSummary }))
      result.skipped.push('bridge-setup', 'register', 'smoke')
      return result
    }

    result.runtimeSetup = await guideRuntimeSetup({
      runtime,
      prompter,
      output,
      ui,
      options,
    })
    const bridgeOptions = mergeRuntimeSetupOptions(options, result.runtimeSetup)

    result.bridgeSetup = await guideBridgeSetup({
      runtime,
      prompter,
      output,
      ui,
      options: bridgeOptions,
      bridgeUrl,
      logDir: stringOption(options.logDir ?? options['log-dir'], defaultLogDir()),
    })
    const smokeOptions = result.bridgeSetup.runtimeConfiguration?.ok === false
      ? mergeRuntimeSetupOptions(options, unconfiguredRuntimeSetup(runtimeSetupChoiceById(RUNTIME_SETUP_SKIP), 'Bridge runtime settings were not applied; quickstart falls back to evidence-only smoke.'))
      : bridgeOptions

    if (result.bridgeSetup.continueToBridge === false) {
      writeStatus(output, ui, 'skip', 'Bridge setup instructions generated. Skipping registration and smoke until the bridge is running.')
      result.runSummary = writeQuickstartRunSummary({
        sources: result.started.sources,
        bridgeSetup: result.bridgeSetup,
        bridgeUrl,
        configPath: result.started.configPath,
        mode: 'deferred-bridge',
      })
      output.write(formatDeferredBridgeSetupNextSteps({ bridgeUrl, configPath, sources: result.started.sources }))
      output.write(formatLocalProcessLifecycleNote({ sources: result.started.sources, bridgeSetup: result.bridgeSetup, mode: 'deferred-bridge', runSummary: result.runSummary }))
      result.skipped.push('register', 'smoke')
      return result
    }

    const registerMode = boolOption(options.replace) ? 'replace' : 'merge'
    writeQuickstartStep(output, ui, 5, QUICKSTART_STEP_TOTAL, 'Register and smoke test')
    writeStatus(output, ui, 'run', `Registering started source(s) with ${bridgeUrl} (${registerMode} mode).`)
    const quickstartSelectedIds = new Set(result.started.sources.map((source) => source.id))
    result.registered = await runtime.registerSources({
      bridgeUrl,
      configPath,
      selectedIds: quickstartSelectedIds,
      replace: boolOption(options.replace),
    })
    writeStatus(output, ui, 'ok', formatQuickstartRegistrationSuccess(result.registered, quickstartSelectedIds))

    const smokePlan = await runtime.selectBridgeSmokeMode({ options: smokeOptions, bridgeUrl, env: process.env })
    result.smokeMode = smokePlan.mode
    writeStatus(output, ui, 'run', `Running bridge smoke in ${formatBridgeModeLabel(smokePlan.mode)} mode (${smokePlan.reason}).`)
    result.smoked = await runtime.smokeBridge({
      bridgeUrl,
      query: stringOption(options.query, 'What LLMWiki sources are available and what are they for?'),
      mode: smokePlan.mode,
    })
    writeStatus(output, ui, 'ok', `Smoke complete: ${result.smoked.status?.state || result.smoked.status?.message?.kind || 'ok'}`)
    result.runSummary = writeQuickstartRunSummary({
      sources: result.started.sources,
      bridgeSetup: result.bridgeSetup,
      bridgeUrl,
      configPath: result.started.configPath,
      registered: result.registered,
      smokeMode: result.smokeMode,
      smoked: result.smoked,
      mode: 'bridge',
    })
    output.write(formatBridgeHandoff(bridgeUrl))
    output.write(formatLocalProcessLifecycleNote({ sources: result.started.sources, bridgeSetup: result.bridgeSetup, mode: 'bridge', runSummary: result.runSummary }))
    return result
  } finally {
    prompter.close()
  }
}

function formatQuickstartRegistrationSuccess(registered, selectedIds = new Set()) {
  const sources = registeredBridgeSources(registered)
  const totalCount = Array.isArray(sources) ? sources.length : selectedIds.size
  const selectedCount = quickstartSelectedBridgeSourceCount(sources, selectedIds)
  return `Registered ${totalCount} total bridge source(s); ${selectedCount} selected for this quickstart. Register merges by default unless --replace is set.`
}

function registeredBridgeSources(registered) {
  if (Array.isArray(registered?.payload?.sources)) {
    return registered.payload.sources
  }
  if (Array.isArray(registered?.response?.sources)) {
    return registered.response.sources
  }
  return null
}

function quickstartSelectedBridgeSourceCount(sources, selectedIds = new Set()) {
  if (!Array.isArray(sources)) {
    return selectedIds.size
  }
  const hasSelectedFlag = sources.some((source) => Object.hasOwn(Object(source), 'selected'))
  if (hasSelectedFlag) {
    return sources.filter((source) => source?.selected === true).length
  }
  const selectedIdStrings = new Set([...selectedIds].map(String))
  const matchingIds = sources.filter((source) => selectedIdStrings.has(String(source?.id))).length
  return matchingIds || selectedIds.size
}

async function guideRuntimeSetup({ prompter, output, ui, options, runtime }) {
  const requestedChoice = requestedRuntimeSetupChoice(options)
  if (requestedChoice?.id === RUNTIME_SETUP_EXISTING) {
    writeStatus(output, ui, 'info', 'Using explicitly requested preconfigured LLM endpoint. This compatibility path is not part of the default QuickStart menu.')
    return promptRuntimeConnection({
      prompter,
      output,
      ui,
      options,
      choice: requestedChoice,
      runtime,
    })
  }

  if (!requestedChoice) {
    const preconfigured = detectLlmRuntime(options, {})
    if (preconfigured.configured) {
      writeStatus(output, ui, 'ok', `Using preconfigured LLM runtime from explicit flags: profile=${preconfigured.profile}, model=${preconfigured.model}, endpoint=${preconfigured.baseUrl}`)
      return configuredRuntimeSetup(runtimeSetupChoiceById(RUNTIME_SETUP_EXISTING), preconfigured, {
        runtimeSetup: RUNTIME_SETUP_EXISTING,
        llmEndpoint: preconfigured.baseUrl,
        llmModel: preconfigured.model,
        runtimeProfile: preconfigured.profile,
      })
    }
  }

  writeQuickstartSubscreen(output, ui, 'Bridge runtime setup')
  writeStatus(output, ui, 'info', 'Choose LLM runtime setup before starting the bridge. Bridge env uses LLMWIKI_AGENT_BRIDGE_BASE_URL, LLMWIKI_AGENT_BRIDGE_MODEL, and LLMWIKI_AGENT_BRIDGE_RUNTIME_PROFILE.')
  output.write(formatRuntimeSetupChoices())

  const fallbackChoice = requestedChoice || runtimeSetupDefaultChoice(options)
  const choice = await promptRuntimeSetupChoice(prompter, output, fallbackChoice)
  writeStatus(output, ui, 'choice', `Runtime setup: ${choice.label}`)

  if (choice.id === RUNTIME_SETUP_SKIP) {
    writeStatus(output, ui, 'skip', 'Continuing with evidence-only bridge mode; no LLM runtime env will be passed to a started bridge.')
    return unconfiguredRuntimeSetup(choice, 'Start or configure an OpenAI-compatible runtime later, then rerun with --llm-endpoint URL --llm-model MODEL --runtime-profile PROFILE.')
  }

  let frameworkStatus = null
  if (choice.id === RUNTIME_SETUP_HERMES || choice.id === RUNTIME_SETUP_DEEPAGENTS) {
    frameworkStatus = await runtime.inspectRuntimeFramework({
      choice,
      options,
      env: process.env,
      probe: runtime.probeRuntimeEndpoint || probeRuntimeEndpoint,
      commandRunner: runtime.runFrameworkCommand || runBufferedCommand,
    })
    writeRuntimeFrameworkStatus(output, ui, choice, frameworkStatus)
    writeRuntimeInstallGuidance(output, ui, choice, frameworkStatus)
  }

  return promptRuntimeConnection({
    prompter,
    output,
    ui,
    options,
    choice,
    runtime,
    frameworkStatus,
  })
}

function formatRuntimeSetupChoices() {
  return [
    'Runtime setup options:',
    '  1) skip/evidence-only — do not configure a model runtime now',
    '  2) Hermes — use/install Hermes, then enter its endpoint',
    '  3) DeepAgents — check dcode install; bridge runtime endpoint must be entered explicitly',
  ].join('\n') + '\n'
}

async function promptRuntimeSetupChoice(prompter, output, fallbackChoice, { maxAttempts = 5 } = {}) {
  let attempts = 0
  while (true) {
    const answer = await prompter.ask(`[?] Choose runtime setup before bridge start (${RUNTIME_SETUP_CHOICES.map((choice) => `${choice.rank}=${choice.label}`).join(', ')}; default ${fallbackChoice.rank})`, fallbackChoice.rank)
    try {
      return parseRuntimeSetupChoice(answer, fallbackChoice)
    } catch (error) {
      attempts += 1
      if (!prompter.repromptYesNo || attempts >= maxAttempts) {
        throw error
      }
      output?.write(`[fail] ${error.message}. Enter 1, 2, 3, skip, hermes, or deepagents.\n`)
    }
  }
}

function parseRuntimeSetupChoice(value, fallbackChoice = runtimeSetupChoiceById(RUNTIME_SETUP_SKIP)) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) {
    return fallbackChoice
  }
  const choice = RUNTIME_SETUP_COMPAT_CHOICES.find((candidate) => candidate.aliases.includes(normalized) || candidate.id === normalized)
  if (!choice) {
    throw new Error(`Unknown runtime setup option: ${value}`)
  }
  return choice
}

function requestedRuntimeSetupChoice(options = {}) {
  const requested = stringOption(options.runtimeSetup ?? options['runtime-setup'], '')
  return requested ? parseRuntimeSetupChoice(requested) : null
}

function runtimeSetupDefaultChoice(options = {}) {
  return runtimeSetupChoiceById(RUNTIME_SETUP_SKIP)
}

function runtimeSetupChoiceById(id) {
  return RUNTIME_SETUP_COMPAT_CHOICES.find((choice) => choice.id === id) || RUNTIME_SETUP_CHOICES[0]
}

function writeRuntimeFrameworkStatus(output, ui, choice, status = {}) {
  const label = frameworkDisplayName(choice)
  if (status.installed) {
    const versionText = status.version ? ` (${status.version})` : ''
    writeStatus(output, ui, 'ok', `${label} install: \`${status.installCheck?.displayCommand || status.command || choice.id}\` detected${versionText}.`)
    const checkSummary = formatFrameworkCheckSummary(status.checks)
    if (checkSummary) {
      writeStatus(output, ui, 'info', `${label} supported checks: ${checkSummary}.`)
    }
  } else {
    writeStatus(output, ui, 'info', `${label} install: \`${status.installCheck?.displayCommand || status.command || choice.id}\` was not detected on PATH.`)
  }
  if (choice.id === RUNTIME_SETUP_HERMES) {
    if (status.runtime?.ok) {
      writeStatus(output, ui, 'ok', `${label} runtime: API health detected at ${status.runtime.url}; prompt default is ${status.endpointDefault?.value || status.runtime.baseUrl}.`)
    } else if (status.installed) {
      writeStatus(output, ui, 'info', `${label} runtime: CLI is installed, but no supported API health endpoint responded. Start Hermes until ${formatHermesRuntimeProbeTarget(status)} answers /health or /v1/health, or enter a reachable endpoint below.`)
    } else {
      writeStatus(output, ui, 'info', `${label} runtime: no supported local API health endpoint was detected. Quickstart will not infer a Hermes endpoint from HERMES_BASE_URL or other legacy aliases.`)
    }
  }
  if (choice.id === RUNTIME_SETUP_DEEPAGENTS) {
    if (status.endpointDefault?.value) {
      writeStatus(output, ui, 'info', `${label} runtime: using the standard ${status.endpointDefault.source} endpoint as the prompt default; dcode config is not used as a runtime endpoint default.`)
    } else {
      writeStatus(output, ui, 'info', `${label} runtime: no supported OpenAI-compatible local endpoint discovery method is recorded, so enter the endpoint after starting it or type skip for evidence-only.`)
    }
  }
}

function frameworkDisplayName(choice = {}) {
  return choice.id === RUNTIME_SETUP_DEEPAGENTS ? 'DeepAgents Code' : (choice.label || choice.id || 'Runtime framework')
}

function formatFrameworkCheckSummary(checks = []) {
  return checks
    .filter((check) => check.name && check.name !== 'version')
    .map((check) => `${check.name} ${formatFrameworkCheckState(check)}`)
    .join('; ')
}

function formatFrameworkCheckState(check = {}) {
  if (check.ok && check.safeConfig?.ok === false) {
    return 'readable; secret-like config values omitted'
  }
  if (check.ok) {
    return 'ok'
  }
  if (check.skipped) {
    return 'skipped'
  }
  return 'unavailable'
}

function formatHermesRuntimeProbeTarget(status = {}) {
  const firstProbe = status.endpointDefault?.probes?.[0]
  return firstProbe?.baseUrl || status.endpointDefault?.rejected?.value || DEFAULT_BRIDGE_RUNTIME_BASE_URL
}

function writeRuntimeInstallGuidance(output, ui, choice, status = {}) {
  const installPlan = runtimeInstallPlan(choice)
  if (installPlan.autoInstallAvailable) {
    writeStatus(output, ui, 'info', `${choice.label} install command is documented for this repository. Quickstart can run it only after explicit approval.`)
    output.write(`  ${formatCommand(installPlan.command)}\n`)
    return
  }
  const label = frameworkDisplayName(choice)
  writeStatus(output, ui, 'info', `No repo-confirmed auto-install command for ${label} was found, so quickstart will not install it automatically.`)
  if (choice.id === RUNTIME_SETUP_DEEPAGENTS) {
    const installAction = status.installed
      ? 'DeepAgents Code appears installed. Use dcode doctor and dcode config show --json for its own supported diagnostics.'
      : 'Install DeepAgents Code from its official docs or trusted local project, then verify it with dcode --version or dcode doctor.'
    const docsLines = Object.values(status.docs || {}).filter(Boolean).map((url) => `Docs: ${url}`)
    output.write([
      `Safe ${label} path: ${installAction}`,
      ...docsLines,
      'Quickstart will not infer a bridge runtime endpoint from DeepAgents config. If you intentionally have an OpenAI-compatible model endpoint for the bridge to call directly, enter it below; otherwise press Enter or type skip to continue evidence-only.',
      `To rerun after the endpoint is running: llmwiki-bridge-start --setup-bridge --llm-endpoint <runtime-url> --llm-model ${choice.model} --runtime-profile ${choice.profile}`,
    ].join('\n') + '\n')
    return
  }
  const installAction = status.installed
    ? `${label} appears installed. Start or configure its supported runtime endpoint, then enter that endpoint below.`
    : `Install ${label} from its official docs or trusted local project, then start it until it exposes a supported endpoint.`
  const docsLines = Object.values(status.docs || {}).filter(Boolean).map((url) => `Docs: ${url}`)
  output.write([
    `Safe ${label} path: ${installAction}`,
    ...docsLines,
    `After it is running, enter its base URL below or rerun: llmwiki-bridge-start --setup-bridge --llm-endpoint <runtime-url> --llm-model ${choice.model} --runtime-profile ${choice.profile}`,
  ].join('\n') + '\n')
}

function runtimeInstallPlan(choice) {
  return {
    runtime: choice.id,
    autoInstallAvailable: false,
    command: null,
  }
}

async function promptRuntimeConnection({ prompter, output, ui, options, choice, runtime: runtimeApi = { probeRuntimeEndpoint }, frameworkStatus = null }) {
  const endpointDefault = frameworkStatus?.endpointDefault || await resolveRuntimeEndpointDefault({
    choice,
    options,
    env: process.env,
    probe: runtimeApi.probeRuntimeEndpoint || probeRuntimeEndpoint,
  })
  writeRuntimeEndpointDefaultNotice(output, ui, choice, endpointDefault)
  const endpointAnswer = await promptRuntimeEndpoint(
    prompter,
    formatRuntimeEndpointPrompt(choice, endpointDefault),
    endpointDefault.value,
  )
  const baseUrl = normalizeRuntimeBaseUrl(endpointAnswer)
  if (!baseUrl) {
    const nextAction = runtimeEndpointMissingNextAction(choice)
    writeStatus(output, ui, 'skip', `No runtime endpoint entered. Continuing with evidence-only bridge mode. Next action: ${nextAction}`)
    return unconfiguredRuntimeSetup(choice, nextAction)
  }
  const endpointProbe = await verifyRuntimeEndpointForChoice({
    choice,
    baseUrl,
    output,
    ui,
    probe: runtimeApi.probeRuntimeEndpoint || probeRuntimeEndpoint,
  })
  if (endpointProbe.ok === false) {
    const nextAction = `Start ${choice.label} and verify its supported health endpoint, then rerun with --llm-endpoint <runtime-url> --llm-model ${choice.model} --runtime-profile ${choice.profile}.`
    writeStatus(output, ui, 'skip', `Runtime endpoint was not accepted. Continuing with evidence-only bridge mode. Next action: ${nextAction}`)
    return unconfiguredRuntimeSetup(choice, nextAction)
  }

  const model = await promptRuntimeValue(
    prompter,
    `[?] Runtime model name for LLMWIKI_AGENT_BRIDGE_MODEL`,
    runtimeModelDefault(choice, options, process.env),
  )
  const profile = choice.id === RUNTIME_SETUP_EXISTING
    ? await promptRuntimeProfile(
        prompter,
        output,
        `[?] Runtime profile for LLMWIKI_AGENT_BRIDGE_RUNTIME_PROFILE (generic, hermes, or deepagents)`,
        runtimeProfileDefault(choice, options, process.env),
      )
    : choice.profile
  const runtimeOptions = {
    runtimeSetup: choice.id,
    llmEndpoint: baseUrl,
    llmModel: model || choice.model,
    runtimeProfile: profile || choice.profile,
  }
  const runtimeInfo = detectLlmRuntime(runtimeOptions, {})
  writeStatus(output, ui, 'ok', `Runtime configured for bridge start: profile=${runtimeInfo.profile}, model=${runtimeInfo.model}, endpoint=${runtimeInfo.baseUrl}`)
  return {
    choice: choice.id,
    label: choice.label,
    configured: true,
    baseUrl: runtimeInfo.baseUrl,
    model: runtimeInfo.model,
    profile: runtimeInfo.profile,
    runtimeOptions,
    runtime: runtimeInfo,
  }
}

async function resolveRuntimeEndpointDefault({ choice, options = {}, env = process.env, probe = probeRuntimeEndpoint } = {}) {
  const configured = runtimeEndpointDefaultInfo(choice, options, env)
  if (configured.value) {
    if (choice.id === RUNTIME_SETUP_HERMES) {
      const checked = await probeRuntimeEndpointForDefault({
        baseUrl: configured.value,
        source: configured.source,
        profile: choice.profile,
        probe,
      })
      const health = checked.health
      if (health.ok) {
        return { ...configured, verified: true, health, probes: [checked] }
      }
      return { value: '', rejected: configured, health, probes: [checked] }
    }
    return { ...configured, probes: [] }
  }
  if (choice.id === RUNTIME_SETUP_HERMES) {
    const localHermes = DEFAULT_BRIDGE_RUNTIME_BASE_URL
    const checked = await probeRuntimeEndpointForDefault({
      baseUrl: localHermes,
      source: 'Hermes /health',
      profile: choice.profile,
      probe,
    })
    const health = checked.health
    if (health.ok) {
      return {
        value: localHermes,
        source: 'Hermes /health',
        verified: true,
        health,
        probes: [checked],
      }
    }
    return { value: '', source: '', probes: [checked] }
  }
  return { value: '', source: '', probes: [] }
}

async function probeRuntimeEndpointForDefault({ baseUrl, source, profile, probe }) {
  try {
    return {
      baseUrl,
      source,
      health: await probe({ baseUrl, profile }),
    }
  } catch (error) {
    return {
      baseUrl,
      source,
      health: {
        ok: false,
        baseUrl,
        profile,
        error: error.message,
      },
    }
  }
}

function runtimeEndpointDefaultInfo(choice, options = {}, env = process.env) {
  const candidates = [
    [options.llmEndpoint, '--llm-endpoint'],
    [options['llm-endpoint'], '--llm-endpoint'],
    [options.runtimeBaseUrl, '--runtime-base-url'],
    [options['runtime-base-url'], '--runtime-base-url'],
    [env.LLMWIKI_AGENT_BRIDGE_BASE_URL, 'LLMWIKI_AGENT_BRIDGE_BASE_URL'],
  ]
  for (const [value, source] of candidates) {
    const text = stringOption(value, '')
    if (text) {
      return { value: text, source }
    }
  }
  return { value: '', source: '' }
}

function writeRuntimeEndpointDefaultNotice(output, ui, choice, endpointDefault = {}) {
  if (endpointDefault.rejected?.value) {
    writeStatus(output, ui, 'fail', `${choice.label} endpoint from ${endpointDefault.rejected.source} did not pass health check: ${endpointDefault.health?.error || 'unreachable'}`)
    writeStatus(output, ui, 'info', 'It will not be used as the Enter default. Enter a reachable endpoint or type skip for evidence-only.')
    return
  }
  if (endpointDefault.value && endpointDefault.verified) {
    writeStatus(output, ui, 'ok', `${choice.label} endpoint verified via ${endpointDefault.source}: ${endpointDefault.value}`)
  } else if (endpointDefault.value) {
    writeStatus(output, ui, 'info', `${choice.label} endpoint configured from ${endpointDefault.source}: ${endpointDefault.value}`)
  }
}

async function verifyRuntimeEndpointForChoice({ choice, baseUrl, output, ui, probe = probeRuntimeEndpoint } = {}) {
  if (choice.id !== RUNTIME_SETUP_HERMES) {
    return { ok: true, skipped: true, reason: `${choice.label} has no registered framework health probe in quickstart yet` }
  }
  const health = await probe({ baseUrl, profile: choice.profile })
  if (health.ok) {
    writeStatus(output, ui, 'ok', `${choice.label} health check passed: ${health.url}`)
    return health
  }
  writeStatus(output, ui, 'fail', `${choice.label} health check failed for ${baseUrl}: ${health.error || 'unreachable'}`)
  return health
}

function formatRuntimeEndpointPrompt(choice, endpointDefault = {}) {
  if (endpointDefault.value) {
    const source = endpointDefault.verified
      ? `verified from ${endpointDefault.source}`
      : `configured from ${endpointDefault.source}`
    return `[?] ${choice.label} runtime base URL (OpenAI-compatible; ${source}: ${endpointDefault.value}; press Enter to use it, or type skip for evidence-only)`
  }
  if (choice.id === RUNTIME_SETUP_DEEPAGENTS) {
    return '[?] Optional bridge runtime base URL (OpenAI-compatible; DeepAgents is checked via dcode, but no DeepAgents endpoint is inferred; press Enter or type skip to continue evidence-only)'
  }
  return `[?] ${choice.label} runtime base URL (OpenAI-compatible, e.g. ${DEFAULT_BRIDGE_RUNTIME_BASE_URL}; press Enter or type skip to continue evidence-only)`
}

function runtimeEndpointMissingNextAction(choice) {
  const rerun = `rerun with --llm-endpoint <runtime-url> --llm-model ${choice.model} --runtime-profile ${choice.profile}.`
  if (choice.id === RUNTIME_SETUP_DEEPAGENTS) {
    return `If you intentionally have an OpenAI-compatible model endpoint for the bridge to call directly, ${rerun} Otherwise continue with evidence-only bridge mode or direct source MCP URLs.`
  }
  if (choice.id === RUNTIME_SETUP_HERMES) {
    return `Enable the Hermes API server and start the Hermes gateway until /health or /v1/health responds, then ${rerun}`
  }
  return `Start ${choice.label} so it exposes an OpenAI-compatible endpoint, then ${rerun}`
}

async function promptRuntimeEndpoint(prompter, question, fallback = '') {
  const answer = await prompter.ask(question, fallback)
  const value = String(answer ?? '').trim()
  if (['skip', 'none', 'evidence', 'evidence-only'].includes(value.toLowerCase())) {
    return ''
  }
  return value || fallback
}

async function promptRuntimeValue(prompter, question, fallback = '') {
  const answer = await prompter.ask(question, fallback)
  const value = String(answer ?? '').trim()
  return value || fallback
}

async function promptRuntimeProfile(prompter, output, question, fallback = 'generic', { maxAttempts = 5 } = {}) {
  let attempts = 0
  while (true) {
    const answer = await promptRuntimeValue(prompter, question, fallback)
    try {
      return parseRuntimeProfile(answer, fallback)
    } catch (error) {
      attempts += 1
      if (!prompter.repromptYesNo || attempts >= maxAttempts) {
        throw error
      }
      output?.write(`[fail] ${error.message}. Enter generic, hermes, or deepagents.\n`)
    }
  }
}

function runtimeEndpointDefault(choice, options = {}, env = process.env) {
  return runtimeEndpointDefaultInfo(choice, options, env).value
}

function runtimeModelDefault(choice, options = {}, env = process.env) {
  return stringOption(
    options.llmModel
      ?? options['llm-model']
      ?? options.model
      ?? env.LLMWIKI_AGENT_BRIDGE_MODEL,
    choice.model,
  )
}

function runtimeProfileDefault(choice, options = {}, env = process.env) {
  return parseRuntimeProfile(stringOption(
    options.runtimeProfile
      ?? options['runtime-profile']
      ?? env.LLMWIKI_AGENT_BRIDGE_RUNTIME_PROFILE,
    choice.profile,
  ), choice.profile)
}

function normalizeRuntimeBaseUrl(value) {
  const text = String(value || '').trim()
  if (!text) {
    return ''
  }
  const parsed = new URL(text)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported runtime endpoint protocol: ${parsed.protocol}`)
  }
  if (parsed.username || parsed.password) {
    throw new Error('Runtime endpoint URL must not contain credentials.')
  }
  return trimTrailingSlash(parsed.toString())
}

function unconfiguredRuntimeSetup(choice, nextAction) {
  return {
    choice: choice.id,
    label: choice.label,
    configured: false,
    fallback: BRIDGE_MODE_EVIDENCE_ONLY,
    runtimeOptions: {
      runtimeSetup: choice.id,
      noLlmRuntime: true,
    },
    runtime: detectLlmRuntime({ noLlmRuntime: true }, {}),
    nextAction,
  }
}

function configuredRuntimeSetup(choice, runtime, runtimeOptions = {}) {
  return {
    choice: choice.id,
    label: choice.label,
    configured: true,
    baseUrl: runtime.baseUrl,
    model: runtime.model,
    profile: runtime.profile,
    runtimeOptions,
    runtime,
  }
}

function mergeRuntimeSetupOptions(options = {}, runtimeSetup = null) {
  return {
    ...options,
    ...(runtimeSetup?.runtimeOptions || {}),
  }
}

async function guideBridgeSetup({ runtime, prompter, output, ui, options, bridgeUrl, logDir }) {
  writeQuickstartSubscreen(output, ui, 'Bridge process startup')
  const existingHealth = await runtime.checkBridgeHealth(bridgeUrl)
  const runtimeInfo = detectLlmRuntime(options)
  if (existingHealth.ok) {
    writeStatus(output, ui, 'ok', `llmwiki-agent-bridge is already reachable at ${bridgeUrl}.`)
    const runtimeConfiguration = await maybeConfigureBridgeRuntime({
      runtime,
      output,
      ui,
      prompter,
      bridgeUrl,
      runtimeInfo,
    })
    return {
      bridgeUrl,
      executed: false,
      continueToBridge: runtimeConfiguration.ok !== false || runtimeConfiguration.continueToEvidenceOnly,
      health: existingHealth,
      runtimeConfiguration,
    }
  }

  const plan = runtime.bridgeStartPlan(options)
  const commandText = formatCommand(plan)
  const manualStartText = formatBridgeManualStartExamples(plan, { bridgeUrl, runtime: runtimeInfo })
  const result = {
    bridgeUrl,
    command: plan,
    commandText,
    manualStartText,
    executed: false,
    continueToBridge: true,
  }

  writeStatus(output, ui, 'info', `No llmwiki-agent-bridge is reachable at ${bridgeUrl} yet. Quickstart can start one as a detached background process, or you can start it yourself in another terminal.`)
  output.write(manualStartText)

  if (runtimeInfo.configured) {
    writeStatus(output, ui, 'info', 'An explicit LLM endpoint is configured for this run, so bridge smoke can use delegated-runtime mode after registration.')
  } else {
    writeStatus(output, ui, 'info', 'No explicit LLM endpoint is configured for this run. Bridge smoke will default to evidence-only unless bridge settings prove otherwise.')
  }

  if (await confirmQuickstart(prompter, `Start llmwiki-agent-bridge now in the background on ${bridgeUrl}?\nQuickstart will run the same command with the env values above detached, write logs under ${logDir}, then wait for bridge health.`, false)) {
    const started = await runtime.startBridgeCommand(plan, { bridgeUrl, logDir, runtime: runtimeInfo })
    Object.assign(result, { executed: true }, started)
    writeStatus(output, ui, 'run', `Started bridge process ${started.processId || 'unknown'}. Logs: ${started.logs?.stdout || 'stdout n/a'}, ${started.logs?.stderr || 'stderr n/a'}`)
    try {
      const health = await runtime.waitForBridgeHealth(bridgeUrl, { timeoutMs: 10000 })
      result.health = health
      writeStatus(output, ui, 'ok', `llmwiki-agent-bridge is reachable at ${bridgeUrl}.`)
    } catch (error) {
      result.health = { ok: false, error: error.message, url: bridgeUrl }
      writeStatus(output, ui, 'fail', `Bridge did not become reachable at ${bridgeUrl}: ${error.message}`)
      result.continueToBridge = await confirmQuickstart(prompter, 'Continue with registration/smoke anyway?\nChoose yes only if the bridge is already running or will become healthy during the check.', false)
    }
    return result
  }

  writeStatus(output, ui, 'info', `If the bridge is not already running at ${bridgeUrl}, start one of the manual examples above in another terminal first.`)
  result.continueToBridge = await confirmQuickstart(prompter, `Continue with registration/smoke against ${bridgeUrl} now?\nChoose yes only if the bridge is already running or will become healthy during the check.`, false)
  return result
}

function formatBridgeManualStartExamples(plan, { bridgeUrl = DEFAULT_BRIDGE_URL, runtime = detectLlmRuntime({}) } = {}) {
  const parsed = new URL(bridgeUrl)
  const envEntries = Object.entries(bridgeStartEnvOverrides(parsed, runtime))
  const powershellEnv = envEntries.map(([key, value]) => `$env:${key}=${quotePowerShellEnvValue(value)}`).join('; ')
  const posixEnv = envEntries.map(([key, value]) => `${key}=${quotePosixEnvValue(value)}`).join(' ')
  return [
    formatBridgeManualStartHeader(plan),
    '  PowerShell:',
    `    ${[powershellEnv, formatPowershellCommand(plan)].filter(Boolean).join('; ')}`,
    '  POSIX sh/bash/zsh:',
    `    ${[posixEnv, formatPosixCommand(plan)].filter(Boolean).join(' ')}`,
    '  Env values used by quickstart/background start:',
    ...envEntries.map(([key, value]) => `    - ${key}=${value}`),
  ].join('\n') + '\n'
}

function formatBridgeManualStartHeader(plan = {}) {
  if (plan.source === 'npx-package' || plan.packageName) {
    return 'Safe manual start examples (copy the one for your shell; no global install, npx uses the package cache):'
  }
  if (plan.source === 'sibling-checkout') {
    return 'Safe manual start examples (copy the one for your shell; using the detected local bridge checkout):'
  }
  return 'Safe manual start examples (copy the one for your shell; env values match the requested bridge URL):'
}

async function maybeConfigureBridgeRuntime({ runtime, output, ui, prompter, bridgeUrl, runtimeInfo }) {
  if (!runtimeInfo.configured) {
    return { ok: true, skipped: true, reason: 'no runtime endpoint configured' }
  }
  writeStatus(output, ui, 'run', `Applying runtime settings to the running bridge at ${bridgeUrl}.`)
  try {
    const configured = await runtime.configureBridgeRuntime({
      bridgeUrl,
      runtime: runtimeInfo,
    })
    writeStatus(output, ui, 'ok', `Bridge runtime settings applied: profile=${runtimeInfo.profile}, model=${runtimeInfo.model}, endpoint=${runtimeInfo.baseUrl}`)
    return { ok: true, skipped: false, ...configured }
  } catch (error) {
    writeStatus(output, ui, 'fail', `Could not apply runtime settings to the running bridge: ${error.message}`)
    const continueToEvidenceOnly = await confirmQuickstart(
      prompter,
      `Continue with registration and evidence-only smoke against ${bridgeUrl}?\nChoose no if you want to open the bridge settings page and fix runtime settings first.`,
      true,
    )
    return {
      ok: false,
      error: error.message,
      continueToEvidenceOnly,
    }
  }
}

function createQuickstartUi(io = {}, options = {}) {
  const input = io.stdin || process.stdin
  const output = io.stdout || process.stdout
  return {
    color: Boolean(output.isTTY) && !process.env.NO_COLOR,
    screenTransitions: shouldUseQuickstartScreenTransitions(io, options, input, output),
  }
}

function shouldUseQuickstartScreenTransitions(io = {}, options = {}, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY || isCiEnvironment()) {
    return false
  }
  if (quickstartScreenTransitionsDisabled(io, options, process.env)) {
    return false
  }
  return true
}

function quickstartScreenTransitionsDisabled(io = {}, options = {}, env = process.env) {
  if (io.disableScreenTransitions || io.disableClearScreen) {
    return true
  }
  if (
    optionDisablesScreenClear(options.clearScreen)
    || optionDisablesScreenClear(options['clear-screen'])
    || optionDisablesScreenClear(options.screenTransitions)
    || optionDisablesScreenClear(options['screen-transitions'])
    || boolOption(options.noClearScreen ?? options['no-clear-screen'])
    || boolOption(options.noScreenTransitions ?? options['no-screen-transitions'])
  ) {
    return true
  }
  return QUICKSTART_CLEAR_SCREEN_OPT_OUT_ENV.some((key) => boolOption(env[key]))
}

function optionDisablesScreenClear(value) {
  if (value === false) {
    return true
  }
  const text = String(value ?? '').trim().toLowerCase()
  return ['0', 'false', 'no', 'off', 'never'].includes(text)
}

function formatQuickstartBanner(ui) {
  const title = 'llmwiki-bridge-start quickstart'
  const padded = ` ${title} `
  const border = `+${'-'.repeat(padded.length)}+`
  return `${paint(ui, 'boldCyan', `${border}\n|${padded}|\n${border}`)}\n`
}

function writeQuickstartIntro(output, ui) {
  writeStatus(output, ui, 'info', 'First time? llmwiki-* lets coding agents use local/project knowledge. llmwiki-serve exposes wiki folders as read-only HTTP/MCP sources.')
  writeStatus(output, ui, 'info', 'llmwiki-agent-bridge is optional; add it when you want one bridge across multiple sources or runtime-backed answers.')
  writeStatus(output, ui, 'info', 'This quickstart finds local wiki folders, starts llmwiki-serve for selected sources, then asks whether to set up the bridge.')
}

function writeQuickstartStep(output, ui, index, total, title) {
  if (index > 1) {
    writeQuickstartScreenBreak(output, ui)
  }
  output.write(`\n${paint(ui, 'boldCyan', `[${index}/${total}] ${title}`)}\n`)
  output.write(`${paint(ui, 'dim', '─'.repeat(50))}\n`)
}

function writeQuickstartSubscreen(output, ui, title) {
  if (!ui.screenTransitions) {
    return
  }
  writeQuickstartScreenBreak(output, ui)
  output.write(`\n${paint(ui, 'boldCyan', title)}\n`)
  output.write(`${paint(ui, 'dim', '─'.repeat(50))}\n`)
}

function writeQuickstartScreenBreak(output, ui) {
  if (!ui.screenTransitions) {
    return
  }
  output.write(formatQuickstartScreenBreak(output))
}

function formatQuickstartScreenBreak(output = process.stdout) {
  const rows = positiveIntOption(output?.rows, DEFAULT_TERMINAL_ROW_FALLBACK)
  const moveToVisibleTop = cursor.up(Math.max(1, rows - 1))
  return `${moveToVisibleTop}${cursor.to(0)}${erase.down()}`
}

function writeStatus(output, ui, kind, message) {
  output.write(`${formatStatusMarker(ui, kind)} ${message}\n`)
}

export function createQuickstartDiscoveryProgress(io = {}, ui = createQuickstartUi(io)) {
  return createQuickstartHeartbeatProgress(io, ui, { phase: 'discovery' })
}

export function createQuickstartValidationProgress(io = {}, ui = createQuickstartUi(io)) {
  return createQuickstartHeartbeatProgress(io, ui, { phase: 'validation' })
}

function createQuickstartHeartbeatProgress(io = {}, ui = createQuickstartUi(io), { phase = 'discovery' } = {}) {
  const output = io.stdout || process.stdout
  const useHeartbeat = shouldUseProgressHeartbeat(io, phase)
  const clackActivity = useHeartbeat ? createClackActivitySpinner(io, phase, output) : null
  const intervalMs = positiveIntOption(io[`${phase}ProgressIntervalMs`] ?? io.progressIntervalMs, DEFAULT_DISCOVERY_PROGRESS_INTERVAL_MS)
  const clock = io[`${phase}ProgressClock`] || io.progressClock || globalThis
  let timer = null
  let openLine = false

  function startTimer() {
    if (!useHeartbeat || typeof clock.setInterval !== 'function') {
      return
    }
    timer = clock.setInterval(() => {
      output.write('.')
    }, intervalMs)
    if (typeof timer?.unref === 'function') {
      timer.unref()
    }
  }

  function clearTimer() {
    if (timer && typeof clock.clearInterval === 'function') {
      clock.clearInterval(timer)
    }
    timer = null
  }

  function finish(kind, message) {
    clearTimer()
    if (clackActivity) {
      if (kind === 'fail') {
        clackActivity.error(message || 'Failed.')
      } else if (message) {
        clackActivity.stop(message)
      } else {
        clackActivity.clear()
      }
      return
    }
    if (openLine) {
      output.write('\n')
      openLine = false
    }
    if (message) {
      writeStatus(output, ui, kind, message)
    }
  }

  return {
    start(message = DEFAULT_DISCOVERY_PROGRESS_MESSAGE) {
      if (clackActivity) {
        clackActivity.start(formatSpinnerProgressMessage(message))
        return
      }
      if (useHeartbeat) {
        output.write(`${formatStatusMarker(ui, 'run')} ${message}`)
        openLine = true
        startTimer()
        return
      }
      writeStatus(output, ui, 'run', message)
    },
    stop(message) {
      finish('ok', message)
    },
    error(message) {
      finish('fail', message)
    },
  }
}

function createClackActivitySpinner(io = {}, phase = 'discovery', output = process.stdout) {
  if (io.forceDotHeartbeat || io[`force${capitalizeAscii(phase)}DotHeartbeat`]) {
    return null
  }
  if (io[`${phase}ProgressClock`] || io.progressClock) {
    return null
  }
  const spinnerFactory = io.clackPrompts
    ? io.clackPrompts.spinner
    : (io.clackSpinner || clackSpinner)
  if (typeof spinnerFactory !== 'function') {
    return null
  }
  try {
    return spinnerFactory({
      indicator: 'timer',
      output,
    })
  } catch {
    return null
  }
}

function formatSpinnerProgressMessage(message) {
  return String(message || '').replace(/\.+$/, '')
}

function shouldUseProgressHeartbeat(io = {}, phase = 'discovery') {
  if (io[`force${capitalizeAscii(phase)}Heartbeat`] || io.forceProgressHeartbeat) {
    return true
  }
  if (io[`disable${capitalizeAscii(phase)}Heartbeat`] || io.disableProgressHeartbeat || isCiEnvironment()) {
    return false
  }
  const output = io.stdout || process.stdout
  return Boolean(output.isTTY)
}

function capitalizeAscii(value) {
  const text = String(value || '')
  return `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`
}

function isCiEnvironment() {
  return Boolean(process.env.CI || process.env.GITHUB_ACTIONS || process.env.TF_BUILD || process.env.BUILD_BUILDID)
}

function formatQuickstartDiscoveryProgressSummary(discovery) {
  const count = Array.isArray(discovery?.candidates)
    ? discovery.candidates.length
    : Number(discovery?.count || 0)
  return `Discovery complete: found ${count} candidate source folder(s).`
}

function formatQuickstartValidationProgressMessage(count) {
  return `Validating ${count} selected candidate(s) with llmwiki-serve manifest.`
}

function formatStatusMarker(ui, kind) {
  const [label, style] = STATUS_MARKER_STYLES[kind] || [kind, 'cyan']
  return paint(ui, style, `[${label}]`)
}

function paint(ui, style, value) {
  if (!ui?.color) {
    return value
  }
  return `${ANSI_CODES[style] || ''}${value}${ANSI_CODES.reset}`
}

export function formatCommand(plan) {
  return [plan.command, ...(plan.args || [])]
    .map((part) => (/\s/.test(part) ? `"${part.replaceAll('"', '\\"')}"` : part))
    .join(' ')
}

function formatPowershellCommand(plan) {
  return [plan.command, ...(plan.args || [])].map(quotePowerShellValue).join(' ')
}

function formatPosixCommand(plan) {
  return [plan.command, ...(plan.args || [])].map(quotePosixValue).join(' ')
}

function quotePowerShellValue(value) {
  const text = String(value ?? '')
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) {
    return text
  }
  return `'${text.replaceAll("'", "''")}'`
}

function quotePosixValue(value) {
  const text = String(value ?? '')
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) {
    return text
  }
  return `'${text.replaceAll("'", "'\"'\"'")}'`
}

function quotePowerShellEnvValue(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`
}

function quotePosixEnvValue(value) {
  return `'${String(value ?? '').replaceAll("'", "'\"'\"'")}'`
}

function formatBridgeModeLabel(mode) {
  if (mode === BRIDGE_MODE_DELEGATED_RUNTIME) {
    return 'A2A delegated-runtime'
  }
  if (mode === 'hybrid') {
    return 'hybrid'
  }
  return 'A2A evidence-only'
}

function sourceUrlsFromStartedSources(sources = []) {
  return sources.map((source) => source.url).filter(Boolean)
}

function writeQuickstartPortFallbackInfo(output, ui, sources = []) {
  for (const source of sources) {
    const requestedPort = sourceRequestedPort(source)
    const assignedPort = sourceAssignedPort(source)
    if (!requestedPort || !assignedPort || requestedPort === assignedPort) {
      continue
    }
    writeStatus(output, ui, 'info', `Requested port ${requestedPort} was occupied; started ${sourceDisplayName(source)} on ${assignedPort}.`)
  }
}

function sourceRequestedPort(source = {}) {
  return Number(source.requestedPort || source.portFallback?.requestedPort || source.portFallback?.requested)
}

function sourceAssignedPort(source = {}) {
  return Number(source.port || source.assignedPort || source.portFallback?.assignedPort || source.portFallback?.assigned || sourcePortFromUrl(source.url))
}

function sourcePortFromUrl(sourceUrl) {
  if (!sourceUrl) {
    return 0
  }
  try {
    return Number(new URL(sourceUrl).port)
  } catch {
    return 0
  }
}

function sourceDisplayName(source = {}) {
  return source.title || source.name || source.id || source.url || 'source'
}

function formatSelectedSourceEcho(selected = [], candidateContext = selected) {
  if (!selected.length) {
    return ''
  }
  const rows = selected.map((candidate) => {
    const label = candidateDisplayTitle(candidate, candidateContext)
    const variant = candidateVariantLabel(candidate)
    return `  - ${label} [${variant}]\n    ${candidate.path}`
  })
  return ['Selected source folder(s):', ...rows].join('\n') + '\n'
}

function formatCodingAgentRegistrationHandoff(sources = []) {
  const mcpUrls = sources.map((source) => sourceMcpStreamUrl(source.url)).filter(Boolean)
  if (!mcpUrls.length) {
    return 'No started MCP URLs were reported.\n'
  }
  return [
    'Coding-agent MCP registration URLs:',
    'These are MCP-over-HTTP/Streamable HTTP server URLs; exact client configuration syntax varies by client.',
    ...mcpUrls.map((url) => `  - ${url}`),
  ].join('\n') + '\n'
}

function formatLocalProcessLifecycleNote({ sources = [], bridgeSetup = null, mode = 'direct', runSummary = null } = {}) {
  if (!sources.length && !bridgeSetup) {
    return ''
  }
  const nextStep = mode === 'bridge'
    ? 'Safe next step: connect your agent or script to the bridge endpoint above.'
    : mode === 'deferred-bridge'
      ? 'Safe next step: start the bridge with a manual example above, then run the register/smoke commands shown above.'
    : 'Safe next step: use the MCP registration URL(s) above, or rerun with --setup-bridge when you want one bridge endpoint.'
  const bridgeState = bridgeSetup
    ? bridgeSetup.executed
      ? 'started by quickstart'
      : 'already running or manually started'
    : 'not used'
  const detailsLine = runSummary?.path
    ? formatDisplayPath(runSummary.path)
    : runSummary?.error
      ? `not written (${runSummary.error})`
      : 'not written'
  const rows = [
    ['Started source servers', String(sources.length)],
    ['Bridge process', bridgeState],
    ['Details file', detailsLine],
  ]
  const bodyLines = []
  if (runSummary?.path) {
    bodyLines.push('Processes stay running after exit; full PIDs/logs are in the details file.')
  } else {
    bodyLines.push('Processes stay running after exit; summary file was not written.')
    bodyLines.push('Compact process details:')
    bodyLines.push(...formatCompactProcessDetailRows({ sources, bridgeSetup }))
  }
  return formatSummaryCard('Operational details', rows, { bodyLines }) + [
    nextStep,
    runSummary?.path
      ? 'To stop later, use the exact PID(s) in the details file or stop the terminal/process you started manually.'
      : 'To stop later, stop only the exact PID(s) shown above or stop the terminal/process you started manually.',
  ].join('\n') + '\n'
}

function formatKeyValueRows(rows = [], { indent = '  ', labelWidth = 24 } = {}) {
  return rows.map(([label, value]) => `${indent}${String(label).padEnd(labelWidth)}${value}`)
}

function formatSummaryCard(title, rows = [], { bodyLines = [] } = {}) {
  const bar = `  ${'─'.repeat(50)}`
  return [
    title,
    '',
    bar,
    ...bodyLines.map((line) => `  ${line}`),
    ...formatKeyValueRows(rows),
    bar,
  ].join('\n') + '\n'
}

function writeQuickstartRunSummary({ sources = [], bridgeSetup = null, bridgeUrl = '', configPath = defaultConfigPath(), registered = null, smokeMode = '', smoked = null, mode = 'direct', summaryPath = defaultRunSummaryPath(configPath) } = {}) {
  try {
    mkdirSync(dirname(summaryPath), { recursive: true })
    writeFileSync(summaryPath, formatQuickstartRunSummary({
      sources,
      bridgeSetup,
      bridgeUrl,
      configPath,
      registered,
      smokeMode,
      smoked,
      mode,
    }), 'utf8')
    return { path: summaryPath }
  } catch (error) {
    return { path: '', error: error.message }
  }
}

function formatQuickstartRunSummary({ sources = [], bridgeSetup = null, bridgeUrl = '', configPath = defaultConfigPath(), registered = null, smokeMode = '', smoked = null, mode = 'direct' } = {}) {
  const lines = [
    '# llmwiki-bridge-start run details',
    '',
    `Mode: ${mode}`,
    `Generated: ${new Date().toISOString()}`,
    `Source config: ${configPath}`,
  ]
  if (bridgeUrl) {
    lines.push(`Bridge URL: ${bridgeUrl}`)
  }
  if (smokeMode) {
    lines.push(`Smoke mode: ${smokeMode}`)
  }
  if (smoked?.status) {
    lines.push(`Smoke status: ${smoked.status.state || smoked.status.message?.kind || 'ok'}`)
  }
  const registeredSources = registeredBridgeSources(registered)
  if (registeredSources) {
    lines.push(`Registered bridge sources: ${registeredSources.length}`)
  }
  if (mode === 'deferred-bridge' && bridgeUrl) {
    lines.push(
      '',
      '## Bridge setup next steps',
      '',
      '1. Start llmwiki-agent-bridge with one of the manual examples shown in the quickstart transcript.',
      '2. After it is reachable, register the started source config and smoke test:',
      `   llmwiki-bridge-start register --bridge ${bridgeUrl} --config ${configPath}`,
      `   llmwiki-bridge-start smoke --bridge ${bridgeUrl} --mode evidence-only`,
    )
  }
  lines.push('', '## Sources')
  if (sources.length) {
    for (const source of sources) {
      lines.push(
        '',
        `### ${sourceDisplayName(source)}`,
        `- URL: ${source.url || 'n/a'}`,
        `- MCP Streamable HTTP: ${source.url ? sourceMcpStreamUrl(source.url) : 'n/a'}`,
        `- Path: ${source.path || 'n/a'}`,
        `- Process: ${formatProcessDetail(source)}`,
      )
    }
  } else {
    lines.push('', 'No source processes were started.')
  }
  if (bridgeSetup) {
    lines.push('', '## Bridge')
    lines.push(`- URL: ${bridgeSetup.bridgeUrl || bridgeUrl || 'n/a'}`)
    lines.push(`- Process: ${bridgeSetup.executed ? formatProcessDetail(bridgeSetup) : 'already running or manually started; PID/log path not captured by quickstart'}`)
    if (bridgeSetup.runtimeConfiguration) {
      lines.push(`- Runtime configuration: ${bridgeSetup.runtimeConfiguration.ok ? 'applied' : 'not applied'}`)
    }
  }
  lines.push(
    '',
    '## Stop guidance',
    '',
    'Stop only the exact PID(s) listed above with your OS process manager, or stop the terminal/process you started manually.',
    'Do not kill unrelated node/python processes by name.',
    '',
  )
  return lines.join('\n')
}

function defaultRunSummaryPath(configPath = defaultConfigPath()) {
  return join(dirname(resolve(configPath)), 'quickstart-handoff.md')
}

function formatCompactProcessDetailRows({ sources = [], bridgeSetup = null } = {}) {
  const rows = []
  for (const source of sources) {
    rows.push(`- Source ${sourceDisplayName(source)}: ${formatProcessDetail(source)}`)
  }
  if (bridgeSetup) {
    const bridgeDetail = bridgeSetup.executed
      ? formatProcessDetail(bridgeSetup)
      : 'already running or manually started; PID/log path not captured by quickstart'
    rows.push(`- Bridge ${bridgeSetup.bridgeUrl || ''}: ${bridgeDetail}`.trimEnd())
  }
  return rows.length ? rows : ['- PID/log path details were not captured.']
}

function formatDeferredBridgeSetupNextSteps({ bridgeUrl, configPath, sources = [] } = {}) {
  const lines = [
    'Bridge setup next steps:',
    '  1) Start llmwiki-agent-bridge with one of the manual examples above.',
    '  2) After it is reachable, register the started source config and smoke test:',
    `     llmwiki-bridge-start register --bridge ${bridgeUrl} --config ${configPath}`,
    `     llmwiki-bridge-start smoke --bridge ${bridgeUrl} --mode evidence-only`,
  ]
  const mcpUrls = sources.map((source) => sourceMcpStreamUrl(source.url)).filter(Boolean)
  if (mcpUrls.length) {
    lines.push('Direct source MCP URL(s) remain usable meanwhile:')
    lines.push(...mcpUrls.map((url) => `  - ${url}`))
  }
  return lines.join('\n') + '\n'
}

function formatProcessDetail(processInfo = {}) {
  const parts = []
  if (processInfo.processId) {
    parts.push(`PID ${processInfo.processId}`)
  }
  if (processInfo.runnerProcessId) {
    parts.push(`runner PID ${processInfo.runnerProcessId}`)
  }
  const logs = formatProcessLogs(processInfo.logs)
  if (logs) {
    parts.push(`logs: ${logs}`)
  }
  return parts.length ? parts.join('; ') : 'PID/log path not available'
}

function formatProcessLogs(logs = {}) {
  const paths = [logs.stdout, logs.stderr].filter(Boolean)
  return paths.join(', ')
}

function formatDisplayPath(path) {
  const resolved = resolve(path)
  const rel = relative(process.cwd(), resolved)
  if (!rel) {
    return '.'
  }
  if (!rel.startsWith('..') && !isAbsolute(rel)) {
    return rel
  }
  return resolved
}

function sourceMcpStreamUrl(sourceUrl) {
  if (!sourceUrl) {
    return ''
  }
  return sourceEndpointUrl(trimTrailingSlash(sourceUrl), '/mcp/stream')
}

function sourceEndpointUrl(sourceUrl, endpointPath) {
  const parsed = new URL(sourceUrl)
  const basePath = parsed.pathname.replace(/\/+$/, '')
  parsed.pathname = `${basePath}${endpointPath}`
  parsed.search = ''
  parsed.hash = ''
  return trimTrailingSlash(parsed.toString())
}

function formatBridgeHandoff(bridgeUrl) {
  const baseUrl = trimTrailingSlash(bridgeUrl)
  return formatSummaryCard('Bridge handoff', [
    ['MCP JSON-RPC', `POST ${sourceEndpointUrl(baseUrl, '/mcp')}`],
    ['A2A answer', `POST ${sourceEndpointUrl(baseUrl, '/message:send')}`],
    ['Settings', sourceEndpointUrl(baseUrl, '/settings')],
    ['Base URL', baseUrl],
  ], { bodyLines: ['Ready bridge endpoints'] }) + [
    'Use the endpoint your agent or script supports; exact client configuration syntax varies by client.',
  ].join('\n') + '\n'
}

function writePathRedactionNotice(output, ui) {
  writeStatus(output, ui, 'info', pathRedactionNoticeText())
}

function pathRedactionNoticeText() {
  return 'Full local paths are shown for disambiguation; redact them before sharing CLI output.'
}

function formatQuickstartScanRoots(roots = []) {
  if (!roots.length) {
    return '  - <none>\n'
  }
  return roots.map((root) => `  - ${root}`).join('\n') + '\n'
}

function planQuickstartCandidateSelection(candidates = [], options = {}) {
  const includeAdditional = boolOption(options.includeAdditional ?? options['include-additional'] ?? options.allCandidates ?? options['all-candidates'])
  const recommended = []
  const additional = []
  for (const candidate of candidates) {
    const policy = quickstartCandidatePolicy(candidate)
    if (policy.recommended) {
      recommended.push({ ...candidate, quickstartReason: policy.reason })
    } else {
      additional.push({ ...candidate, quickstartReason: policy.reason })
    }
  }

  const showAdditional = includeAdditional
  const groups = []
  let nextRank = 1
  if (recommended.length) {
    const ranked = rankQuickstartCandidates(recommended, nextRank, 'recommended')
    nextRank += ranked.length
    groups.push({
      kind: 'recommended',
      title: 'Recommended source folders',
      candidates: ranked,
    })
  }
  if (showAdditional && additional.length) {
    const ranked = rankQuickstartCandidates(additional, nextRank, 'additional')
    groups.push({
      kind: 'additional',
      title: 'Advanced / lower-priority candidates',
      candidates: ranked,
    })
  }

  const visibleCandidates = groups.flatMap((group) => group.candidates)
  return {
    includeAdditional,
    recommended,
    additional,
    recommendedCount: recommended.length,
    additionalCount: additional.length,
    hiddenAdditionalCount: showAdditional ? 0 : additional.length,
    additionalReasonCounts: countQuickstartReasons(additional),
    visibleCandidates,
    groups,
  }
}

function rankQuickstartCandidates(candidates, startRank, quickstartGroup) {
  return candidates.map((candidate, index) => ({
    ...candidate,
    discoveryRank: candidate.rank,
    rank: startRank + index,
    quickstartGroup,
  }))
}

function quickstartCandidatePolicy(candidate = {}) {
  const noisyPathHint = quickstartNoisyPathHint(candidate.path)
  if (noisyPathHint) {
    return { recommended: false, reason: `${ADDITIONAL_REASON_NOISY_PATH}:${noisyPathHint}` }
  }
  const variant = candidateVariant(candidate)
  if (QUICKSTART_RECOMMENDED_VARIANTS.has(variant)) {
    return { recommended: true, reason: 'recommended-llmwiki-source' }
  }
  if (isAppRootSignal(candidate)) {
    return { recommended: false, reason: ADDITIONAL_REASON_APP_VAULT }
  }
  return { recommended: false, reason: ADDITIONAL_REASON_GENERIC }
}

function hasQuickstartNoisyPathHint(path = '') {
  return Boolean(quickstartNoisyPathHint(path))
}

function quickstartNoisyPathHint(path = '') {
  for (const part of normalizePath(path)
    .toLowerCase()
    .split(sep)
    .filter(Boolean)) {
    const tokens = pathSegmentTokens(part)
    const hint = QUICKSTART_NOISY_PATH_HINTS.find((entry) => tokens.includes(entry))
    if (hint) {
      return hint
    }
  }
  return ''
}

function pathSegmentTokens(segment) {
  return String(segment || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function summarizeQuickstartCandidateSelection(plan) {
  return {
    recommendedCount: plan.recommendedCount,
    additionalCount: plan.additionalCount,
    hiddenAdditionalCount: plan.hiddenAdditionalCount,
    includeAdditional: plan.includeAdditional,
    visibleCount: plan.visibleCandidates.length,
    additionalReasonCounts: plan.additionalReasonCounts,
    hiddenAdditional: plan.includeAdditional ? [] : plan.additional.map(summarizeCandidateForFlow),
  }
}

function countQuickstartReasons(candidates = []) {
  const counts = {}
  for (const candidate of candidates) {
    const key = String(candidate.quickstartReason || 'other').split(':')[0] || 'other'
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

function formatAdditionalReasonCounts(counts = {}) {
  const entries = Object.entries(counts).filter(([, count]) => count > 0)
  if (!entries.length) {
    return ''
  }
  return entries
    .map(([reason, count]) => `${count} ${formatQuickstartReason(reason)}`)
    .join(', ')
}

function formatQuickstartReason(reason = '') {
  const key = String(reason).split(':')[0]
  if (key === ADDITIONAL_REASON_APP_VAULT) return 'app vault'
  if (key === ADDITIONAL_REASON_NOISY_PATH) return 'example/demo/starter/e2e-like path'
  if (key === ADDITIONAL_REASON_GENERIC) return 'generic Markdown'
  return key || 'other'
}

function formatQuickstartCandidateCount(plan) {
  const visible = plan.visibleCandidates.length
  if (plan.includeAdditional && plan.recommendedCount && plan.additionalCount) {
    return `Found ${visible} candidate source folder(s): ${plan.recommendedCount} recommended and ${plan.additionalCount} advanced/lower-priority.`
  }
  if (plan.includeAdditional && !plan.recommendedCount) {
    return `Found ${visible} advanced/lower-priority candidate source folder(s).`
  }
  return `Found ${visible} recommended source folder(s).`
}

function formatQuickstartCandidateGroups(groups = []) {
  if (!groups.length) {
    return 'No LLMWiki candidates found.\n'
  }
  const renderedGroups = groups.map((group) => `${group.title}:\n${formatQuickstartCandidateRows(group.candidates)}`)
  return `${renderedGroups.join('\n')}\n  ${formatQuickstartSelectAllLine(groups.some((group) => group.kind === 'additional'))}\n  q) cancel\n`
}

function formatQuickstartCandidates(candidates) {
  if (!candidates.length) {
    return 'No LLMWiki candidates found.\n'
  }
  return `${formatQuickstartCandidateRows(candidates)}\n  ${formatQuickstartSelectAllLine(candidates.some((candidate) => candidate.quickstartGroup === 'additional'))}\n  q) cancel\n`
}

function formatQuickstartSelectAllLine(hasVisibleAdvancedCandidates) {
  return hasVisibleAdvancedCandidates
    ? 'all) select all listed candidates (advanced)'
    : 'all) select all listed candidates'
}

function formatQuickstartCandidateRows(candidates) {
  const rows = candidates.map((candidate, index) => {
    const rank = candidate.rank || index + 1
    const title = candidateDisplayTitle(candidate, candidates)
    const variant = candidateVariantLabel(candidate)
    const pageText = candidate.manifest
      ? `${candidate.manifest.approved_page_count}/${candidate.manifest.page_count} approved`
      : `${candidate.markdownCount} md`
    const displayPath = candidate.path
    const reason = candidate.quickstartGroup === 'additional' && candidate.quickstartReason
      ? `\n     reason: ${formatQuickstartReason(candidate.quickstartReason)}`
      : ''
    return `  ${rank}) ${title} [${variant}] (${candidate.confidence}/${candidate.score}, ${pageText})\n     ${displayPath}${reason}`
  })
  return rows.join('\n')
}

function candidateVariantLabel(candidate = {}) {
  if (candidate.manifest?.adapter) {
    const adapterVariant = ADAPTER_VARIANTS[candidate.manifest.adapter]
    return adapterVariant ? VARIANT_LABELS[adapterVariant] : `${candidate.manifest.adapter} source`
  }
  return VARIANT_LABELS[candidateVariant(candidate)] || VARIANT_LABELS[VARIANT_GENERIC_MARKDOWN]
}

function candidateDisplayTitle(candidate = {}, candidates = []) {
  const rawTitle = candidate.manifest?.title || basename(candidate.path)
  const context = candidateDisplayContext(candidate, candidates)
  return compactText(context ? `${rawTitle} — ${context}` : rawTitle, 64)
}

function candidateDisplayContext(candidate = {}, candidates = []) {
  const candidatePath = String(candidate.path || '')
  if (!candidatePath) {
    return ''
  }
  const base = basename(candidatePath).toLowerCase()
  const repeatsBase = candidates.filter((entry) => basename(String(entry.path || '')).toLowerCase() === base).length > 1
  const hasWorkPath = normalizePath(candidatePath).split(sep).includes('.llmwiki-work')
  if (!repeatsBase && !hasWorkPath) {
    return ''
  }
  return candidateParentContext(candidatePath)
}

function candidateParentContext(candidatePath = '') {
  const parts = normalizePath(candidatePath).split(sep).filter(Boolean)
  if (parts.length < 2) {
    return ''
  }
  const workIndex = parts.lastIndexOf('.llmwiki-work')
  if (workIndex > 0) {
    return [parts[workIndex - 1], parts[workIndex], parts[workIndex + 1]].filter(Boolean).join('/')
  }
  return parts.at(-2) || ''
}

function candidateVariant(candidate = {}) {
  if (candidate.variant && VARIANT_LABELS[candidate.variant]) {
    return candidate.variant
  }
  return classifyVariantFromSignals(Array.isArray(candidate.signals) ? candidate.signals : [])
}

function classifyVariantFromSignals(signals = []) {
  const hasCompilerMarker = hasSignalPrefix(signals, 'llmwiki-marker')
  const hasNativeRoot = hasSignalPrefix(signals, 'llmwiki-root')
  const hasTypedDir = hasSignalPrefix(signals, 'llmwiki-typed-dir')
  const hasSidecarGraph = hasSignalPrefix(signals, 'sidecar-graph')
  const hasHubSignal = hasSignalPrefix(signals, 'hub-file')
  const hasLargeMarkdownSet = signals.includes('markdown:50+')
  const hasSourceLikeName = signals.some((signal) => (
    signal === 'name:wiki'
    || signal === 'name:llmwiki'
    || signal === 'name:openwiki'
    || signal === 'name:vault'
  ))
  const hasSourceRefs = signals.includes('frontmatter:source_refs')

  if (hasCompilerMarker) {
    return VARIANT_NATIVE_LLMWIKI
  }
  if (hasSignalPrefix(signals, 'obsidian')) {
    return VARIANT_OBSIDIAN
  }
  if (hasSignalPrefix(signals, 'logseq')) {
    return VARIANT_LOGSEQ
  }
  if (hasSignalPrefix(signals, 'dendron')) {
    return VARIANT_DENDRON
  }
  if (hasSignalPrefix(signals, 'foam')) {
    return VARIANT_FOAM
  }
  if (hasSignalPrefix(signals, 'quartz')) {
    return VARIANT_QUARTZ
  }
  if (
    (hasNativeRoot && (hasSidecarGraph || hasSourceRefs))
    || (hasTypedDir && (hasSidecarGraph || hasSourceRefs))
    || (hasSidecarGraph && (hasNativeRoot || hasHubSignal || hasSourceRefs))
  ) {
    return VARIANT_NATIVE_LLMWIKI
  }
  if (hasSourceLikeName && hasNativeRoot && hasTypedDir) {
    return VARIANT_LLMWIKI_MARKDOWN
  }
  if (hasSourceLikeName && hasHubSignal && hasTypedDir && hasLargeMarkdownSet) {
    return VARIANT_LLMWIKI_MARKDOWN
  }
  return VARIANT_GENERIC_MARKDOWN
}

function hasSignalPrefix(signals, prefix) {
  return signals.some((signal) => signal.startsWith(prefix))
}

function compactText(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`
}

function createQuickstartPrompter(io, { yes = false } = {}) {
  const input = io.stdin || process.stdin
  const output = io.stdout || process.stdout
  const promptOnOneLine = Boolean(input.isTTY && output.isTTY)
  const usesInteractiveYesNo = shouldUseInteractiveYesNo(io, { yes })
  const usesInteractiveCandidateSelection = shouldUseInteractiveCandidateSelection(io, { yes })
  const clackPrompts = {
    confirm: io.clackPrompts?.confirm || clackConfirm,
    multiselect: io.clackPrompts?.multiselect || clackMultiselect,
    spinner: io.clackPrompts?.spinner || clackSpinner,
    isCancel: io.clackPrompts?.isCancel || isClackCancel,
    cancel: io.clackPrompts?.cancel || clackCancel,
  }

  if (yes) {
    return {
      usesInteractiveCandidateSelection: false,
      output,
      repromptYesNo: false,
      async ask(question, fallback = '') {
        output.write(formatQuickstartPrompt(question, { oneLine: promptOnOneLine }))
        output.write(`${fallback}\n`)
        return ''
      },
      async selectCandidates(candidates) {
        return selectCandidatesWithText(this.ask.bind(this), candidates, { output, reprompt: false })
      },
      close() {},
    }
  }

  if (typeof io.prompt === 'function') {
    return {
      usesInteractiveCandidateSelection,
      output,
      repromptYesNo: true,
      async ask(question, fallback = '') {
        const answer = await io.prompt(formatQuickstartPrompt(question, { oneLine: true }), fallback)
        return String(answer ?? '').trim()
      },
      async selectCandidates(candidates) {
        if (usesInteractiveCandidateSelection) {
          return selectCandidatesWithClack(candidates, { clackPrompts, input, output })
        }
        return selectCandidatesWithText(this.ask.bind(this), candidates, { output, reprompt: true })
      },
      close() {},
    }
  }
  let readline = null
  const queued = []
  const waiters = []
  let closed = false

  function ensureReadline() {
    if (readline) {
      return
    }
    readline = createInterface({ input, crlfDelay: Infinity, terminal: Boolean(input.isTTY) })
    readline.on('line', (line) => {
      const waiter = waiters.shift()
      if (waiter) {
        waiter(line)
      } else {
        queued.push(line)
      }
    })
    readline.on('close', () => {
      closed = true
      while (waiters.length) {
        waiters.shift()(null)
      }
    })
  }

  async function readLine() {
    ensureReadline()
    if (queued.length) {
      return queued.shift()
    }
    if (closed) {
      return null
    }
    return new Promise((resolveLine) => {
      waiters.push(resolveLine)
    })
  }

  function closeReadlineBeforeClack() {
    if (!readline) {
      return
    }
    readline.close()
    readline = null
    closed = false
    queued.length = 0
  }

  return {
    usesInteractiveYesNo,
    usesInteractiveCandidateSelection,
    output,
    repromptYesNo: Boolean(!usesInteractiveYesNo && input.isTTY && output.isTTY),
    async ask(question, fallback = '') {
      output.write(formatQuickstartPrompt(question, { oneLine: promptOnOneLine }))
      const answer = await readLine()
      return String(answer ?? '').trim()
    },
    async confirm(question, fallback = false) {
      if (!usesInteractiveYesNo) {
        return null
      }
      closeReadlineBeforeClack()
      return confirmYesNoWithClack(question, fallback, { clackPrompts, input, output })
    },
    async selectCandidates(candidates) {
      if (usesInteractiveCandidateSelection) {
        closeReadlineBeforeClack()
        return selectCandidatesWithClack(candidates, { clackPrompts, input, output })
      }
      return selectCandidatesWithText(this.ask.bind(this), candidates, { output, reprompt: Boolean(input.isTTY && output.isTTY) })
    },
    close() {
      readline?.close()
    },
  }
}

function shouldUseInteractiveYesNo(io = {}, { yes = false } = {}) {
  const input = io.stdin || process.stdin
  const output = io.stdout || process.stdout
  return Boolean(!yes && (io.forceInteractiveYesNo || (typeof io.prompt !== 'function' && input.isTTY && output.isTTY)))
}

function shouldUseInteractiveCandidateSelection(io = {}, { yes = false } = {}) {
  const input = io.stdin || process.stdin
  const output = io.stdout || process.stdout
  return Boolean(!yes && (io.forceInteractiveCandidateSelection || (typeof io.prompt !== 'function' && input.isTTY && output.isTTY)))
}

async function confirmYesNoWithClack(question, fallback, { clackPrompts, input, output }) {
  const keyTracker = trackClackConfirmDefault(input)
  try {
    const answer = await clackPrompts.confirm({
      message: formatQuickstartYesNoClackMessage(question),
      initialValue: Boolean(fallback),
      input,
      output,
    })
    if (clackPrompts.isCancel(answer)) {
      clackPrompts.cancel('Quickstart cancelled.', { output })
      return { selected: false, defaulted: false }
    }
    return { selected: Boolean(answer), defaulted: keyTracker.defaulted() }
  } finally {
    keyTracker.stop()
  }
}

function trackClackConfirmDefault(input) {
  let sawExplicitChoice = false
  let defaulted = false

  function onKeypress(value, key = {}) {
    const text = String(value || '').toLowerCase()
    if (text === 'y' || text === 'n' || ['left', 'right', 'up', 'down'].includes(key.name)) {
      sawExplicitChoice = true
      return
    }
    if (key.name === 'return' && !sawExplicitChoice) {
      defaulted = true
    }
  }

  input?.on?.('keypress', onKeypress)
  return {
    defaulted() {
      return defaulted
    },
    stop() {
      input?.off?.('keypress', onKeypress)
    },
  }
}

function formatQuickstartYesNoClackMessage(question) {
  return String(question || '').trim()
}

async function selectCandidatesWithText(ask, candidates, { output, reprompt = false, maxAttempts = 5 } = {}) {
  let attempts = 0
  while (true) {
    const selectionAnswer = await ask(`[?] ${QUICKSTART_SELECTION_PROMPT}`, '1')
    try {
      return parseCandidateSelection(selectionAnswer, candidates)
    } catch (error) {
      attempts += 1
      if (!reprompt || attempts >= maxAttempts) {
        throw error
      }
      output?.write(`[fail] ${error.message}. Enter candidate ranks, "all", or "q".\n`)
    }
  }
}

async function selectCandidatesWithClack(candidates, { clackPrompts, input, output }) {
  const initialValues = initialCandidateSelectionValues(candidates)
  const answer = await clackPrompts.multiselect({
    message: 'Select source folders to start',
    options: formatCandidateMultiselectOptions(candidates),
    initialValues,
    cursorAt: initialValues[0],
    required: false,
    input,
    output,
  })
  if (clackPrompts.isCancel(answer)) {
    clackPrompts.cancel('No source folders selected.', { output })
    return []
  }
  if (!Array.isArray(answer) || !answer.length) {
    return []
  }
  return parseCandidateSelection(answer.join(','), candidates, { fallback: 'none' })
}

function formatCandidateMultiselectOptions(candidates) {
  return candidates.map((candidate, index) => {
    const rank = candidateRank(candidate, index)
    const title = candidateDisplayTitle(candidate, candidates)
    const variant = candidateVariantLabel(candidate)
    const pageText = candidate.manifest
      ? `${candidate.manifest.approved_page_count}/${candidate.manifest.page_count} approved`
      : `${candidate.markdownCount} md`
    const reason = candidate.quickstartGroup === 'additional' && candidate.quickstartReason
      ? `; ${formatQuickstartReason(candidate.quickstartReason)}`
      : ''
    return {
      value: rank,
      label: `${rank}) ${title} [${variant}]`,
      hint: `${candidate.confidence}/${candidate.score}, ${pageText}${reason} — ${candidate.path}`,
    }
  })
}

function initialCandidateSelectionValues(candidates) {
  const rankedFirst = candidates.find((candidate, index) => candidateRank(candidate, index) === 1)
  if (!rankedFirst && !candidates.length) {
    return []
  }
  return [candidateRank(rankedFirst || candidates[0], candidates.indexOf(rankedFirst || candidates[0]))]
}

function candidateRank(candidate, index) {
  return Number(candidate?.rank || index + 1)
}

async function confirmQuickstart(prompter, question, fallback) {
  if (typeof prompter.confirm === 'function') {
    const choice = await prompter.confirm(question, fallback)
    if (choice !== null && choice !== undefined) {
      const selected = typeof choice === 'object' ? Boolean(choice.selected) : Boolean(choice)
      const defaulted = typeof choice === 'object' ? Boolean(choice.defaulted) : false
      prompter.output?.write(formatQuickstartYesNoSelection(selected, defaulted))
      return selected
    }
  }

  let attempts = 0
  while (true) {
    const answer = await prompter.ask(formatQuickstartYesNoQuestion(question, fallback), fallback ? 'y' : 'n')
    try {
      const selected = parseYesNo(answer, fallback)
      prompter.output?.write(formatQuickstartYesNoSelection(selected, String(answer ?? '').trim() === ''))
      return selected
    } catch (error) {
      attempts += 1
      if (!prompter.repromptYesNo || attempts >= 5) {
        throw error
      }
      prompter.output?.write(`[fail] ${error.message}. Enter "y" or "n".\n`)
    }
  }
}

function formatQuickstartYesNoQuestion(question, fallback) {
  const promptLabel = fallback ? '[Y/n]' : '[y/N]'
  const lines = String(question || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (!lines.length) {
    return `[?] ${promptLabel}`
  }
  if (lines.length === 1) {
    return `[?] ${lines[0]} ${promptLabel}`
  }
  return [`[?] ${lines[0]}`, ...lines.slice(1), promptLabel].join('\n')
}

function formatQuickstartYesNoSelection(selected, defaulted) {
  const label = selected ? 'Yes' : 'No'
  return `[choice] Selected: ${defaulted ? `defaulted ${label}` : label}\n`
}

function formatQuickstartPrompt(question, { oneLine }) {
  const text = String(question || '').trim().replace(/:+$/, '')
  return oneLine ? `${text}: ` : `${text}:\n`
}

export function parseYesNo(value, fallback = false) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) {
    return Boolean(fallback)
  }
  if (['y', 'yes', 'true', '1'].includes(normalized)) {
    return true
  }
  if (['n', 'no', 'false', '0'].includes(normalized)) {
    return false
  }
  throw new Error(`Expected yes or no, got: ${value}`)
}

export function parseCandidateSelection(value, candidates, { fallback = '1' } = {}) {
  const normalized = String(value ?? '').trim().toLowerCase()
  const selection = normalized || fallback
  if (['q', 'quit', 'cancel', 'none', 'no'].includes(selection)) {
    return []
  }
  const rankMap = new Map(candidates.map((candidate, index) => [Number(candidate.rank || index + 1), candidate]))
  if (selection === 'all' || selection === '*') {
    return [...rankMap.keys()]
      .sort((left, right) => left - right)
      .map((rank) => rankMap.get(rank))
  }
  const entries = selection.split(/[,\s]+/).filter(Boolean)
  if (!entries.length || entries.some((entry) => !/^\d+$/.test(entry))) {
    throw new Error(`Invalid candidate selection: ${value}`)
  }
  const ranks = entries.map((entry) => Number.parseInt(entry, 10))
  const selected = []
  const seen = new Set()
  for (const rank of ranks) {
    if (!rankMap.has(rank)) {
      throw new Error(`Candidate rank out of range: ${rank}`)
    }
    if (!seen.has(rank)) {
      selected.push(rankMap.get(rank))
      seen.add(rank)
    }
  }
  return selected
}

function summarizeCandidateForFlow(candidate) {
  return {
    rank: candidate.rank,
    path: candidate.path,
    score: candidate.score,
    confidence: candidate.confidence,
    variant: candidateVariant(candidate),
    quickstartReason: candidate.quickstartReason,
    startable: candidate.startable,
    manifest: candidate.manifest,
    validationError: candidate.validationError,
  }
}

export function parseArgs(argv) {
  const result = { command: '', options: {} }
  const args = [...argv]
  if (args[0] && !args[0].startsWith('-')) {
    result.command = args.shift()
  }
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token.startsWith('-')) {
      continue
    }
    const normalized = token.replace(/^--?/, '')
    if (normalized.startsWith('no-')) {
      result.options[normalized.slice(3)] = false
      continue
    }
    const inline = normalized.split('=')
    const key = camelOrKebab(inline.shift())
    const value = inline.length ? inline.join('=') : undefined
    if (value !== undefined) {
      pushOption(result.options, key, value)
      continue
    }
    const next = args[index + 1]
    if (!next || next.startsWith('-')) {
      pushOption(result.options, key, true)
      continue
    }
    pushOption(result.options, key, next)
    index += 1
  }
  return result
}

function camelOrKebab(value) {
  return value
}

function pushOption(options, key, value) {
  if (options[key] === undefined) {
    options[key] = value
  } else if (Array.isArray(options[key])) {
    options[key].push(value)
  } else {
    options[key] = [options[key], value]
  }
}

function discoverRootsFromOptions(options) {
  const explicit = arrayOption(options.path)
  if (explicit.length) {
    return explicit.map((entry) => resolve(entry))
  }
  if (boolOption(options.cwd)) {
    return [process.cwd()]
  }
  if (boolOption(options.workspace)) {
    return [join(homedir(), 'workspace')]
  }
  return [homedir()]
}

function formatQuickstartDiscoveryPrompt(options = {}) {
  const constrained = quickstartDiscoveryIsConstrained(options)
  const scopeText = constrained
    ? 'Discovery is constrained to the root(s) shown above.'
    : 'Default discovery scans the current user\'s home unless --path/--workspace/--cwd constrains it.'
  const question = constrained
    ? 'Find LLMWiki/knowledge source folders under the shown root(s)?'
    : 'Auto-discover local LLMWiki/knowledge source folders?'
  return `${question}\n${scopeText}`
}

function formatQuickstartDiscoveryDeclineNextAction(options = {}) {
  if (quickstartDiscoveryIsConstrained(options)) {
    return 'Rerun quickstart when you want to scan the shown root(s), or use `llmwiki-bridge-start start --path DIR` for a specific source folder.\n'
  }
  return 'Run `llmwiki-bridge-start --path DIR` to scan a specific root, or `llmwiki-bridge-start start --path DIR` when you already know a source path.\n'
}

function quickstartDiscoveryIsConstrained(options = {}) {
  return arrayOption(options.path).length > 0
    || boolOption(options.cwd)
    || boolOption(options.workspace)
}

export async function discoverCandidates({
  roots,
  maxDepth = DEFAULT_MAX_DEPTH,
  limit = DEFAULT_DISCOVER_LIMIT,
  minScore = DEFAULT_MIN_SCORE,
  validate = false,
  serveInvocation = resolveServeInvocation({}),
  scanner = scanCandidateDirectoriesAsync,
} = {}) {
  const discovered = new Map()
  for (const root of roots || [homedir()]) {
    const resolvedRoot = resolve(root)
    if (!safeIsDirectory(resolvedRoot)) {
      continue
    }
    const scannedDirectories = await Promise.resolve(scanner({ root: resolvedRoot, maxDepth, minScore }))
    let scoredCount = 0
    for (const path of normalizeScannedCandidateDirectories(scannedDirectories, resolvedRoot, maxDepth)) {
      scoredCount += 1
      if (scoredCount % ASYNC_DISCOVERY_YIELD_EVERY === 0) {
        await yieldToEventLoop()
      }
      const scored = scoreCandidate(path)
      if (scored.score >= minScore) {
        addOrUpdateCandidate(discovered, scored)
      }
      const nestedWiki = join(path, 'wiki')
      if (safeIsDirectory(nestedWiki)) {
        const nested = scoreCandidate(nestedWiki)
        if (nested.score >= minScore) {
          addOrUpdateCandidate(discovered, nested)
        }
      }
    }
  }
  let candidates = [...discovered.values()]
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, Math.max(limit, 1))
    .map((candidate, index) => ({ ...candidate, rank: index + 1, confidence: confidenceForScore(candidate.score) }))

  if (validate) {
    candidates = await Promise.all(
      candidates.map(async (candidate) => validateCandidate(candidate, serveInvocation)),
    )
  }
  return { roots: roots || [homedir()], count: candidates.length, minScore, candidates }
}

export function scanCandidateDirectories({ root = homedir(), maxDepth = DEFAULT_MAX_DEPTH, minScore = DEFAULT_MIN_SCORE, preferExternalTools = true } = {}) {
  const resolvedRoot = resolve(root)
  if (!safeIsDirectory(resolvedRoot)) {
    return []
  }

  if (preferExternalTools) {
    const toolEntries = scanCandidateDirectoryEntriesWithExternalTool(resolvedRoot, maxDepth, minScore)
    if (toolEntries !== null) {
      return materializeCandidateDirectories(toolEntries, resolvedRoot, maxDepth, minScore)
    }
  }

  return scanCandidateDirectoriesWithJavascript(resolvedRoot, maxDepth, minScore)
}

async function scanCandidateDirectoriesAsync({ root = homedir(), maxDepth = DEFAULT_MAX_DEPTH, minScore = DEFAULT_MIN_SCORE, preferExternalTools = true } = {}) {
  const resolvedRoot = resolve(root)
  if (!safeIsDirectory(resolvedRoot)) {
    return []
  }

  if (preferExternalTools) {
    const toolEntries = await scanCandidateDirectoryEntriesWithExternalToolAsync(resolvedRoot, maxDepth, minScore)
    if (toolEntries !== null) {
      return materializeCandidateDirectoriesAsync(toolEntries, resolvedRoot, maxDepth, minScore)
    }
  }

  return scanCandidateDirectoriesWithJavascriptAsync(resolvedRoot, maxDepth, minScore)
}

function normalizeScannedCandidateDirectories(scannedDirectories, root, maxDepth) {
  const normalized = new Set()
  for (const entry of scannedDirectories || []) {
    const path = typeof entry === 'string' ? entry : entry?.path
    if (!path) {
      continue
    }
    addCandidateDirectory(normalized, path, root, maxDepth)
  }
  return [...normalized].sort((left, right) => left.localeCompare(right))
}

function scanCandidateDirectoryEntriesWithExternalTool(root, maxDepth, minScore) {
  const fdCommand = findAvailableCommand(['fd', 'fdfind'])
  if (fdCommand) {
    const fdEntries = scanCandidateDirectoryEntriesWithFd(fdCommand, root, maxDepth, minScore)
    if (fdEntries !== null) {
      return fdEntries
    }
  }

  const rgCommand = findAvailableCommand(['rg'])
  if (rgCommand) {
    const rgEntries = scanCandidateDirectoryEntriesWithRipgrep(rgCommand, root, maxDepth, minScore)
    if (rgEntries !== null) {
      return rgEntries
    }
  }

  return null
}

async function scanCandidateDirectoryEntriesWithExternalToolAsync(root, maxDepth, minScore) {
  const fdCommand = await findAvailableCommandAsync(['fd', 'fdfind'])
  if (fdCommand) {
    const fdEntries = await scanCandidateDirectoryEntriesWithFdAsync(fdCommand, root, maxDepth, minScore)
    if (fdEntries !== null) {
      return fdEntries
    }
  }

  const rgCommand = await findAvailableCommandAsync(['rg'])
  if (rgCommand) {
    const rgEntries = await scanCandidateDirectoryEntriesWithRipgrepAsync(rgCommand, root, maxDepth, minScore)
    if (rgEntries !== null) {
      return rgEntries
    }
  }

  return null
}

function scanCandidateDirectoryEntriesWithFd(command, root, maxDepth, minScore) {
  const scanDepth = maxDepth + FAST_DISCOVERY_EXTRA_DEPTH + 2
  const baseArgs = [
    '--hidden',
    '--no-ignore',
    '--color',
    'never',
    '--max-depth',
    String(scanDepth),
    '--full-path',
    ...fdExcludeArgs(),
  ]
  const fileLines = runDiscoveryCommandLines(command, [
    ...baseArgs,
    '--type',
    'f',
    fdDiscoveryFilePattern({ includeGenericMarkdown: minScore <= 10 }),
    '.',
  ], root)
  if (fileLines === null) {
    return null
  }
  const directoryLines = runDiscoveryCommandLines(command, [
    ...baseArgs,
    '--type',
    'd',
    fdDiscoveryDirectoryPattern({ includeGenericMarkdown: minScore <= 10 }),
    '.',
  ], root)
  if (directoryLines === null) {
    return null
  }
  return [
    ...fileLines.map((path) => ({ path, type: 'file' })),
    ...directoryLines.map((path) => ({ path, type: 'directory' })),
  ]
}

async function scanCandidateDirectoryEntriesWithFdAsync(command, root, maxDepth, minScore) {
  const scanDepth = maxDepth + FAST_DISCOVERY_EXTRA_DEPTH + 2
  const baseArgs = [
    '--hidden',
    '--no-ignore',
    '--color',
    'never',
    '--max-depth',
    String(scanDepth),
    '--full-path',
    ...fdExcludeArgs(),
  ]
  const fileLines = await runDiscoveryCommandLinesAsync(command, [
    ...baseArgs,
    '--type',
    'f',
    fdDiscoveryFilePattern({ includeGenericMarkdown: minScore <= 10 }),
    '.',
  ], root)
  if (fileLines === null) {
    return null
  }
  const directoryLines = await runDiscoveryCommandLinesAsync(command, [
    ...baseArgs,
    '--type',
    'd',
    fdDiscoveryDirectoryPattern({ includeGenericMarkdown: minScore <= 10 }),
    '.',
  ], root)
  if (directoryLines === null) {
    return null
  }
  return [
    ...fileLines.map((path) => ({ path, type: 'file' })),
    ...directoryLines.map((path) => ({ path, type: 'directory' })),
  ]
}

function scanCandidateDirectoryEntriesWithRipgrep(command, root, maxDepth, minScore) {
  const scanDepth = maxDepth + FAST_DISCOVERY_EXTRA_DEPTH + 2
  const lines = runDiscoveryCommandLines(command, [
    '--files',
    '--hidden',
    '--no-ignore',
    '--no-messages',
    '--color',
    'never',
    '--max-depth',
    String(scanDepth),
    ...ripgrepGlobArgs({ includeGenericMarkdown: minScore <= 10 }),
    '.',
  ], root)
  if (lines === null) {
    return null
  }
  return lines.map((path) => ({ path, type: 'file' }))
}

async function scanCandidateDirectoryEntriesWithRipgrepAsync(command, root, maxDepth, minScore) {
  const scanDepth = maxDepth + FAST_DISCOVERY_EXTRA_DEPTH + 2
  const lines = await runDiscoveryCommandLinesAsync(command, [
    '--files',
    '--hidden',
    '--no-ignore',
    '--no-messages',
    '--color',
    'never',
    '--max-depth',
    String(scanDepth),
    ...ripgrepGlobArgs({ includeGenericMarkdown: minScore <= 10 }),
    '.',
  ], root)
  if (lines === null) {
    return null
  }
  return lines.map((path) => ({ path, type: 'file' }))
}

function scanCandidateDirectoriesWithJavascript(root, maxDepth, minScore) {
  const entries = []
  const markerCache = new Map()
  const scanDepth = maxDepth + FAST_DISCOVERY_EXTRA_DEPTH
  const stack = [{ path: root, depth: 0 }]
  while (stack.length) {
    const current = stack.pop()
    if (!current || current.depth > scanDepth || shouldSkipDir(current.path, current.depth === 0)) {
      continue
    }

    if (hasImmediateCandidateMarker(current.path, markerCache, minScore)) {
      entries.push({ path: current.path, type: 'directory' })
    }

    let children = []
    try {
      children = readdirSync(current.path, { withFileTypes: true })
    } catch {
      continue
    }

    for (const child of children) {
      const childPath = join(current.path, child.name)
      if (child.isDirectory()) {
        if (isDiscoveryDirectoryMarker(child.name, minScore)) {
          entries.push({ path: childPath, type: 'directory' })
        }
        if (!shouldSkipDir(childPath) && current.depth < scanDepth) {
          stack.push({ path: childPath, depth: current.depth + 1 })
        }
      } else if (child.isFile() && (
        isDiscoveryFileMarker(child.name, minScore)
        || (isMarkdownOrOrgFile(child.name) && LLMWIKI_TYPED_DIRS.includes(basename(current.path).toLowerCase()))
      )) {
        entries.push({ path: childPath, type: 'file' })
      }
    }
  }
  return materializeCandidateDirectories(entries, root, maxDepth, minScore)
}

async function scanCandidateDirectoriesWithJavascriptAsync(root, maxDepth, minScore) {
  const entries = []
  const markerCache = new Map()
  const scanDepth = maxDepth + FAST_DISCOVERY_EXTRA_DEPTH
  const stack = [{ path: root, depth: 0 }]
  let visited = 0
  while (stack.length) {
    visited += 1
    if (visited % ASYNC_DISCOVERY_YIELD_EVERY === 0) {
      await yieldToEventLoop()
    }

    const current = stack.pop()
    if (!current || current.depth > scanDepth || shouldSkipDir(current.path, current.depth === 0)) {
      continue
    }

    if (hasImmediateCandidateMarker(current.path, markerCache, minScore)) {
      entries.push({ path: current.path, type: 'directory' })
    }

    let children = []
    try {
      children = readdirSync(current.path, { withFileTypes: true })
    } catch {
      continue
    }

    let childCount = 0
    for (const child of children) {
      childCount += 1
      if (childCount % ASYNC_DISCOVERY_YIELD_EVERY === 0) {
        await yieldToEventLoop()
      }
      const childPath = join(current.path, child.name)
      if (child.isDirectory()) {
        if (isDiscoveryDirectoryMarker(child.name, minScore)) {
          entries.push({ path: childPath, type: 'directory' })
        }
        if (!shouldSkipDir(childPath) && current.depth < scanDepth) {
          stack.push({ path: childPath, depth: current.depth + 1 })
        }
      } else if (child.isFile() && (
        isDiscoveryFileMarker(child.name, minScore)
        || (isMarkdownOrOrgFile(child.name) && LLMWIKI_TYPED_DIRS.includes(basename(current.path).toLowerCase()))
      )) {
        entries.push({ path: childPath, type: 'file' })
      }
    }
  }
  return materializeCandidateDirectoriesAsync(entries, root, maxDepth, minScore)
}

function materializeCandidateDirectories(entries, root, maxDepth, minScore) {
  const candidates = new Set()
  const markerCache = new Map()
  if (hasImmediateCandidateMarker(root, markerCache, minScore)) {
    addCandidateDirectory(candidates, root, root, maxDepth)
  }

  for (const entry of entries) {
    const path = resolveScannedPath(root, entry.path)
    if (!isPathAtOrBelowRoot(path, root)) {
      continue
    }
    if (entry.type === 'directory') {
      addCandidateDirectoriesFromScannedDirectory(candidates, path, root, maxDepth, minScore, markerCache)
    } else {
      addCandidateDirectoriesFromScannedFile(candidates, path, root, maxDepth, minScore, markerCache)
    }
  }

  return [...candidates].sort((left, right) => left.localeCompare(right))
}

async function materializeCandidateDirectoriesAsync(entries, root, maxDepth, minScore) {
  const candidates = new Set()
  const markerCache = new Map()
  if (hasImmediateCandidateMarker(root, markerCache, minScore)) {
    addCandidateDirectory(candidates, root, root, maxDepth)
  }

  let processed = 0
  for (const entry of entries) {
    processed += 1
    if (processed % ASYNC_DISCOVERY_YIELD_EVERY === 0) {
      await yieldToEventLoop()
    }
    const path = resolveScannedPath(root, entry.path)
    if (!isPathAtOrBelowRoot(path, root)) {
      continue
    }
    if (entry.type === 'directory') {
      addCandidateDirectoriesFromScannedDirectory(candidates, path, root, maxDepth, minScore, markerCache)
    } else {
      addCandidateDirectoriesFromScannedFile(candidates, path, root, maxDepth, minScore, markerCache)
    }
  }

  return [...candidates].sort((left, right) => left.localeCompare(right))
}

function addCandidateDirectoriesFromScannedDirectory(candidates, path, root, maxDepth, minScore, markerCache) {
  const lower = basename(path).toLowerCase()
  if (lower === '.obsidian' || lower === '.foam' || lower === 'logseq' || (minScore <= 10 && (lower === 'pages' || lower === 'journals' || lower === '.vscode'))) {
    addCandidateDirectory(candidates, dirname(path), root, maxDepth)
  }
  if (LLMWIKI_TYPED_DIRS.includes(lower)) {
    addCandidateDirectory(candidates, dirname(path), root, maxDepth)
  }
  if (minScore <= 10 && SOURCE_LIKE_DIR_NAMES.has(lower)) {
    addCandidateDirectory(candidates, path, root, maxDepth)
  }
  if (hasImmediateCandidateMarker(path, markerCache, minScore)) {
    addCandidateDirectory(candidates, path, root, maxDepth)
  }
}

function addCandidateDirectoriesFromScannedFile(candidates, path, root, maxDepth, minScore, markerCache) {
  const lower = basename(path).toLowerCase()
  const parent = dirname(path)
  const parentBase = basename(parent).toLowerCase()

  if (lower === '.wiki-compiler.json' || lower === 'dendron.yml' || lower === 'hot.md' || (minScore <= 10 && HUB_FILES.includes(lower)) || QUARTZ_CONFIGS.includes(lower)) {
    addCandidateDirectory(candidates, parent, root, maxDepth)
  }
  if (lower === 'config.edn' && parentBase === 'logseq') {
    addCandidateDirectory(candidates, dirname(parent), root, maxDepth)
  }
  if (lower === 'extensions.json' && parentBase === '.vscode' && minScore <= 10) {
    addCandidateDirectory(candidates, dirname(parent), root, maxDepth)
  }
  if (lower === 'graph.json' && parentBase === 'graph') {
    addCandidateDirectory(candidates, dirname(parent), root, maxDepth)
  }

  addAppMarkerAncestor(candidates, path, root, maxDepth, '.obsidian')
  addAppMarkerAncestor(candidates, path, root, maxDepth, '.foam')

  if (isMarkdownOrOrgFile(lower)) {
    addMarkdownCandidateDirectories(candidates, path, root, maxDepth, minScore, markerCache)
  }
}

function addMarkdownCandidateDirectories(candidates, path, root, maxDepth, minScore, markerCache) {
  let current = dirname(path)
  const lowerFile = basename(path).toLowerCase()
  if (lowerFile === 'hot.md' || (minScore <= 10 && HUB_FILES.includes(lowerFile))) {
    addCandidateDirectory(candidates, current, root, maxDepth)
  }

  for (let depth = 0; depth <= FAST_DISCOVERY_EXTRA_DEPTH && isPathAtOrBelowRoot(current, root); depth += 1) {
    const lower = basename(current).toLowerCase()
    if (LLMWIKI_TYPED_DIRS.includes(lower)) {
      addCandidateDirectory(candidates, dirname(current), root, maxDepth)
    }
    if (SOURCE_LIKE_DIR_NAMES.has(lower) || minScore <= 10 || hasImmediateCandidateMarker(current, markerCache, minScore)) {
      addCandidateDirectory(candidates, current, root, maxDepth)
    }
    if (normalizePath(current) === normalizePath(root)) {
      break
    }
    current = dirname(current)
  }
}

function addAppMarkerAncestor(candidates, path, root, maxDepth, markerName) {
  let current = dirname(path)
  while (isPathAtOrBelowRoot(current, root)) {
    if (basename(current).toLowerCase() === markerName) {
      addCandidateDirectory(candidates, dirname(current), root, maxDepth)
      return
    }
    if (normalizePath(current) === normalizePath(root)) {
      return
    }
    current = dirname(current)
  }
}

function addCandidateDirectory(candidates, path, root, maxDepth) {
  const resolved = resolve(path)
  if (!safeIsDirectory(resolved) || !isPathAtOrBelowRoot(resolved, root)) {
    return
  }
  const isRoot = normalizePath(resolved) === normalizePath(root)
  if (directoryDepthFromRoot(resolved, root) > maxDepth || shouldSkipDir(resolved, isRoot) || hasSkippedPathSegment(resolved, root)) {
    return
  }
  candidates.add(resolved)
}

function hasImmediateCandidateMarker(path, cache = new Map(), minScore = DEFAULT_MIN_SCORE) {
  const key = normalizePath(path)
  if (cache.has(key)) {
    return cache.get(key)
  }
  const names = immediateNames(path)
  const lowerNames = new Set([...names].map((name) => name.toLowerCase()))
  const result = (
    lowerNames.has('.wiki-compiler.json')
    || lowerNames.has('.obsidian')
    || lowerNames.has('.foam')
    || lowerNames.has('logseq')
    || lowerNames.has('dendron.yml')
    || lowerNames.has('graph')
    || lowerNames.has('hot.md')
    || (minScore <= 10 && lowerNames.has('.vscode'))
    || (minScore <= 10 && HUB_FILES.some((name) => lowerNames.has(name)))
    || QUARTZ_CONFIGS.some((name) => lowerNames.has(name))
    || LLMWIKI_TYPED_DIRS.some((name) => lowerNames.has(name))
    || (minScore <= 10 && lowerNames.has('pages') && lowerNames.has('journals'))
    || (minScore <= 10 && SOURCE_LIKE_DIR_NAMES.has(basename(path).toLowerCase()))
  )
  cache.set(key, result)
  return result
}

function isDiscoveryFileMarker(name, minScore = DEFAULT_MIN_SCORE) {
  const lower = name.toLowerCase()
  return (
    (minScore <= 10 && isMarkdownOrOrgFile(lower))
    || lower === '.wiki-compiler.json'
    || lower === 'dendron.yml'
    || lower === 'config.edn'
    || lower === 'graph.json'
    || (minScore <= 10 && lower === 'extensions.json')
    || lower === 'hot.md'
    || (minScore <= 10 && HUB_FILES.includes(lower))
    || QUARTZ_CONFIGS.includes(lower)
  )
}

function isDiscoveryDirectoryMarker(name, minScore = DEFAULT_MIN_SCORE) {
  const lower = name.toLowerCase()
  return (
    lower === '.obsidian'
    || lower === '.foam'
    || (minScore <= 10 && lower === '.vscode')
    || lower === 'logseq'
    || (minScore <= 10 && lower === 'pages')
    || (minScore <= 10 && lower === 'journals')
    || (minScore <= 10 && SOURCE_LIKE_DIR_NAMES.has(lower))
  )
}

function isMarkdownOrOrgFile(name) {
  const lower = name.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.org')
}

const SOURCE_LIKE_DIR_NAMES = new Set(['wiki', 'llmwiki', 'openwiki', 'vault'])
const COMMAND_AVAILABILITY = new Map()

function findAvailableCommand(commands) {
  for (const command of commands) {
    if (COMMAND_AVAILABILITY.has(command)) {
      if (COMMAND_AVAILABILITY.get(command)) {
        return command
      }
      continue
    }
    const result = spawnSync(command, ['--version'], {
      stdio: 'ignore',
      timeout: 1500,
      windowsHide: true,
    })
    const available = !result.error && result.status === 0
    COMMAND_AVAILABILITY.set(command, available)
    if (available) {
      return command
    }
  }
  return null
}

async function findAvailableCommandAsync(commands) {
  for (const command of commands) {
    if (COMMAND_AVAILABILITY.has(command)) {
      if (COMMAND_AVAILABILITY.get(command)) {
        return command
      }
      continue
    }
    const result = await runBufferedCommand(command, ['--version'], {
      timeoutMs: 1500,
      maxBuffer: 1024 * 1024,
    })
    const available = !result.error && result.status === 0
    COMMAND_AVAILABILITY.set(command, available)
    if (available) {
      return command
    }
  }
  return null
}

function runDiscoveryCommandLines(command, args, root) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: FAST_DISCOVERY_MAX_BUFFER,
    timeout: FAST_DISCOVERY_TIMEOUT_MS,
    windowsHide: true,
  })
  if (result.error || ![0, 1, 2].includes(result.status)) {
    return null
  }
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => resolveScannedPath(root, line))
}

async function runDiscoveryCommandLinesAsync(command, args, root) {
  const result = await runBufferedCommand(command, args, {
    cwd: root,
    maxBuffer: FAST_DISCOVERY_MAX_BUFFER,
    timeoutMs: FAST_DISCOVERY_TIMEOUT_MS,
  })
  if (result.error || ![0, 1, 2].includes(result.status)) {
    return null
  }
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => resolveScannedPath(root, line))
}

function resolveScannedPath(root, path) {
  return isAbsolute(path) ? resolve(path) : resolve(root, path)
}

function fdExcludeArgs() {
  return [...SKIP_DIR_NAMES].flatMap((name) => ['--exclude', name])
}

function fdDiscoveryFilePattern({ includeGenericMarkdown = false } = {}) {
  const filePatterns = [
    '\\.wiki-compiler\\.json',
    'hot\\.md',
    'dendron\\.yml',
    'config\\.edn',
    'graph\\.json',
    'quartz\\.config\\.(ts|js|ya?ml)',
  ]
  const genericHubFiles = HUB_FILES.filter((name) => name !== 'hot.md')
  for (const name of LLMWIKI_TYPED_DIRS) {
    filePatterns.push(`${escapeRegex(name)}[\\\\/].*\\.(md|org)`)
  }
  if (includeGenericMarkdown) {
    for (const name of genericHubFiles) {
      filePatterns.push(escapeRegex(name))
    }
    filePatterns.push('extensions\\.json')
    filePatterns.push('.*\\.(md|org)')
  }
  return `(?i)(^|[\\\\/])(${[
    ...filePatterns,
  ].join('|')})$`
}

function fdDiscoveryDirectoryPattern({ includeGenericMarkdown = false } = {}) {
  const directories = [
    '\\.obsidian',
    '\\.foam',
    'logseq',
  ]
  if (includeGenericMarkdown) {
    directories.push(
      '\\.vscode',
      'pages',
      'journals',
      ...[...SOURCE_LIKE_DIR_NAMES].map(escapeRegex),
    )
  }
  return `(?i)(^|[\\\\/])(${[
    ...directories,
  ].join('|')})$`
}

function ripgrepGlobArgs({ includeGenericMarkdown = false } = {}) {
  const patterns = new Set()
  const includeGlobs = includeGenericMarkdown
    ? [...FAST_DISCOVERY_MARKER_GLOBS, ...FAST_DISCOVERY_GENERIC_GLOBS]
    : FAST_DISCOVERY_MARKER_GLOBS
  for (const glob of includeGlobs) {
    patterns.add(glob)
    if (!glob.startsWith('**/')) {
      patterns.add(`**/${glob}`)
    }
  }
  for (const glob of FAST_DISCOVERY_EXCLUDE_GLOBS) {
    patterns.add(glob)
    if (glob.startsWith('!') && !glob.startsWith('!**/')) {
      patterns.add(`!**/${glob.slice(1)}`)
    }
  }
  for (const name of SKIP_DIR_NAMES) {
    patterns.add(`!**/${name}/**`)
  }
  return [...patterns].flatMap((glob) => ['--glob', glob])
}

function escapeRegex(value) {
  return String(value).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}

function isPathAtOrBelowRoot(path, root) {
  const rel = relative(root, path)
  return !rel || (!rel.startsWith('..') && !isAbsolute(rel))
}

function directoryDepthFromRoot(path, root) {
  const rel = relative(root, path)
  if (!rel) {
    return 0
  }
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return Number.POSITIVE_INFINITY
  }
  return rel.split(/[\\/]+/).filter(Boolean).length
}

function hasSkippedPathSegment(path, root) {
  const rel = relative(root, path)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    return false
  }
  return rel
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((part) => {
      const lower = part.toLowerCase()
      return isSkippedDirectoryName(lower)
    })
}

function addOrUpdateCandidate(map, candidate) {
  const key = normalizePath(candidate.path)
  const existing = map.get(key)
  if (!existing || candidate.score > existing.score) {
    map.set(key, candidate)
  }
}

function isAppRootSignal(candidate) {
  return candidate.signals.some((signal) => (
    signal.startsWith('obsidian')
    || signal.startsWith('logseq')
    || signal.startsWith('dendron')
    || signal.startsWith('foam')
    || signal.startsWith('quartz')
  ))
}

function* walkDirectories(root, maxDepth) {
  const stack = [{ path: root, depth: 0 }]
  while (stack.length) {
    const current = stack.pop()
    if (!current || current.depth > maxDepth || shouldSkipDir(current.path, current.depth === 0)) {
      continue
    }
    yield current.path
    let entries = []
    try {
      entries = readdirSync(current.path, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries.reverse()) {
      if (!entry.isDirectory()) {
        continue
      }
      const child = join(current.path, entry.name)
      if (!shouldSkipDir(child)) {
        stack.push({ path: child, depth: current.depth + 1 })
      }
    }
  }
}

function shouldSkipDir(path, isRoot = false) {
  if (isRoot) {
    return false
  }
  const lower = basename(path).toLowerCase()
  if (isLlmwikiWorkInternalPath(path)) {
    return true
  }
  if (isSkippedDirectoryName(lower)) {
    return true
  }
  return false
}

function isSkippedDirectoryName(lower) {
  return SKIP_DIR_NAMES.has(lower) || lower.startsWith('.cursor-tutor') || lower.startsWith('_archive') || lower.endsWith('.egg-info')
}

function isLlmwikiWorkInternalPath(path) {
  const parts = normalizePath(path).toLowerCase().split(sep)
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (parts[index] === '.llmwiki-work' && LLMWIKI_WORK_INTERNAL_DIRS.has(parts[index + 1])) {
      return true
    }
  }
  return false
}

export function scoreCandidate(path) {
  const signals = []
  let score = 0
  const names = immediateNames(path)
  const lowerNames = new Set([...names].map((name) => name.toLowerCase()))
  const lowerPath = normalizePath(path).toLowerCase()

  if (lowerPath.includes(`${sep}skills${sep}wiki`)) {
    score -= 30
    signals.push('penalty:skills-wiki')
  }
  if (lowerPath.includes(`${sep}node_modules${sep}`) || lowerPath.includes(`${sep}.tmp${sep}`)) {
    score -= 20
    signals.push('penalty:generated-or-dependency')
  }

  if (lowerNames.has('.wiki-compiler.json')) {
    score += 50
    signals.push('llmwiki-marker:.wiki-compiler.json')
  }
  const hubCount = HUB_FILES.filter((name) => lowerNames.has(name)).length
  if (lowerNames.has('hot.md') && (lowerNames.has('index.md') || lowerNames.has('overview.md'))) {
    score += 35
    signals.push('llmwiki-root:hot+index-or-overview')
  } else if (hubCount >= 2) {
    score += 25
    signals.push('hub-files:2+')
  } else if (hubCount === 1) {
    score += 10
    signals.push('hub-file')
  }
  if (LLMWIKI_TYPED_DIRS.some((name) => safeHasMarkdown(join(path, name), 30, 2))) {
    score += 25
    signals.push('llmwiki-typed-dir')
  }
  if (safeIsFile(join(path, 'graph', 'graph.json'))) {
    score += 20
    signals.push('sidecar-graph:graph/graph.json')
  }
  if (safeIsDirectory(join(path, '.obsidian')) && safeHasMarkdown(path, 10, 2)) {
    score += 30
    signals.push('obsidian:.obsidian')
  }
  if (safeIsFile(join(path, 'logseq', 'config.edn'))) {
    score += 30
    signals.push('logseq:config')
  } else if (safeIsDirectory(join(path, 'pages')) && safeIsDirectory(join(path, 'journals'))) {
    score += 25
    signals.push('logseq:pages+journals')
  }
  if (safeIsFile(join(path, 'dendron.yml'))) {
    score += 30
    signals.push('dendron:dendron.yml')
  }
  if (safeIsDirectory(join(path, '.foam'))) {
    score += 30
    signals.push('foam:.foam')
  } else if (hasFoamVscodeHint(path)) {
    score += 25
    signals.push('foam:vscode-extension')
  }
  if (QUARTZ_CONFIGS.some((name) => safeIsFile(join(path, name)))) {
    score += 30
    signals.push('quartz:config')
  }
  const base = basename(path).toLowerCase()
  if (['wiki', 'llmwiki', 'openwiki', 'vault'].includes(base)) {
    score += 10
    signals.push(`name:${base}`)
  }
  if (base === '.llmwiki-work') {
    score -= 30
    signals.push('penalty:generated-container')
  }

  const markdownCount = countMarkdownFiles(path, 1001, 4)
  if (markdownCount >= 5) {
    score += 10
    signals.push('markdown:5+')
  }
  if (markdownCount >= 50) {
    score += 10
    signals.push('markdown:50+')
  }
  const frontmatterSignals = sampleFrontmatterSignals(path)
  if (frontmatterSignals.sourceRefs) {
    score += 15
    signals.push('frontmatter:source_refs')
  }
  if (frontmatterSignals.reviewState) {
    score += 10
    signals.push('frontmatter:review_state')
  }
  if (frontmatterSignals.wikiTitle) {
    score += 10
    signals.push('frontmatter:wiki_title')
  }

  const variant = classifyVariantFromSignals(signals)
  const normalizedScore = variant === VARIANT_GENERIC_MARKDOWN
    ? Math.min(score, GENERIC_MARKDOWN_SCORE_CAP)
    : score

  return {
    path: resolve(path),
    score: Math.max(normalizedScore, 0),
    confidence: confidenceForScore(normalizedScore),
    variant,
    variantLabel: VARIANT_LABELS[variant],
    markdownCount,
    signals,
  }
}

function confidenceForScore(score) {
  if (score >= 60) return 'high'
  if (score >= 30) return 'medium'
  if (score >= 10) return 'low'
  return 'none'
}

function immediateNames(path) {
  try {
    return new Set(readdirSync(path, { withFileTypes: true }).map((entry) => entry.name))
  } catch {
    return new Set()
  }
}

function countMarkdownFiles(root, limit = 1001, maxDepth = 4) {
  if (!safeIsDirectory(root)) {
    return 0
  }
  let count = 0
  const stack = [{ path: root, depth: 0 }]
  while (stack.length && count < limit) {
    const current = stack.pop()
    if (!current || current.depth > maxDepth || shouldSkipDir(current.path, current.depth === 0)) {
      continue
    }
    let entries = []
    try {
      entries = readdirSync(current.path, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.toLowerCase().endsWith('.md') || entry.name.toLowerCase().endsWith('.org'))) {
        count += 1
        if (count >= limit) break
      } else if (entry.isDirectory() && !shouldSkipDir(join(current.path, entry.name))) {
        stack.push({ path: join(current.path, entry.name), depth: current.depth + 1 })
      }
    }
  }
  return count
}

function safeHasMarkdown(root, limit = 1, maxDepth = 2) {
  return countMarkdownFiles(root, limit, maxDepth) > 0
}

function sampleFrontmatterSignals(root) {
  const result = { sourceRefs: false, reviewState: false, wikiTitle: false }
  const files = collectMarkdownSamples(root, 8, 3)
  for (const file of files) {
    let raw = ''
    try {
      raw = readFileSync(file, 'utf8').slice(0, 2048)
    } catch {
      continue
    }
    result.sourceRefs ||= /(^|\n)\s*(source_refs|sources)\s*:/i.test(raw)
    result.reviewState ||= /(^|\n)\s*review_state\s*:/i.test(raw)
    result.wikiTitle ||= /(^|\n)\s*wiki_title\s*:/i.test(raw)
  }
  return result
}

function collectMarkdownSamples(root, limit, maxDepth) {
  const samples = []
  const stack = [{ path: root, depth: 0 }]
  while (stack.length && samples.length < limit) {
    const current = stack.pop()
    if (!current || current.depth > maxDepth || shouldSkipDir(current.path, current.depth === 0)) {
      continue
    }
    let entries = []
    try {
      entries = readdirSync(current.path, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const child = join(current.path, entry.name)
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        samples.push(child)
        if (samples.length >= limit) break
      } else if (entry.isDirectory() && !shouldSkipDir(child)) {
        stack.push({ path: child, depth: current.depth + 1 })
      }
    }
  }
  return samples
}

function hasFoamVscodeHint(root) {
  const file = join(root, '.vscode', 'extensions.json')
  if (!safeIsFile(file)) {
    return false
  }
  try {
    return readFileSync(file, 'utf8').toLowerCase().includes('foam')
  } catch {
    return false
  }
}

async function validateCandidate(candidate, serveInvocation) {
  try {
    const manifest = await llmwikiServeJson(serveInvocation, ['manifest', candidate.path], { timeoutMs: 20000 })
    return {
      ...candidate,
      startable: true,
      manifest: summarizeManifest(manifest),
    }
  } catch (error) {
    return {
      ...candidate,
      startable: false,
      validationError: error.message,
    }
  }
}

function summarizeManifest(manifest) {
  return {
    title: manifest.title,
    source_id: manifest.source_id,
    bundle_id: manifest.bundle_id,
    adapter: manifest.adapter,
    implementation: manifest.implementation,
    page_count: manifest.page_count,
    approved_page_count: manifest.approved_page_count,
    graph_node_count: manifest.projection?.graph_node_count,
    graph_edge_count: manifest.projection?.graph_edge_count,
    hot_page: manifest.hot_page,
    index_page: manifest.index_page,
    overview_page: manifest.overview_page,
  }
}

export async function doctor({ bridgeUrl = DEFAULT_BRIDGE_URL, serveInvocation = resolveServeInvocation({}) } = {}) {
  const checks = []
  checks.push({ name: 'node', ok: true, detail: process.version })
  checks.push({ name: 'llmwiki-serve invocation', ok: true, detail: `${serveInvocation.command} ${serveInvocation.baseArgs.join(' ')}`.trim(), cwd: serveInvocation.cwd })
  try {
    const health = await fetchJson(new URL('/health', bridgeUrl), { timeoutMs: 5000 })
    checks.push({ name: 'bridge health', ok: true, detail: health.status || 'reachable', url: bridgeUrl })
  } catch (error) {
    checks.push({ name: 'bridge health', ok: false, detail: error.message, url: bridgeUrl })
  }
  return { checks }
}

export async function startSources({ paths, host = DEFAULT_HOST, portStart = DEFAULT_PORT_START, ports = [], serveInvocation = resolveServeInvocation({}), configPath = defaultConfigPath(), logDir = defaultLogDir(), healthTimeoutMs = DEFAULT_SOURCE_HEALTH_TIMEOUT_MS, healthIntervalMs = DEFAULT_SOURCE_HEALTH_INTERVAL_MS } = {}) {
  if (!paths?.length) {
    throw new Error('start requires at least one --path')
  }
  mkdirSync(logDir, { recursive: true })
  const sources = []
  const startedProcesses = []
  const assignedPorts = new Set()
  try {
    for (let index = 0; index < paths.length; index += 1) {
      const path = resolve(paths[index])
      if (!safeIsDirectory(path)) {
        throw new Error(`Source path is not a directory: ${path}`)
      }
      const requestedPort = ports[index] || portStart + index
      const port = await nextAvailablePort(requestedPort, { host, unavailable: assignedPorts })
      assignedPorts.add(port)
      const manifest = await llmwikiServeJson(serveInvocation, ['manifest', path], { timeoutMs: 30000 })
      const sourceId = manifest.source_id || slug(manifest.title || basename(path))
      const out = join(logDir, `${sourceId}-${port}.out.log`)
      const err = join(logDir, `${sourceId}-${port}.err.log`)
      const outFd = openSync(out, 'a')
      const errFd = openSync(err, 'a')
      let child
      try {
        child = nodeSpawn(
          serveInvocation.command,
          [...serveInvocation.baseArgs, 'serve', path, '--host', host, '--port', String(port)],
          {
            cwd: serveInvocation.cwd,
            detached: true,
            stdio: ['ignore', outFd, errFd],
            windowsHide: true,
          },
        )
      } finally {
        closeFileDescriptor(outFd)
        closeFileDescriptor(errFd)
      }
      child.unref()
      const startedProcess = { child, serverProcessId: null }
      startedProcesses.push(startedProcess)
      const serveUrl = `http://${host}:${port}`
      const logs = { stdout: out, stderr: err }
      const health = await waitForSourceHealth(serveUrl, {
        child,
        logs,
        timeoutMs: healthTimeoutMs,
        intervalMs: healthIntervalMs,
      })
      const serverProcessId = detectListeningProcessId(host, port)
      startedProcess.serverProcessId = serverProcessId
      const processId = serverProcessId || child.pid
      sources.push({
        id: sourceId,
        name: manifest.title || sourceId,
        title: manifest.title || sourceId,
        protocol: 'llmwiki-http',
        status: 'ready',
        selected: index === 0,
        url: serveUrl,
        path,
        requestedPort,
        port,
        ...(port !== requestedPort ? { portFallback: { requestedPort, assignedPort: port, reason: 'requested-port-occupied' } } : {}),
        processId,
        runnerProcessId: serverProcessId && serverProcessId !== child.pid ? child.pid : undefined,
        manifest: summarizeManifest(manifest),
        health,
        logs,
      })
    }
  } catch (error) {
    cleanupStartedProcesses(startedProcesses)
    throw error
  }
  writeSourceConfig(configPath, sources)
  return { configPath, sources }
}

async function waitForSourceHealth(sourceUrl, { child, logs, timeoutMs = DEFAULT_SOURCE_HEALTH_TIMEOUT_MS, intervalMs = DEFAULT_SOURCE_HEALTH_INTERVAL_MS } = {}) {
  const deadline = Date.now() + timeoutMs
  const childFailure = observeChildFailure(child)
  let lastError = null
  while (Date.now() <= deadline) {
    const failure = childFailure()
    if (failure) {
      throw new Error(formatSourceHealthFailure(sourceUrl, failure.message, logs))
    }
    try {
      const remainingMs = Math.max(1, deadline - Date.now())
      const health = await fetchJson(new URL('/health', sourceUrl), { timeoutMs: Math.min(1000, remainingMs) })
      const failureAfterHealth = childFailure()
      if (failureAfterHealth) {
        throw new Error(formatSourceHealthFailure(sourceUrl, failureAfterHealth.message, logs))
      }
      return { ok: true, status: health.status || 'reachable', url: sourceUrl }
    } catch (error) {
      lastError = error
    }
    const failureAfterFetch = childFailure()
    if (failureAfterFetch) {
      throw new Error(formatSourceHealthFailure(sourceUrl, failureAfterFetch.message, logs))
    }
    const sleepMs = Math.min(intervalMs, Math.max(0, deadline - Date.now()))
    if (sleepMs <= 0) {
      break
    }
    await delay(sleepMs)
  }
  const detail = lastError?.message ? ` Last error: ${lastError.message}` : ''
  throw new Error(formatSourceHealthFailure(sourceUrl, `Timed out waiting for /health after ${timeoutMs}ms.${detail}`, logs))
}

function observeChildFailure(child) {
  let failure = null
  child.once('error', (error) => {
    failure = error
  })
  child.once('exit', (code, signal) => {
    if (!failure) {
      failure = new Error(`llmwiki-serve exited before becoming healthy (code ${code ?? 'n/a'}, signal ${signal ?? 'n/a'})`)
    }
  })
  return () => failure
}

function formatSourceHealthFailure(sourceUrl, detail, logs = {}) {
  const logText = logs.stdout || logs.stderr
    ? ` Logs: ${logs.stdout || 'stdout n/a'}, ${logs.stderr || 'stderr n/a'}`
    : ''
  return `Source server did not become healthy at ${sourceUrl}. ${detail}${logText}`
}

function detectListeningProcessId(host, port) {
  const numericPort = Number(port)
  if (!Number.isInteger(numericPort)) {
    return null
  }
  if (process.platform === 'win32') {
    return detectWindowsListeningProcessId(host, numericPort)
  }
  return detectUnixListeningProcessId(numericPort)
}

function detectWindowsListeningProcessId(host, port) {
  const child = spawnSync('netstat', ['-ano', '-p', 'TCP'], {
    encoding: 'utf8',
    timeout: 3000,
    windowsHide: true,
  })
  if (child.error || (!child.stdout && child.status !== 0)) {
    return null
  }
  for (const line of String(child.stdout || '').split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 5) {
      continue
    }
    const [protocol, localAddress, , state, pidText] = parts
    if (!/^tcp$/i.test(protocol) || state.toUpperCase() !== 'LISTENING') {
      continue
    }
    const pid = Number.parseInt(pidText, 10)
    if (Number.isInteger(pid) && endpointMatchesHostPort(localAddress, host, port)) {
      return pid
    }
  }
  return null
}

function detectUnixListeningProcessId(port) {
  const lsof = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
    encoding: 'utf8',
    timeout: 3000,
  })
  const lsofPid = firstIntegerLine(lsof.stdout)
  if (lsofPid) {
    return lsofPid
  }

  const ss = spawnSync('ss', ['-ltnp'], {
    encoding: 'utf8',
    timeout: 3000,
  })
  const ssPid = firstListeningPidFromProcessTable(ss.stdout, port)
  if (ssPid) {
    return ssPid
  }

  const netstat = spawnSync('netstat', ['-ltnp'], {
    encoding: 'utf8',
    timeout: 3000,
  })
  return firstListeningPidFromProcessTable(netstat.stdout, port)
}

function firstIntegerLine(value) {
  for (const line of String(value || '').split(/\r?\n/)) {
    const pid = Number.parseInt(line.trim(), 10)
    if (Number.isInteger(pid) && pid > 0) {
      return pid
    }
  }
  return null
}

function firstListeningPidFromProcessTable(value, port) {
  const portPattern = new RegExp(`[:.]${port}\\b`)
  for (const line of String(value || '').split(/\r?\n/)) {
    if (!portPattern.test(line)) {
      continue
    }
    const match = line.match(/pid=(\d+)/) || line.match(/\s(\d+)\/\S+\s*$/)
    if (match) {
      const pid = Number.parseInt(match[1], 10)
      if (Number.isInteger(pid) && pid > 0) {
        return pid
      }
    }
  }
  return null
}

function endpointMatchesHostPort(endpoint, host, port) {
  const parsed = parseEndpoint(endpoint)
  if (!parsed || parsed.port !== port) {
    return false
  }
  const expectedHost = normalizeEndpointHost(host)
  if (!expectedHost || expectedHost === '0.0.0.0' || expectedHost === '::') {
    return true
  }
  const actualHost = normalizeEndpointHost(parsed.host)
  if (actualHost === expectedHost) {
    return true
  }
  if (expectedHost === 'localhost') {
    return actualHost === '127.0.0.1' || actualHost === '::1'
  }
  return false
}

function parseEndpoint(endpoint) {
  const text = String(endpoint || '').trim()
  const bracketed = text.match(/^\[?([^\]]+)\]?:(\d+)$/)
  if (!bracketed) {
    return null
  }
  return {
    host: bracketed[1],
    port: Number.parseInt(bracketed[2], 10),
  }
}

function normalizeEndpointHost(host) {
  return String(host || '').trim().replace(/^\[(.*)]$/, '$1').toLowerCase()
}

function cleanupStartedProcesses(startedProcesses) {
  for (const startedProcess of startedProcesses) {
    stopStartedProcess(startedProcess?.child || startedProcess)
    if (startedProcess?.serverProcessId && startedProcess.serverProcessId !== startedProcess.child?.pid) {
      stopProcessId(startedProcess.serverProcessId)
    }
  }
}

function stopStartedProcess(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode) {
    return
  }
  try {
    if (process.platform !== 'win32') {
      process.kill(-child.pid, 'SIGTERM')
      return
    }
  } catch {
    // Fall through to killing the child process itself.
  }
  try {
    child.kill('SIGTERM')
  } catch {
    // Best-effort cleanup only.
  }
}

function stopProcessId(pid) {
  if (!pid || pid === process.pid) {
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // Best-effort cleanup only.
  }
}

function closeFileDescriptor(fd) {
  try {
    closeSync(fd)
  } catch {
    // Nothing useful to do if the fd was already closed.
  }
}

async function nextAvailablePort(start, { host = DEFAULT_HOST, unavailable = new Set(), maxAttempts = SOURCE_PORT_PROBE_MAX_ATTEMPTS } = {}) {
  const firstPort = Number(start)
  if (!Number.isInteger(firstPort) || firstPort < 1 || firstPort > 65535) {
    throw new Error(`Invalid source port: ${start}`)
  }

  let attempts = 0
  for (let port = firstPort; port <= 65535 && attempts < maxAttempts; port += 1) {
    attempts += 1
    if (unavailable.has(port)) {
      continue
    }
    if (await hostPortIsAvailable(host, port)) {
      return port
    }
  }
  throw new Error(`No available source port found for ${host} starting at ${firstPort}`)
}

function hostPortIsAvailable(host, port) {
  return new Promise((resolveProbe, rejectProbe) => {
    const probe = createNetServer()
    let settled = false

    function finish(error, available) {
      if (settled) {
        return
      }
      settled = true
      probe.removeAllListeners('error')
      probe.removeAllListeners('listening')
      if (error) {
        rejectProbe(error)
        return
      }
      resolveProbe(available)
    }

    probe.unref()
    probe.once('error', (error) => {
      if (error?.code === 'EADDRINUSE' || error?.code === 'EACCES') {
        finish(null, false)
        return
      }
      finish(error)
    })
    probe.once('listening', () => {
      probe.close((error) => {
        finish(error, true)
      })
    })

    try {
      probe.listen({ host, port, exclusive: true })
    } catch (error) {
      finish(error)
    }
  })
}

export async function registerSources({ bridgeUrl = DEFAULT_BRIDGE_URL, configPath = defaultConfigPath(), sourceUrls = [], selectedIds = new Set(), selectFirst = false, replace = false } = {}) {
  const sources = sourceUrls.length
    ? sourceUrls.map((url, index) => ({
      id: slug(new URL(url).host || `source-${index + 1}`),
      name: `LLMWiki Source ${index + 1}`,
      protocol: 'llmwiki-http',
      status: 'ready',
      selected: selectFirst ? index === 0 : false,
      url,
    }))
    : readSourceConfig(configPath)

  const normalized = sources.map((source, index) => normalizeBridgeSource(source, {
    selected: selectedIds.size ? selectedIds.has(source.id) : (source.selected ?? (selectFirst && index === 0)),
  }))

  const existing = replace ? [] : await readExistingBridgeSources(bridgeUrl)
  const merged = applySelectedIds(mergeBridgeSources(existing, normalized), selectedIds)

  const payload = { sources: merged }
  const response = await fetchJson(new URL('/settings/sources.json', bridgeUrl), {
    method: 'PUT',
    body: JSON.stringify(payload),
    headers: { 'content-type': 'application/json' },
    timeoutMs: 10000,
  })
  return { bridgeUrl, replace, payload, response }
}

function applySelectedIds(sources, selectedIds = new Set()) {
  if (!selectedIds?.size) {
    return sources
  }
  const normalizedIds = new Set([...selectedIds].map(String))
  return sources.map((source) => ({
    ...source,
    selected: normalizedIds.has(source.id),
  }))
}

function normalizeBridgeSource(source, { selected = false } = {}) {
  const url = assertSafeSourceUrl(source.url)
  const id = source.id || slug(new URL(url).host)
  return {
    id,
    name: source.name || source.title || id,
    title: source.title || source.name || id,
    protocol: source.protocol || 'llmwiki-http',
    status: source.status || 'ready',
    url,
    selected,
  }
}

async function readExistingBridgeSources(bridgeUrl) {
  try {
    const settings = await fetchJson(new URL('/settings/sources.json', bridgeUrl), { timeoutMs: 10000 })
    return Array.isArray(settings.sources)
      ? settings.sources.map((source) => normalizeBridgeSource(source, { selected: Boolean(source.selected) }))
      : []
  } catch (error) {
    if (String(error.message || '').startsWith('404 ')) {
      return []
    }
    throw error
  }
}

export function mergeBridgeSources(existing, incoming) {
  const merged = []
  for (const source of existing) {
    const normalized = normalizeBridgeSource(source, { selected: Boolean(source.selected) })
    merged.push(normalized)
  }
  for (const source of incoming) {
    const normalized = normalizeBridgeSource(source, { selected: Boolean(source.selected) })
    const index = merged.findIndex((candidate) => sameBridgeSource(candidate, normalized))
    if (index >= 0) {
      merged[index] = { ...merged[index], ...normalized }
    } else {
      merged.push(normalized)
    }
  }
  return merged
}

function sameBridgeSource(left, right) {
  return Boolean(left.id && right.id && left.id === right.id)
    || Boolean(left.url && right.url && left.url.replace(/\/+$/, '') === right.url.replace(/\/+$/, ''))
}

function assertSafeSourceUrl(value) {
  const parsed = new URL(value)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported source URL protocol: ${parsed.protocol}`)
  }
  if (parsed.username || parsed.password) {
    throw new Error('Source URL must not contain credentials.')
  }
  return parsed.toString().replace(/\/+$/, '')
}

export function bridgeStartPlan(options = {}) {
  const customCommand = stringOption(options.bridgeCommand ?? options['bridge-command'], '')
  if (customCommand) {
    return {
      command: customCommand,
      args: arrayOption(options.bridgeArg ?? options['bridge-arg']),
      source: 'custom',
    }
  }

  const siblingBridge = resolve(process.cwd(), '..', 'llmwiki-agent-bridge', 'bin', 'llmwiki-agent-bridge.mjs')
  if (safeIsFile(siblingBridge)) {
    return {
      command: process.execPath,
      args: [siblingBridge],
      source: 'sibling-checkout',
    }
  }

  const packageName = stringOption(options.bridgePackage ?? options['bridge-package'], DEFAULT_BRIDGE_PACKAGE_SPEC)
  return {
    command: 'npx',
    args: ['--yes', packageName],
    packageName,
    source: 'npx-package',
  }
}

export function startBridgeCommand(plan = bridgeStartPlan({}), { bridgeUrl = DEFAULT_BRIDGE_URL, logDir = defaultLogDir(), runtime = detectLlmRuntime({}), spawnProcess = crossSpawn } = {}) {
  mkdirSync(logDir, { recursive: true })
  const parsed = new URL(bridgeUrl)
  const bridgeId = slug(`llmwiki-agent-bridge-${parsed.hostname}-${parsed.port || '80'}`)
  const out = join(logDir, `${bridgeId}.out.log`)
  const err = join(logDir, `${bridgeId}.err.log`)
  const outFd = openSync(out, 'a')
  const errFd = openSync(err, 'a')
  const env = bridgeStartEnv(parsed, runtime)
  let child
  try {
    child = spawnProcess(plan.command, plan.args || [], {
      cwd: plan.cwd || process.cwd(),
      detached: true,
      env,
      stdio: ['ignore', outFd, errFd],
      windowsHide: true,
    })
  } finally {
    closeFileDescriptor(outFd)
    closeFileDescriptor(errFd)
  }
  child.unref()
  return {
    command: plan.command,
    args: plan.args || [],
    processId: child.pid,
    logs: { stdout: out, stderr: err },
  }
}

function bridgeStartEnv(parsedBridgeUrl, runtime = detectLlmRuntime({}), baseEnv = process.env) {
  const env = { ...baseEnv }
  if (!runtime.configured || runtime.disabled) {
    scrubBridgeRuntimeEnv(env)
  }
  return {
    ...env,
    ...bridgeStartEnvOverrides(parsedBridgeUrl, runtime),
  }
}

function bridgeStartEnvOverrides(parsedBridgeUrl, runtime = detectLlmRuntime({})) {
  return {
    LLMWIKI_AGENT_BRIDGE_HOST: parsedBridgeUrl.hostname,
    LLMWIKI_AGENT_BRIDGE_PORT: parsedBridgeUrl.port || (parsedBridgeUrl.protocol === 'https:' ? '443' : '80'),
    ...(runtime.configured
      ? {
          LLMWIKI_AGENT_BRIDGE_BASE_URL: runtime.baseUrl,
          LLMWIKI_AGENT_BRIDGE_MODEL: runtime.model,
          LLMWIKI_AGENT_BRIDGE_RUNTIME_PROFILE: runtime.profile,
        }
      : {}),
  }
}

function scrubBridgeRuntimeEnv(env) {
  for (const key of BRIDGE_RUNTIME_ENV_KEYS_TO_SCRUB) {
    delete env[key]
  }
  return env
}

export async function checkBridgeHealth(bridgeUrl = DEFAULT_BRIDGE_URL) {
  try {
    const health = await fetchJson(new URL('/health', bridgeUrl), { timeoutMs: 3000 })
    return { ok: true, status: health.status || 'reachable', url: bridgeUrl }
  } catch (error) {
    return { ok: false, error: error.message, url: bridgeUrl }
  }
}

export async function inspectRuntimeFramework({ choice, profile, options = {}, env = process.env, probe = probeRuntimeEndpoint, commandRunner = runBufferedCommand } = {}) {
  const framework = runtimeFrameworkId(choice, profile)
  if (framework === RUNTIME_SETUP_HERMES) {
    return inspectHermesFramework({ choice: runtimeSetupChoiceById(RUNTIME_SETUP_HERMES), options, env, probe, commandRunner })
  }
  if (framework === RUNTIME_SETUP_DEEPAGENTS) {
    return inspectDeepAgentsFramework({ choice: runtimeSetupChoiceById(RUNTIME_SETUP_DEEPAGENTS), options, env, commandRunner })
  }
  return {
    framework,
    installed: false,
    supported: false,
    reason: 'no framework-specific install check registered',
  }
}

function runtimeFrameworkId(choice, profile) {
  const normalized = String(
    (typeof choice === 'string' ? choice : choice?.id || choice?.profile)
      || profile
      || '',
  ).trim().toLowerCase()
  return normalized === 'deep-agents' ? RUNTIME_SETUP_DEEPAGENTS : normalized
}

async function inspectHermesFramework({ choice, options = {}, env = process.env, probe = probeRuntimeEndpoint, commandRunner = runBufferedCommand } = {}) {
  const checks = await runFrameworkCheckPlan(commandRunner, 'hermes', [
    { name: 'version', args: ['--version'], output: 'version' },
    { name: 'status', args: ['status'] },
    { name: 'doctor', args: ['doctor'] },
  ])
  const installCheck = checks[0]
  const endpointDefault = await resolveRuntimeEndpointDefault({
    choice,
    options,
    env,
    probe,
  })
  const runtime = endpointDefault.value && endpointDefault.verified
    ? {
        ok: true,
        profile: choice.profile,
        baseUrl: endpointDefault.value,
        url: endpointDefault.health?.url,
        status: endpointDefault.health?.status || 'ok',
      }
    : {
        ok: false,
        profile: choice.profile,
        baseUrl: endpointDefault.rejected?.value || endpointDefault.probes?.[0]?.baseUrl || DEFAULT_BRIDGE_RUNTIME_BASE_URL,
        error: endpointDefault.health?.error || endpointDefault.probes?.[0]?.health?.error || 'not running',
      }
  return {
    framework: RUNTIME_SETUP_HERMES,
    supported: true,
    command: 'hermes',
    installed: frameworkCommandWasFound(installCheck),
    installCheck,
    checks,
    version: installCheck.version,
    runtime,
    endpointDefault,
    docs: {
      cli: 'https://hermes-agent.nousresearch.com/docs/reference/cli-commands',
      apiServer: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server',
    },
  }
}

async function inspectDeepAgentsFramework({ choice, options = {}, env = process.env, commandRunner = runBufferedCommand } = {}) {
  const checks = await runFrameworkCheckPlan(commandRunner, 'dcode', [
    { name: 'version', args: ['--version'], output: 'version' },
    { name: 'doctor', args: ['doctor'] },
    { name: 'config', args: ['config', 'show', '--json'], output: 'safe-json-config' },
  ])
  const installCheck = checks[0]
  const endpointDefault = runtimeEndpointDefaultInfo(choice, options, env)
  return {
    framework: RUNTIME_SETUP_DEEPAGENTS,
    supported: true,
    command: 'dcode',
    installed: frameworkCommandWasFound(installCheck),
    installCheck,
    checks,
    version: installCheck.version,
    runtime: {
      ok: false,
      skipped: true,
      reason: 'DeepAgents Code has supported CLI diagnostics, but no registered local OpenAI-compatible runtime endpoint discovery contract in quickstart.',
    },
    endpointDefault,
    docs: {
      overview: 'https://docs.langchain.com/oss/python/deepagents/code/overview',
      configuration: 'https://docs.langchain.com/oss/python/deepagents/code/configuration',
    },
  }
}

async function runFrameworkCheckPlan(commandRunner, command, checks = []) {
  const results = []
  for (const check of checks) {
    if (results.length > 0 && !frameworkCommandWasFound(results[0])) {
      results.push({
        name: check.name,
        command,
        args: check.args,
        displayCommand: `${command} ${check.args.join(' ')}`.trim(),
        ok: false,
        skipped: true,
        status: null,
        error: 'CLI not detected',
      })
      continue
    }
    results.push(await runFrameworkCheck(commandRunner, command, check.args, check))
  }
  return results
}

async function runFrameworkCheck(commandRunner, command, args = [], check = {}) {
  const displayCommand = `${command} ${args.join(' ')}`.trim()
  try {
    const result = await commandRunner(command, args, {
      timeoutMs: DEFAULT_RUNTIME_FRAMEWORK_DETECTION_TIMEOUT_MS,
      maxBuffer: RUNTIME_FRAMEWORK_COMMAND_MAX_BUFFER,
    })
    const rawOutput = `${result.stdout || ''}\n${result.stderr || ''}`
    const output = check.output === 'version' ? compactText(rawOutput, 160) : ''
    const safeConfig = check.output === 'safe-json-config'
      ? summarizeSafeFrameworkConfig(result.stdout)
      : undefined
    return {
      name: check.name || displayCommand,
      command,
      args,
      displayCommand,
      ok: !result.error && result.status === 0,
      status: result.status,
      error: result.error?.code || result.error?.message || '',
      output,
      version: parseFrameworkVersion(output),
      ...(safeConfig ? { safeConfig } : {}),
    }
  } catch (error) {
    return {
      name: check.name || displayCommand,
      command,
      args,
      displayCommand,
      ok: false,
      status: null,
      error: error.message,
      output: '',
      version: '',
    }
  }
}

function frameworkCommandWasFound(check = {}) {
  if (check.error === 'ENOENT') {
    return false
  }
  if (check.status !== null && check.status !== undefined) {
    return true
  }
  return Boolean(check.output || check.version)
}

function parseFrameworkVersion(output) {
  const text = String(output || '').trim()
  if (!text) {
    return ''
  }
  const versionMatch = text.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)
  if (versionMatch) {
    return versionMatch[0]
  }
  return compactText(text.split(/\r?\n/)[0], 80)
}

function summarizeSafeFrameworkConfig(output) {
  const text = String(output || '').trim()
  if (!text) {
    return { ok: false, reason: 'empty config output' }
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'config output was not JSON' }
  }
  const keys = []
  const secretPaths = []
  collectJsonKeyPaths(parsed, '', { keys, secretPaths })
  if (secretPaths.length) {
    return {
      ok: false,
      reason: 'secret-like keys present; values omitted',
      secretKeyCount: secretPaths.length,
    }
  }
  return {
    ok: true,
    keyCount: keys.length,
    keys: keys.slice(0, 12),
  }
}

function collectJsonKeyPaths(value, prefix, { keys, secretPaths }) {
  if (!value || typeof value !== 'object') {
    return
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      collectJsonKeyPaths(value[index], `${prefix}[${index}]`, { keys, secretPaths })
    }
    return
  }
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    keys.push(path)
    if (isSecretLikeConfigKey(key)) {
      secretPaths.push(path)
      continue
    }
    collectJsonKeyPaths(child, path, { keys, secretPaths })
  }
}

function isSecretLikeConfigKey(key) {
  return /(?:api[_-]?key|token|secret|password|credential|authorization|bearer)/i.test(String(key || ''))
}

export const detectRuntimeFramework = inspectRuntimeFramework

export async function probeRuntimeEndpoint({ baseUrl, profile = 'generic', timeoutMs = 2000, fetchJson: fetchRuntimeJson = fetchJson } = {}) {
  const normalizedBaseUrl = normalizeRuntimeBaseUrl(baseUrl)
  const runtimeProfile = parseRuntimeProfile(profile, 'generic')
  if (runtimeProfile !== RUNTIME_SETUP_HERMES) {
    return {
      ok: true,
      skipped: true,
      profile: runtimeProfile,
      baseUrl: normalizedBaseUrl,
      reason: 'no registered framework health probe',
    }
  }
  const healthUrls = hermesHealthUrls(normalizedBaseUrl)
  const errors = []
  for (const url of healthUrls) {
    try {
      const health = await fetchRuntimeJson(url, { timeoutMs })
      const status = String(health.status || '').toLowerCase()
      if (!status || status === 'ok' || status === 'healthy' || status === 'ready') {
        return {
          ok: true,
          profile: runtimeProfile,
          baseUrl: normalizedBaseUrl,
          url,
          status: health.status || 'ok',
        }
      }
      errors.push(`${url}: status=${health.status}`)
    } catch (error) {
      errors.push(`${url}: ${error.message}`)
    }
  }
  return {
    ok: false,
    profile: runtimeProfile,
    baseUrl: normalizedBaseUrl,
    urls: healthUrls,
    error: errors.join('; '),
  }
}

function hermesHealthUrls(baseUrl) {
  const parsed = new URL(baseUrl)
  const origin = `${parsed.protocol}//${parsed.host}`
  const basePath = parsed.pathname.replace(/\/+$/, '')
  const paths = ['/health']
  if (basePath && basePath !== '/') {
    paths.push(`${basePath}/health`)
  } else {
    paths.push('/v1/health')
  }
  return [...new Set(paths)].map((path) => new URL(path, origin).toString())
}

export async function waitForBridgeHealth(bridgeUrl = DEFAULT_BRIDGE_URL, { timeoutMs = 15000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs
  let health = await checkBridgeHealth(bridgeUrl)
  while (!health.ok && Date.now() < deadline) {
    await delay(intervalMs)
    health = await checkBridgeHealth(bridgeUrl)
  }
  if (!health.ok) {
    throw new Error(health.error || `Timed out waiting for ${bridgeUrl}`)
  }
  return health
}

export async function configureBridgeRuntime({ bridgeUrl = DEFAULT_BRIDGE_URL, runtime = detectLlmRuntime({}), timeoutMs = 5000 } = {}) {
  if (!runtime.configured) {
    return { ok: true, skipped: true, reason: 'no runtime endpoint configured' }
  }
  const response = await fetchJson(new URL('/settings/config.json', bridgeUrl), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      runtimeProfile: parseRuntimeProfile(runtime.profile, 'generic'),
      baseUrl: normalizeRuntimeBaseUrl(runtime.baseUrl),
      model: runtime.model,
    }),
    timeoutMs,
  })
  return {
    ok: true,
    skipped: false,
    response,
  }
}

export async function launchAgentBridge({ bridgeUrl = DEFAULT_BRIDGE_URL, packageName = DEFAULT_BRIDGE_PACKAGE_SPEC, logDir = defaultLogDir(), runtime = detectLlmRuntime({}), timeoutMs = 15000 } = {}) {
  const plan = bridgeStartPlan({ bridgePackage: packageName })
  const started = startBridgeCommand(plan, { bridgeUrl, logDir, runtime })
  let health
  try {
    health = await waitForBridgeHealth(bridgeUrl, { timeoutMs })
  } catch (error) {
    health = { ok: false, error: error.message, url: bridgeUrl }
  }
  return {
    packageName,
    ...started,
    health,
  }
}

export function detectLlmRuntime(options = {}, env = process.env) {
  if (isLlmRuntimeDisabled(options)) {
    return {
      configured: false,
      baseUrl: '',
      model: 'local-model',
      profile: 'generic',
      disabled: true,
    }
  }
  const baseUrl = normalizeRuntimeBaseUrl(stringOption(
    options.llmEndpoint
      ?? options['llm-endpoint']
      ?? options.runtimeBaseUrl
      ?? options['runtime-base-url']
      ?? env.LLMWIKI_AGENT_BRIDGE_BASE_URL,
    '',
  ))
  const model = stringOption(
    options.llmModel
      ?? options['llm-model']
      ?? options.model
      ?? env.LLMWIKI_AGENT_BRIDGE_MODEL,
    'local-model',
  )
  const profile = parseRuntimeProfile(stringOption(
    options.runtimeProfile
      ?? options['runtime-profile']
      ?? env.LLMWIKI_AGENT_BRIDGE_RUNTIME_PROFILE,
    'generic',
  ), 'generic')
  return {
    configured: Boolean(baseUrl),
    baseUrl,
    model,
    profile,
  }
}

function parseRuntimeProfile(value, fallback = 'generic') {
  const normalized = String(value || fallback || 'generic').trim().toLowerCase()
  const profile = normalized === 'deep-agents' ? 'deepagents' : normalized
  if (!RUNTIME_PROFILES.has(profile)) {
    throw new Error(`Runtime profile must be one of: ${[...RUNTIME_PROFILES].join(', ')}`)
  }
  return profile
}

function isLlmRuntimeDisabled(options = {}) {
  return options.noLlmRuntime === true
    || options['no-llm-runtime'] === true
    || options.llmRuntime === false
    || options.runtimeSetup === RUNTIME_SETUP_SKIP
    || options['runtime-setup'] === RUNTIME_SETUP_SKIP
}

function bridgeModeOption(value, fallback) {
  const mode = stringOption(value, fallback)
  if (!BRIDGE_ORCHESTRATION_MODES.has(mode)) {
    throw new Error(`Bridge mode must be one of: ${[...BRIDGE_ORCHESTRATION_MODES].join(', ')}`)
  }
  return mode
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

export async function selectBridgeSmokeMode({ options = {}, bridgeUrl = DEFAULT_BRIDGE_URL, env = process.env, inspectBridgeRuntime = inspectBridgeRuntimeConfiguration } = {}) {
  const requestedMode = stringOption(options.mode ?? options['orchestration-mode'], '')
  if (requestedMode) {
    return { mode: bridgeModeOption(requestedMode, BRIDGE_MODE_EVIDENCE_ONLY), reason: 'requested with --mode' }
  }

  if (isLlmRuntimeDisabled(options)) {
    return { mode: BRIDGE_MODE_EVIDENCE_ONLY, reason: 'runtime setup selected evidence-only' }
  }

  const runtimeInfo = detectLlmRuntime(options, env)
  if (runtimeInfo.configured) {
    return { mode: BRIDGE_MODE_DELEGATED_RUNTIME, reason: `explicit LLM endpoint configured (${runtimeInfo.baseUrl})` }
  }

  try {
    const inspected = await inspectBridgeRuntime(bridgeUrl)
    if (inspected.configured) {
      return { mode: BRIDGE_MODE_DELEGATED_RUNTIME, reason: inspected.reason }
    }
    return { mode: BRIDGE_MODE_EVIDENCE_ONLY, reason: inspected.reason }
  } catch {
    return { mode: BRIDGE_MODE_EVIDENCE_ONLY, reason: 'no explicit LLM endpoint detected' }
  }
}

async function inspectBridgeRuntimeConfiguration(bridgeUrl) {
  const settings = await fetchJson(new URL('/settings.json', bridgeUrl), { timeoutMs: 2000 })
  const connection = settings.runtimeConnection || {}
  const baseUrl = String(connection.baseUrl || '')
  const configuredBaseUrl = baseUrl
    && baseUrl !== 'none'
    && trimTrailingSlash(baseUrl) !== trimTrailingSlash(DEFAULT_BRIDGE_RUNTIME_BASE_URL)
  if (connection.modelConfigured && (configuredBaseUrl || connection.apiKeyConfigured)) {
    return { configured: true, reason: 'LLM endpoint configured in bridge settings' }
  }
  return { configured: false, reason: 'no explicit LLM endpoint detected in bridge settings' }
}

export async function smokeBridge({ bridgeUrl = DEFAULT_BRIDGE_URL, query, mode = BRIDGE_MODE_EVIDENCE_ONLY } = {}) {
  const smokeMode = bridgeModeOption(mode, BRIDGE_MODE_EVIDENCE_ONLY)
  const response = await fetchJson(new URL('/message:send', bridgeUrl), {
    method: 'POST',
    body: JSON.stringify({ data: { query, mode: smokeMode } }),
    headers: { 'content-type': 'application/json' },
    timeoutMs: 30000,
  })
  return {
    bridgeUrl,
    query,
    mode: smokeMode,
    status: response.status,
    text: response.status?.message?.parts?.find((part) => part.kind === 'text')?.text || '',
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms)
  })
}

function yieldToEventLoop() {
  return new Promise((resolveYield) => {
    setImmediate(resolveYield)
  })
}

function runBufferedCommand(command, args = [], { cwd = process.cwd(), timeoutMs = 0, maxBuffer = FAST_DISCOVERY_MAX_BUFFER } = {}) {
  return new Promise((resolveCommand) => {
    let child
    try {
      child = nodeSpawn(command, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      resolveCommand({ error, status: null, signal: null, stdout: '', stderr: '' })
      return
    }

    let stdout = ''
    let stderr = ''
    let outputBytes = 0
    let settled = false
    let timeoutError = null
    let bufferError = null
    let timer = null

    function settle(result) {
      if (settled) {
        return
      }
      settled = true
      if (timer) {
        clearTimeout(timer)
      }
      resolveCommand(result)
    }

    function appendOutput(kind, chunk) {
      const value = chunk.toString()
      if (kind === 'stdout') {
        stdout += value
      } else {
        stderr += value
      }
      outputBytes += Buffer.byteLength(value)
      if (!bufferError && outputBytes > maxBuffer) {
        bufferError = Object.assign(new Error(`Command output exceeded ${maxBuffer} bytes`), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })
        child.kill('SIGTERM')
      }
    }

    child.stdout?.on('data', (chunk) => appendOutput('stdout', chunk))
    child.stderr?.on('data', (chunk) => appendOutput('stderr', chunk))

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timeoutError = Object.assign(new Error(`Command timed out after ${timeoutMs}ms`), { code: 'ETIMEDOUT' })
        child.kill('SIGTERM')
      }, timeoutMs)
      if (typeof timer.unref === 'function') {
        timer.unref()
      }
    }

    child.on('error', (error) => {
      settle({ error, status: null, signal: null, stdout, stderr })
    })
    child.on('close', (status, signal) => {
      settle({ error: bufferError || timeoutError, status, signal, stdout, stderr })
    })
  })
}

function readSourceConfig(configPath) {
  if (!safeIsFile(configPath)) {
    throw new Error(`Source config not found: ${configPath}. Run start first or pass --source-url.`)
  }
  const data = JSON.parse(readFileSync(configPath, 'utf8'))
  if (!Array.isArray(data.sources)) {
    throw new Error(`Source config has no sources array: ${configPath}`)
  }
  return data.sources
}

function writeSourceConfig(configPath, sources) {
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, `${JSON.stringify({ version: 1, sources }, null, 2)}\n`, 'utf8')
}

export function resolveServeInvocation(options = {}) {
  if (options['serve-command']) {
    return {
      command: String(options['serve-command']),
      baseArgs: arrayOption(options['serve-arg']),
      cwd: options['serve-cwd'] ? resolve(String(options['serve-cwd'])) : process.cwd(),
    }
  }
  if (process.env.LLMWIKI_SERVE_COMMAND) {
    return {
      command: process.env.LLMWIKI_SERVE_COMMAND,
      baseArgs: splitCommandArgs(process.env.LLMWIKI_SERVE_ARGS || ''),
      cwd: process.env.LLMWIKI_SERVE_CWD || process.cwd(),
    }
  }
  const candidates = [
    resolve(process.cwd(), '..', 'llmwiki-serve'),
    resolve(process.cwd(), 'llmwiki-serve'),
    resolve(PACKAGE_ROOT, '..', 'llmwiki-serve'),
  ]
  for (const candidate of candidates) {
    if (safeIsFile(join(candidate, 'pyproject.toml'))) {
      const venvCommand = localServeExecutable(candidate)
      if (venvCommand) {
        return { command: venvCommand, baseArgs: [], cwd: candidate }
      }
      return { command: 'uv', baseArgs: ['run', 'llmwiki-serve'], cwd: candidate }
    }
  }
  return { command: 'llmwiki-serve', baseArgs: [], cwd: process.cwd() }
}

function localServeExecutable(root) {
  const executable = process.platform === 'win32'
    ? join(root, '.venv', 'Scripts', 'llmwiki-serve.exe')
    : join(root, '.venv', 'bin', 'llmwiki-serve')
  return safeIsFile(executable) ? executable : null
}

function splitCommandArgs(value) {
  return value ? value.split(/\s+/).filter(Boolean) : []
}

async function llmwikiServeJson(invocation, args, { timeoutMs }) {
  const child = await runBufferedCommand(invocation.command, [...invocation.baseArgs, ...args], {
    cwd: invocation.cwd,
    timeoutMs,
    maxBuffer: FAST_DISCOVERY_MAX_BUFFER,
  })
  if (child.error) {
    throw new Error(formatServeInvocationError(invocation, child.error))
  }
  if (child.status !== 0) {
    throw new Error((child.stderr || child.stdout || `llmwiki-serve exited ${child.status}`).trim())
  }
  try {
    return JSON.parse(child.stdout)
  } catch (error) {
    throw new Error(`Failed to parse llmwiki-serve JSON: ${error.message}`)
  }
}

function formatServeInvocationError(invocation, error) {
  const commandText = `${invocation.command} ${invocation.baseArgs.join(' ')}`.trim()
  if (error?.code === 'ENOENT') {
    return [
      `Could not run llmwiki-serve command: ${commandText}`,
      `cwd: ${invocation.cwd}`,
      'Install llmwiki-serve, run from a checkout with sibling llmwiki-serve, or pass --serve-command/--serve-cwd.',
      'For local source-only testing from this workspace, use: --serve-command uv --serve-arg run --serve-arg llmwiki-serve --serve-cwd <llmwiki-serve repo>',
    ].join('\n')
  }
  return `Could not run llmwiki-serve command: ${commandText}\n${error?.message || String(error)}`
}

async function fetchJson(url, { timeoutMs = 10000, ...init } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 300)}`)
    }
    return text ? JSON.parse(text) : {}
  } finally {
    clearTimeout(timer)
  }
}

function writeResult(result, options, io) {
  if (boolOption(options.json)) {
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (Array.isArray(result?.candidates)) {
    io.stdout.write(formatCandidates(result.candidates))
    return
  }
  io.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

function formatCandidates(candidates) {
  if (!candidates.length) {
    return 'No LLMWiki candidates found.\n'
  }
  return `${candidates.map((candidate) => {
    const manifest = candidate.manifest
    const title = manifest?.title || basename(candidate.path)
    const pageText = manifest ? `${manifest.approved_page_count}/${manifest.page_count} approved` : `${candidate.markdownCount} markdown files`
    const startable = candidate.startable === undefined ? '' : `\n    startable: ${candidate.startable ? 'yes' : 'no'}`
    const adapter = manifest?.adapter ? `\n    adapter: ${manifest.adapter}` : ''
    return `[${candidate.rank}] ${title}
    path: ${candidate.path}
    variant: ${candidateVariantLabel(candidate)}
    confidence: ${candidate.confidence} (${candidate.score})
    pages: ${pageText}
    signals: ${candidate.signals.join(', ')}${adapter}${startable}`
  }).join('\n\n')}\n\nNote: ${pathRedactionNoticeText()}\n`
}

function helpText() {
  return `llmwiki-bridge-start

Usage:
  llmwiki-bridge-start [--path DIR|--workspace|--cwd] [--include-additional] [--bridge URL] [--setup-bridge] [--runtime-setup skip|hermes|deepagents] [--llm-endpoint URL] [--llm-model MODEL] [--runtime-profile PROFILE] [--serve-command CMD] [--yes] [--no-clear-screen]
  llmwiki-bridge-start quickstart [--path DIR|--workspace|--cwd] [--include-additional] [--bridge URL] [--setup-bridge] [--runtime-setup skip|hermes|deepagents] [--llm-endpoint URL] [--llm-model MODEL] [--runtime-profile PROFILE] [--serve-command CMD] [--yes] [--no-clear-screen]
  llmwiki-bridge-start discover [--home|--workspace|--cwd|--path DIR] [--validate] [--min-score 30] [--serve-command CMD] [--json]
  llmwiki-bridge-start start --path DIR [--port 11001] [--serve-command CMD]
  llmwiki-bridge-start register [--bridge URL] [--config FILE] [--replace]
  llmwiki-bridge-start smoke [--bridge URL] [--query TEXT] [--mode evidence-only|delegated-runtime|hybrid]
  llmwiki-bridge-start doctor [--bridge URL]

Commands:
  quickstart  Guided first-run flow; also the default when no subcommand is provided.
  discover  Find likely LLMWiki Markdown, Native, Obsidian, Logseq, Dendron, Foam, or Quartz roots.
  start     Start llmwiki-serve for explicit source paths and write a source config.
  register  Upsert started or explicit sources in llmwiki-agent-bridge settings.
  smoke     Run a small bridge query; defaults to evidence-only.
  doctor    Check local tool and bridge readiness.

Quickstart shows recommended LLMWiki source folders first; use --include-additional for advanced/lower-priority app vaults, examples, demos, and starter/e2e sources.
Interactive TTY quickstart clears only the visible screen between screens; use --no-clear-screen or LLMWIKI_BRIDGE_START_NO_CLEAR_SCREEN=1 to keep all screens visible.
Discovery defaults to the current user's home directory and hides low-confidence generic folders.
Use --min-score 10 when intentionally looking for plain Markdown folders.
Register merges by default. Use --replace only when intentionally replacing the bridge registry.
Bridge setup is optional. Started source URLs can be used directly without llmwiki-agent-bridge.
After bridge setup approval, quickstart asks for runtime setup: skip/evidence-only, Hermes, or DeepAgents.
Bridge smoke defaults to evidence-only unless --mode or quickstart runtime setup/detection selects another mode.
Use --serve-command/--serve-arg/--serve-cwd when llmwiki-serve is not on PATH.
`
}

function arrayOption(value) {
  if (value === undefined || value === false) return []
  return Array.isArray(value) ? value.map(String) : [String(value)]
}

function stringOption(value, fallback) {
  if (Array.isArray(value)) return String(value.at(-1))
  if (value === undefined || value === true || value === false) return fallback
  return String(value)
}

function intOption(value, fallback) {
  const parsed = Number.parseInt(stringOption(value, ''), 10)
  return Number.isInteger(parsed) ? parsed : fallback
}

function positiveIntOption(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function boolOption(value) {
  return value === true || value === 'true' || value === '1' || value === ''
}

function defaultConfigPath() {
  return resolve(process.cwd(), '.llmwiki-bridge-start', 'sources.json')
}

function defaultLogDir() {
  return resolve(process.cwd(), '.llmwiki-bridge-start', 'logs')
}

function safeIsDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function safeIsFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function normalizePath(path) {
  return resolve(path).split(/[\\/]+/).join(sep)
}

function slug(value) {
  const text = String(value || 'source').trim().toLowerCase().replace(/[^a-z0-9가-힣._-]+/g, '-').replace(/^-+|-+$/g, '')
  return text || `source-${createHash('sha1').update(String(value)).digest('hex').slice(0, 8)}`
}

export const _internal = {
  confidenceForScore,
  countMarkdownFiles,
  discoverRootsFromOptions,
  sampleFrontmatterSignals,
  slug,
}
