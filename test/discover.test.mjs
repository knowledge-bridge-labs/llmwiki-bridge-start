import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { discoverCandidates, mergeBridgeSources, parseArgs, registerSources, scoreCandidate } from '../src/index.mjs'

test('parseArgs collects repeated options', () => {
  const parsed = parseArgs(['discover', '--path', 'a', '--path', 'b', '--validate'])
  assert.equal(parsed.command, 'discover')
  assert.deepEqual(parsed.options.path, ['a', 'b'])
  assert.equal(parsed.options.validate, true)
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
