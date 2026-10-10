import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { findSessions, projectDirFor, readSession } from '../src/claude-code.mjs'
import { costOf, priceFor } from '../src/pricing.mjs'
import { group, totals } from '../src/report.mjs'

const BIN = fileURLToPath(new URL('../bin/agent-ledger.mjs', import.meta.url))
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`)

// One API response as Claude Code writes it: one entry per content block, each with
// the response's full usage.
function response(id, model, usage, blocks = 2, extra = {}) {
  return Array.from({ length: blocks }, () => ({ type: 'assistant', timestamp: '2026-10-08T10:00:00Z', ...extra, message: { id, model, usage } }))
}

function project(sessions) {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-'))
  for (const [name, entries, subagents] of sessions) {
    writeFileSync(join(dir, `${name}.jsonl`), entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
    for (const [i, sub] of (subagents ?? []).entries()) {
      const sd = join(dir, name, 'subagents')
      mkdirSync(sd, { recursive: true })
      writeFileSync(join(sd, `agent-${i}.jsonl`), sub.map((e) => JSON.stringify(e)).join('\n') + '\n')
    }
  }
  return dir
}

test('usage is counted once per response, not once per content block', () => {
  const u = { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 100 }
  const dir = project([['s1', [...response('m1', 'claude-opus-5-5', u, 3), ...response('m2', 'claude-opus-5-5', u, 2)]]])
  const [s] = findSessions(dir).map(readSession)
  assert.equal(s.total.responses, 2)
  assert.equal(s.total.output, 200)
})

test('1-hour and 5-minute cache writes are priced apart', () => {
  const u = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 3_000_000,
    cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 2_000_000 } }
  close(costOf('claude-opus-5-5', u), 4 * 1.25 + 2 * 4 * 2)
})

test('a write without the TTL breakdown is priced at the 5-minute rate', () => {
  close(costOf('claude-sonnet-5-5', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 1_000_000 }), 2 * 1.25)
})

test('cache reads use the model-specific multiplier', () => {
  const u = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 1_000_000 }
  close(costOf('claude-opus-5-5', u), 0.2)
  close(costOf('claude-fable-5-1', u), 0.25)
  close(costOf('claude-sonnet-5-5', u), 0.2)
})

test('Haiku 5.5 switches rate card above a 100K-token prompt', () => {
  const small = { input_tokens: 100_000, output_tokens: 1_000_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  const large = { ...small, input_tokens: 100_001 }
  close(costOf('claude-haiku-5-5', small), 0.01 + 0.5)
  close(costOf('claude-haiku-5-5', large), 100_001 * 0.5e-6 + 2.5)
})

test('fast mode uses the fast price where the model has one', () => {
  const u = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, speed: 'fast' }
  close(costOf('claude-opus-5-5', u), 8 + 40)
  close(costOf('claude-sonnet-5-5', u), 2 + 10)
})

test('provider prefixes and suffixes resolve to the list price', () => {
  assert.equal(priceFor('anthropic.claude-opus-5-5').id, 'claude-opus-5-5')
  assert.equal(priceFor('claude-sonnet-4-6[1m]').id, 'claude-sonnet-4-6')
  assert.equal(priceFor('claude-haiku-4-5-20251001').id, 'claude-haiku-4-5')
})

test('an unknown model is counted as unpriced, never as free', () => {
  const u = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  const dir = project([['s1', [...response('m1', 'claude-unknown-9', u), ...response('m2', 'claude-opus-5-5', u)]]])
  const [s] = findSessions(dir).map(readSession)
  assert.equal(s.total.unpriced, 1)
  assert.equal(s.total.responses, 2)
  assert.equal(costOf('claude-unknown-9', u), null)
})

test('subagent usage lands in its session; peak stays the main thread', () => {
  const big = { input_tokens: 0, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 500_000 }
  const small = { input_tokens: 1000, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  const dir = project([['s1', response('m1', 'claude-opus-5-5', small), [response('a1', 'claude-haiku-5-5', big)]]])
  const [s] = findSessions(dir).map(readSession)
  assert.equal(s.subagentCount, 1)
  assert.equal(s.total.responses, 2)
  assert.equal(s.total.output, 20)
  assert.equal(s.total.peak, 1000)
})

test('grouping by branch sums every session on it', () => {
  const u = { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  const dir = project([
    ['a', response('m1', 'claude-opus-5-5', u, 1, { gitBranch: 'fix/141' })],
    ['b', response('m2', 'claude-opus-5-5', u, 1, { gitBranch: 'fix/141' })],
    ['c', response('m3', 'claude-opus-5-5', u, 1, { gitBranch: 'main' })],
  ])
  const rows = group(findSessions(dir).map(readSession), 'branch')
  const fix = rows.find((r) => r.key === 'fix/141')
  assert.equal(fix.sessions.length, 2)
  assert.equal(fix.output, 20)
  assert.equal(totals(rows).sessions, 3)
})

test('the session label prefers a custom title, then the first real prompt', () => {
  const u = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  const dir = project([
    ['t', [{ type: 'custom-title', customTitle: 'Release 0.8.0' }, ...response('m1', 'claude-opus-5-5', u)]],
    ['p', [
      { type: 'user', message: { content: '<system-reminder>ignore me</system-reminder>' } },
      { type: 'user', message: { content: [{ type: 'text', text: 'fix   the\nparser' }] } },
      ...response('m2', 'claude-opus-5-5', u),
    ]],
    ['c', [{ type: 'user', message: { content: '<command-name>/qrspi:new</command-name>\n<command-args>141 parser</command-args>' } }, ...response('m3', 'claude-opus-5-5', u)]],
  ])
  const keys = group(findSessions(dir).map(readSession), 'session').map((r) => r.key).sort()
  assert.deepEqual(keys, ['/qrspi:new 141 parser', 'Release 0.8.0', 'fix the parser'])
})

test('the project folder name follows Claude Code: non-alphanumerics become -', () => {
  assert.ok(projectDirFor('/home/me/my_app.v2', { CLAUDE_CONFIG_DIR: '/c' }).endsWith('/c/projects/-home-me-my-app-v2'))
})

test('CLI: table, --json and --html on a project folder', () => {
  const u = { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  const dir = project([['s1', response('m1', 'claude-opus-5-5', u)]])
  const out = execFileSync(process.execPath, [BIN, dir], { encoding: 'utf8' })
  assert.match(out, /total\s+1\s+1/)
  const j = JSON.parse(execFileSync(process.execPath, [BIN, dir, '--json'], { encoding: 'utf8' }))
  close(j.totals.cost, 1000 * 4e-6 + 500 * 20e-6)
  const file = join(dir, 'r.html')
  execFileSync(process.execPath, [BIN, dir, '--html', file], { encoding: 'utf8', stdio: 'pipe' })
  assert.match(readFileSync(file, 'utf8'), /<title>agent-ledger report<\/title>/)
})

test('CLI: a missing path fails in one line', () => {
  assert.throws(() => execFileSync(process.execPath, [BIN, '/no/such/dir'], { stdio: 'pipe' }), /cannot read \/no\/such\/dir/)
})

test('CLI: --compare sums each side and shows the subagent cost apart', () => {
  const u = { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  const sub = { input_tokens: 1_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  const dir = project([
    ['sonnet', response('m1', 'claude-opus-5-5', u), [response('a1', 'claude-sonnet-5-5', sub)]],
    ['haiku', response('m2', 'claude-opus-5-5', u), [response('a2', 'claude-haiku-5-5', sub)]],
  ])
  const j = JSON.parse(execFileSync(process.execPath, [BIN, '--compare', join(dir, 'sonnet.jsonl'), join(dir, 'haiku.jsonl'), '--labels', 'sonnet,haiku', '--json'], { encoding: 'utf8' }))
  assert.deepEqual(j.labels, ['sonnet', 'haiku'])
  close(j.a.sub.cost, 2)
  close(j.b.sub.cost, 0.5) // a 1M-token prompt is above Haiku 5.5's 100K tier
  assert.equal(j.a.sub.count, 1)
  const text = execFileSync(process.execPath, [BIN, '--compare', join(dir, 'sonnet.jsonl'), join(dir, 'haiku.jsonl')], { encoding: 'utf8' })
  assert.match(text, /subagent cost\s+\$2\.00\s+\$0\.500\s+-75%/)
})

test('CLI: --compare refuses anything but two paths', () => {
  assert.throws(() => execFileSync(process.execPath, [BIN, '--compare', BIN], { stdio: 'pipe' }), /exactly two paths/)
})
