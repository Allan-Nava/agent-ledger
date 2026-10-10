#!/usr/bin/env node
// Writes a synthetic Claude Code project folder for the demo report on the site.
// Deterministic: the same transcripts on every run. Sample data — not a real project.
//
//   node scripts/sample.mjs <out-dir>

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const out = process.argv[2]
if (!out) {
  console.error('usage: node scripts/sample.mjs <out-dir>')
  process.exit(1)
}
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

let seed = 7
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
let msg = 0

// One session: a growing conversation whose prefix is mostly cache reads, a 1-hour
// write for each new turn, and some output. Each response is written as two entries,
// as Claude Code does.
function session({ id, title, branch, day, model, turns, base, subagents = [] }) {
  const lines = [{ type: 'custom-title', customTitle: title }, { type: 'user', gitBranch: branch, cwd: '/work/sample-app', message: { content: title } }]
  let ctx = base
  for (let t = 0; t < turns; t++) {
    const write = Math.round(800 + rand() * 6000)
    const usage = {
      input_tokens: Math.round(2 + rand() * 40),
      cache_creation_input_tokens: write,
      cache_read_input_tokens: ctx,
      output_tokens: Math.round(150 + rand() * 1800),
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: write },
    }
    ctx += write
    const ts = `${day}T${String(9 + Math.floor(t / 12)).padStart(2, '0')}:${String((t * 5) % 60).padStart(2, '0')}:00Z`
    const id_ = `msg_${++msg}`
    for (let b = 0; b < 2; b++) lines.push({ type: 'assistant', timestamp: ts, gitBranch: branch, message: { id: id_, model, usage } })
  }
  writeFileSync(join(out, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  subagents.forEach((s, i) => {
    const dir = join(out, id, 'subagents')
    mkdirSync(dir, { recursive: true })
    const sub = []
    for (let t = 0; t < s.turns; t++) {
      const usage = { input_tokens: Math.round(3000 + rand() * 9000), cache_creation_input_tokens: 0, cache_read_input_tokens: Math.round(s.base * (0.5 + rand())), output_tokens: Math.round(200 + rand() * 700) }
      const id_ = `msg_${++msg}`
      for (let b = 0; b < 2; b++) sub.push({ type: 'assistant', timestamp: `${day}T10:00:00Z`, message: { id: id_, model: s.model, usage } })
    }
    writeFileSync(join(dir, `agent-${i}.jsonl`), sub.map((l) => JSON.stringify(l)).join('\n') + '\n')
  })
}

const research = (n) => Array.from({ length: n }, () => ({ model: 'claude-haiku-5-5', turns: 14, base: 30_000 }))

session({ id: 's01', title: 'Research: rate limiter for the public API', branch: 'feat/rate-limits', day: '2026-10-05', model: 'claude-opus-5-5', turns: 38, base: 24_000, subagents: research(4) })
session({ id: 's02', title: 'Design: rate limiter for the public API', branch: 'feat/rate-limits', day: '2026-10-05', model: 'claude-opus-5-5', turns: 22, base: 18_000 })
session({ id: 's03', title: 'Implement: token bucket + middleware', branch: 'feat/rate-limits', day: '2026-10-06', model: 'claude-opus-5-5', turns: 64, base: 21_000 })
session({ id: 's04', title: 'Fix flaky webhook retry test', branch: 'fix/webhook-retry', day: '2026-10-06', model: 'claude-sonnet-5-5', turns: 26, base: 16_000 })
session({ id: 's05', title: 'Bump dependencies, fix the two breaking changes', branch: 'chore/deps', day: '2026-10-07', model: 'claude-sonnet-5-5', turns: 18, base: 15_000 })
session({ id: 's06', title: 'One long session: migrate the billing module', branch: 'refactor/billing', day: '2026-10-07', model: 'claude-opus-5-5', turns: 140, base: 26_000 })
