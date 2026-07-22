import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8788'
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT_START = 11001
const DEFAULT_MAX_DEPTH = 9
const DEFAULT_DISCOVER_LIMIT = 30
const DEFAULT_MIN_SCORE = 30

const SKIP_DIR_NAMES = new Set([
  '.cache',
  '.git',
  '.hg',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.svn',
  '.venv',
  '__pycache__',
  'appdata',
  'build',
  'dist',
  'logs',
  'node_modules',
  'output',
  'program files',
  'program files (x86)',
  'smoke',
  'uploads',
  'venv',
  'variant-smoke',
  'variants',
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

export async function runCli(argv, io = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }) {
  const { command, options } = parseArgs(argv)
  if (options.help || command === 'help') {
    io.stdout.write(helpText())
    return
  }
  if (command === 'quickstart') {
    const json = boolOption(options.json)
    const result = await quickstart(options, json ? { ...io, stdout: io.stderr || io.stdout } : io)
    if (json) {
      writeResult(result, options, io)
    }
    return
  }
  if (!command || command === 'discover') {
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
    ...commands,
  }
  const output = io.stdout || process.stdout
  const prompter = createQuickstartPrompter(io, { yes: boolOption(options.yes ?? options.y) })
  const bridgeUrl = stringOption(options.bridge, DEFAULT_BRIDGE_URL)
  const configPath = stringOption(options.config, defaultConfigPath())
  const serveInvocation = runtime.resolveServeInvocation(options)
  const roots = discoverRootsFromOptions(options)
  const result = {
    command: 'quickstart',
    roots,
    selected: [],
    validated: [],
    started: null,
    registered: null,
    smoked: null,
    skipped: [],
  }

  try {
    output.write('llmwiki-bridge-start quickstart\n')
    output.write('1) Discovering candidates without validation. Validation starts only after you choose candidates.\n')
    const discovery = await runtime.discoverCandidates({
      roots,
      maxDepth: intOption(options.depth, DEFAULT_MAX_DEPTH),
      limit: intOption(options.limit, DEFAULT_DISCOVER_LIMIT),
      minScore: intOption(options.minScore ?? options['min-score'], DEFAULT_MIN_SCORE),
      validate: false,
      serveInvocation,
    })
    result.discovery = discovery

    if (!discovery.candidates.length) {
      output.write('No LLMWiki candidates found. Try --path DIR or --min-score 10 for generic Markdown folders.\n')
      result.skipped.push('selection', 'validation', 'start', 'register', 'smoke')
      return result
    }

    output.write('\nCandidates:\n')
    output.write(formatCandidates(discovery.candidates))

    const selectionAnswer = await prompter.ask('Select candidates to validate/start (comma-separated ranks, "all", or "q"; default 1): ', '1')
    const selected = parseCandidateSelection(selectionAnswer, discovery.candidates)
    result.selected = selected.map(summarizeCandidateForFlow)
    if (!selected.length) {
      output.write('Quickstart cancelled before validation.\n')
      result.skipped.push('validation', 'start', 'register', 'smoke')
      return result
    }

    output.write(`\n2) Validating ${selected.length} selected candidate(s) with llmwiki-serve manifest.\n`)
    const validated = await Promise.all(selected.map((candidate) => runtime.validateCandidate(candidate, serveInvocation)))
    result.validated = validated.map(summarizeCandidateForFlow)
    for (const candidate of validated) {
      const name = candidate.manifest?.title || basename(candidate.path)
      output.write(`- ${candidate.startable ? 'OK' : 'FAIL'} ${name} (${candidate.path})\n`)
      if (!candidate.startable && candidate.validationError) {
        output.write(`  ${candidate.validationError}\n`)
      }
    }
    const startable = validated.filter((candidate) => candidate.startable)
    if (!startable.length) {
      output.write('No selected candidates validated successfully; stopping before start/register/smoke.\n')
      result.skipped.push('start', 'register', 'smoke')
      return result
    }

    if (!await confirmQuickstart(prompter, `3) Start ${startable.length} validated source server(s) on loopback?`, true)) {
      output.write('Skipped start/register/smoke.\n')
      result.skipped.push('start', 'register', 'smoke')
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
    output.write(`Started ${result.started.sources.length} source server(s). Config: ${result.started.configPath}\n`)

    const registerMode = boolOption(options.replace) ? 'replace' : 'merge'
    if (!await confirmQuickstart(prompter, `4) Register started source(s) with ${bridgeUrl} (${registerMode} mode)?`, true)) {
      output.write('Skipped register/smoke.\n')
      result.skipped.push('register', 'smoke')
      return result
    }
    result.registered = await runtime.registerSources({
      bridgeUrl,
      configPath,
      replace: boolOption(options.replace),
    })
    output.write(`Registered ${result.registered.payload.sources.length} total bridge source(s). Register merges by default unless --replace is set.\n`)

    if (!await confirmQuickstart(prompter, '5) Run an evidence-only bridge smoke query?', true)) {
      output.write('Skipped smoke.\n')
      result.skipped.push('smoke')
      return result
    }
    result.smoked = await runtime.smokeBridge({
      bridgeUrl,
      query: stringOption(options.query, 'What LLMWiki sources are available and what are they for?'),
    })
    output.write(`Smoke complete: ${result.smoked.status?.state || result.smoked.status?.message?.kind || 'ok'}\n`)
    return result
  } finally {
    prompter.close()
  }
}

function createQuickstartPrompter(io, { yes = false } = {}) {
  if (typeof io.prompt === 'function') {
    return {
      async ask(question, fallback = '') {
        const answer = await io.prompt(question, fallback)
        const trimmed = String(answer ?? '').trim()
        return trimmed || fallback
      },
      close() {},
    }
  }
  const input = io.stdin || process.stdin
  const output = io.stdout || process.stdout
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

  return {
    async ask(question, fallback = '') {
      if (yes) {
        output.write(`${question}${fallback}\n`)
        return fallback
      }
      output.write(question)
      const answer = await readLine()
      const trimmed = String(answer ?? '').trim()
      return trimmed || fallback
    },
    close() {
      readline?.close()
    },
  }
}

async function confirmQuickstart(prompter, question, fallback) {
  const answer = await prompter.ask(`${question} ${fallback ? '[Y/n]' : '[y/N]'} `, fallback ? 'y' : 'n')
  return parseYesNo(answer, fallback)
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

export async function discoverCandidates({ roots, maxDepth = DEFAULT_MAX_DEPTH, limit = DEFAULT_DISCOVER_LIMIT, minScore = DEFAULT_MIN_SCORE, validate = false, serveInvocation = resolveServeInvocation({}) } = {}) {
  const discovered = new Map()
  for (const root of roots || [homedir()]) {
    const resolvedRoot = resolve(root)
    if (!safeIsDirectory(resolvedRoot)) {
      continue
    }
    for (const path of walkDirectories(resolvedRoot, maxDepth)) {
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
  let candidates = removeDescendantCandidates(removeDuplicateParents([...discovered.values()]))
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

function addOrUpdateCandidate(map, candidate) {
  const key = normalizePath(candidate.path)
  const existing = map.get(key)
  if (!existing || candidate.score > existing.score) {
    map.set(key, candidate)
  }
}

function removeDuplicateParents(candidates) {
  return candidates.filter((candidate) => {
    const childWiki = candidates.find((other) => (
      other.path !== candidate.path
      && dirname(other.path) === candidate.path
      && basename(other.path).toLowerCase() === 'wiki'
      && other.score >= candidate.score
    ))
    if (!childWiki) {
      return true
    }
    return candidate.signals.some((signal) => signal.startsWith('obsidian') || signal.startsWith('dendron') || signal.startsWith('logseq') || signal.startsWith('quartz') || signal.startsWith('foam'))
  })
}

function removeDescendantCandidates(candidates) {
  return candidates.filter((candidate) => {
    const directAppRootParent = candidates.find((other) => (
      other.path !== candidate.path
      && dirname(candidate.path) === other.path
      && basename(candidate.path).toLowerCase() === 'wiki'
      && isAppRootSignal(other)
    ))
    if (directAppRootParent) {
      return false
    }
    return !candidates.some((other) => (
      other.path !== candidate.path
      && other.score >= candidate.score
      && isSourceRootSignal(other)
      && isDescendantPath(candidate.path, other.path)
    ))
  })
}

function isSourceRootSignal(candidate) {
  if (candidate.score < 30) {
    return false
  }
  return candidate.signals.some((signal) => (
    signal.startsWith('llmwiki-marker')
    || signal.startsWith('llmwiki-root')
    || signal.startsWith('hub-file')
    || signal.startsWith('hub-files')
    || signal.startsWith('obsidian')
    || signal.startsWith('logseq')
    || signal.startsWith('dendron')
    || signal.startsWith('foam')
    || signal.startsWith('quartz')
  ))
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

function isDescendantPath(path, parent) {
  const rel = relative(parent, path)
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel)
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
  if (SKIP_DIR_NAMES.has(lower)) {
    return true
  }
  return lower.endsWith('.egg-info')
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

  return {
    path: resolve(path),
    score: Math.max(score, 0),
    confidence: confidenceForScore(score),
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

export async function startSources({ paths, host = DEFAULT_HOST, portStart = DEFAULT_PORT_START, ports = [], serveInvocation = resolveServeInvocation({}), configPath = defaultConfigPath(), logDir = defaultLogDir() } = {}) {
  if (!paths?.length) {
    throw new Error('start requires at least one --path')
  }
  mkdirSync(logDir, { recursive: true })
  const sources = []
  for (let index = 0; index < paths.length; index += 1) {
    const path = resolve(paths[index])
    if (!safeIsDirectory(path)) {
      throw new Error(`Source path is not a directory: ${path}`)
    }
    const port = ports[index] || nextAvailablePort(portStart + index)
    const manifest = await llmwikiServeJson(serveInvocation, ['manifest', path], { timeoutMs: 30000 })
    const sourceId = manifest.source_id || slug(manifest.title || basename(path))
    const out = join(logDir, `${sourceId}-${port}.out.log`)
    const err = join(logDir, `${sourceId}-${port}.err.log`)
    const outFd = openSync(out, 'a')
    const errFd = openSync(err, 'a')
    const child = spawn(
      serveInvocation.command,
      [...serveInvocation.baseArgs, 'serve', path, '--host', host, '--port', String(port)],
      {
        cwd: serveInvocation.cwd,
        detached: true,
        stdio: ['ignore', outFd, errFd],
        windowsHide: true,
      },
    )
    child.unref()
    const serveUrl = `http://${host}:${port}`
    sources.push({
      id: sourceId,
      name: manifest.title || sourceId,
      title: manifest.title || sourceId,
      protocol: 'llmwiki-http',
      status: 'ready',
      selected: index === 0,
      url: serveUrl,
      path,
      processId: child.pid,
      manifest: summarizeManifest(manifest),
      logs: { stdout: out, stderr: err },
    })
  }
  writeSourceConfig(configPath, sources)
  return { configPath, sources }
}

function nextAvailablePort(start) {
  // Avoid taking a dependency for port detection. On failure the spawned server
  // exits and the log explains the bind issue; callers can pass --port.
  return start
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
  const merged = mergeBridgeSources(existing, normalized)

  const payload = { sources: merged }
  const response = await fetchJson(new URL('/settings/sources.json', bridgeUrl), {
    method: 'PUT',
    body: JSON.stringify(payload),
    headers: { 'content-type': 'application/json' },
    timeoutMs: 10000,
  })
  return { bridgeUrl, replace, payload, response }
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

export async function smokeBridge({ bridgeUrl = DEFAULT_BRIDGE_URL, query } = {}) {
  const response = await fetchJson(new URL('/message:send', bridgeUrl), {
    method: 'POST',
    body: JSON.stringify({ data: { query, mode: 'evidence-only' } }),
    headers: { 'content-type': 'application/json' },
    timeoutMs: 30000,
  })
  return {
    bridgeUrl,
    query,
    status: response.status,
    text: response.status?.message?.parts?.find((part) => part.kind === 'text')?.text || '',
  }
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
  const siblingServe = resolve(process.cwd(), '..', 'llmwiki-serve')
  const currentServe = resolve(process.cwd(), 'llmwiki-serve')
  if (safeIsFile(join(siblingServe, 'pyproject.toml'))) {
    return { command: 'uv', baseArgs: ['run', 'llmwiki-serve'], cwd: siblingServe }
  }
  if (safeIsFile(join(currentServe, 'pyproject.toml'))) {
    return { command: 'uv', baseArgs: ['run', 'llmwiki-serve'], cwd: currentServe }
  }
  return { command: 'llmwiki-serve', baseArgs: [], cwd: process.cwd() }
}

function splitCommandArgs(value) {
  return value ? value.split(/\s+/).filter(Boolean) : []
}

async function llmwikiServeJson(invocation, args, { timeoutMs }) {
  const child = spawnSync(invocation.command, [...invocation.baseArgs, ...args], {
    cwd: invocation.cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
  })
  if (child.error) {
    throw child.error
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
    confidence: ${candidate.confidence} (${candidate.score})
    pages: ${pageText}
    signals: ${candidate.signals.join(', ')}${adapter}${startable}`
  }).join('\n\n')}\n`
}

function helpText() {
  return `llmwiki-bridge-start

Usage:
  llmwiki-bridge-start quickstart [--path DIR|--workspace|--cwd] [--bridge URL] [--yes]
  llmwiki-bridge-start discover [--home|--workspace|--cwd|--path DIR] [--validate] [--min-score 30] [--json]
  llmwiki-bridge-start start --path DIR [--port 11001]
  llmwiki-bridge-start register [--bridge URL] [--config FILE] [--replace]
  llmwiki-bridge-start smoke [--bridge URL] [--query TEXT]
  llmwiki-bridge-start doctor [--bridge URL]

Commands:
  quickstart  Guided first-run flow: discover, choose, validate selected candidates, start, register, smoke.
  discover  Find likely LLMWiki/Obsidian/Logseq/Dendron/Foam/Quartz roots.
  start     Start llmwiki-serve for explicit source paths and write a source config.
  register  Upsert started or explicit sources in llmwiki-agent-bridge settings.
  smoke     Run a small evidence-only bridge query.
  doctor    Check local tool and bridge readiness.

Discovery defaults to the current user's home directory and hides low-confidence generic folders.
Use --min-score 10 when intentionally looking for plain Markdown folders.
Register merges by default. Use --replace only when intentionally replacing the bridge registry.
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
