// Claude Code transcripts: one JSONL per session under
// <config>/projects/<slug>/<sessionId>.jsonl, and each subagent the session launched in
// <slug>/<sessionId>/subagents/[<subdir>/]agent-<id>.jsonl.
//
// One API response is written as several `assistant` entries — one per content block —
// each carrying the response's full `usage`. Summing entries counts a response once per
// block (162 responses were 312 entries in the transcript this was checked against), so
// usage is taken once per `message.id`.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { costOf, priceFor } from './pricing.mjs'

export function configDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}

// The project folder name is the working directory with every character outside
// [A-Za-z0-9] turned into '-': /home/me/my_app -> -home-me-my-app.
export function projectDirFor(cwd, env = process.env) {
  return join(configDir(env), 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'))
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.jsonl')) out.push(p)
  }
  return out
}

// A path is a session file, a project folder (sessions at its top level), or the
// projects root (one folder per project). Returns [{ file, subagents: [file] }].
export function findSessions(path) {
  const st = statSync(path)
  if (!st.isDirectory()) return [{ file: path, subagents: subagentsOf(path) }]
  const top = readdirSync(path)
  const files = top.filter((f) => f.endsWith('.jsonl'))
  if (files.length) return files.map((f) => ({ file: join(path, f), subagents: subagentsOf(join(path, f)) }))
  return top
    .map((d) => join(path, d))
    .filter((d) => statSync(d).isDirectory())
    .flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.jsonl')).map((f) => join(d, f)))
    .map((file) => ({ file, subagents: subagentsOf(file) }))
}

function subagentsOf(file) {
  const dir = join(file.replace(/\.jsonl$/, ''), 'subagents')
  return existsSync(dir) ? walk(dir) : []
}

const empty = () => ({ responses: 0, input: 0, write5m: 0, write1h: 0, read: 0, output: 0, cost: 0, unpriced: 0, peak: 0 })

function promptText(content) {
  const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : content ?? []
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join(' ')
  const command = text.match(/<command-name>([^<]+)<\/command-name>/)
  if (command) return `${command[1]} ${text.match(/<command-args>([^<]*)<\/command-args>/)?.[1] ?? ''}`.trim()
  if (/^\s*</.test(text)) return null // harness wrappers: reminders, caveats, hook output
  return text.replace(/\s+/g, ' ').trim() || null
}

// Reads one transcript. `t` accumulates into an existing total, so a subagent's usage
// lands in its parent's figures as well as in its own.
function readTranscript(file, t, meta) {
  const seen = new Set()
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (meta) {
      if (e.type === 'custom-title' && e.customTitle) meta.title = e.customTitle
      if (e.gitBranch && !meta.branch) meta.branch = e.gitBranch
      if (e.cwd && !meta.cwd) meta.cwd = e.cwd
      if (e.type === 'user' && !meta.prompt && !e.isMeta) meta.prompt = promptText(e.message?.content)
    }
    const m = e.message
    if (e.type !== 'assistant' || !m?.usage) continue
    const key = m.id ?? e.requestId ?? e.uuid
    if (seen.has(key)) continue
    seen.add(key)
    const u = m.usage
    if (m.model === '<synthetic>') continue
    if (meta) {
      meta.start ??= e.timestamp
      meta.end = e.timestamp ?? meta.end
      if (m.model) meta.models[m.model] = (meta.models[m.model] ?? 0) + 1
    }
    const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
    const write = u.cache_creation_input_tokens ?? 0
    const read = u.cache_read_input_tokens ?? 0
    t.responses++
    t.input += u.input_tokens ?? 0
    t.write1h += w1h
    t.write5m += write - w1h
    t.read += read
    t.output += u.output_tokens ?? 0
    t.peak = Math.max(t.peak, (u.input_tokens ?? 0) + write + read)
    const c = costOf(m.model, u)
    if (c === null) t.unpriced++
    else t.cost += c
  }
}

export function readSession({ file, subagents }) {
  const meta = { id: basename(file, '.jsonl'), file, title: null, prompt: null, branch: null, cwd: null, start: null, end: null, models: {} }
  const main = empty()
  readTranscript(file, main, meta)
  const sub = empty()
  for (const f of subagents) readTranscript(f, sub, null)
  const total = { ...empty(), peak: main.peak }
  for (const k of ['responses', 'input', 'write5m', 'write1h', 'read', 'output', 'cost', 'unpriced']) total[k] = main[k] + sub[k]
  return { ...meta, subagentCount: subagents.length, main, subagents: sub, total }
}

export { priceFor }
