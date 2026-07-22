import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { test } from 'node:test'

import { detectLlmRuntime, discoverCandidates, mergeBridgeSources, parseArgs, parseCandidateSelection, parseYesNo, quickstart, registerSources, scoreCandidate, selectBridgeSmokeMode, smokeBridge } from '../src/index.mjs'

test('parseArgs collects repeated options', () => {
  const parsed = parseArgs(['discover', '--path', 'a', '--path', 'b', '--validate'])
  assert.equal(parsed.command, 'discover')
  assert.deepEqual(parsed.options.path, ['a', 'b'])
  assert.equal(parsed.options.validate, true)
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

test('quickstart can end after starting direct local source URLs without bridge setup', async () => {
  const calls = []
  const stdout = captureWritable()
  const answers = ['y', '2', 'y', 'n']
  const io = {
    stdout,
    stderr: stdout,
    async prompt() {
      return answers.shift()
    },
  }
  const candidates = [
    { rank: 1, path: 'first-wiki', score: 80, confidence: 'high', markdownCount: 20, signals: ['llmwiki-root:hot+index-or-overview'] },
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
  assert.match(io.stdout.text, /Validation runs only if you start selected sources/)
  assert.match(io.stdout.text, /source URLs directly/)
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
          candidates: [{ rank: 1, path: 'first-wiki', score: 80, confidence: 'high', markdownCount: 20, signals: ['llmwiki-root:hot+index-or-overview'] }],
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
  assert.match(stdout.text, /Safe start command/)
  assert.match(stdout.text, /no global install/)
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
          candidates: [{ rank: 1, path: 'bad-wiki', score: 80, confidence: 'high', markdownCount: 20, signals: ['llmwiki-root:hot+index-or-overview'] }],
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
      name: 'logseq-config',
      signal: 'logseq:config',
      setup(root) {
        mkdirSync(join(root, 'logseq'), { recursive: true })
        writeFileSync(join(root, 'logseq', 'config.edn'), '{}\n')
      },
    },
    {
      name: 'dendron',
      signal: 'dendron:dendron.yml',
      setup(root) {
        writeFileSync(join(root, 'dendron.yml'), 'version: 5\n')
      },
    },
    {
      name: 'foam',
      signal: 'foam:.foam',
      setup(root) {
        mkdirSync(join(root, '.foam'), { recursive: true })
      },
    },
    {
      name: 'quartz',
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
  }
})

test('scoreCandidate reports Logseq pages and journals as a low-confidence fallback marker', () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-logseq-pages-journals-'))
  mkdirSync(join(root, 'pages'), { recursive: true })
  mkdirSync(join(root, 'journals'), { recursive: true })

  const scored = scoreCandidate(root)
  assert(scored.score >= 10 && scored.score < 30)
  assert.equal(scored.confidence, 'low')
  assert(scored.signals.includes('logseq:pages+journals'))
})

test('scoreCandidate reports Foam VS Code extension hints as a low-confidence fallback marker', () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-foam-vscode-'))
  mkdirSync(join(root, '.vscode'), { recursive: true })
  writeFileSync(join(root, '.vscode', 'extensions.json'), '{"recommendations":["foam.foam-vscode"]}\n')

  const scored = scoreCandidate(root)
  assert(scored.score >= 10 && scored.score < 30)
  assert.equal(scored.confidence, 'low')
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
