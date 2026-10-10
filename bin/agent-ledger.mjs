#!/usr/bin/env node
// agent-ledger — what each coding-agent task cost, read off the agent's own
// transcripts. No API key; nothing leaves the machine.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configDir, findSessions, projectDirFor, readSession } from '../src/claude-code.mjs'
import { group, html, json, table } from '../src/report.mjs'

const HELP = `agent-ledger — what each Claude Code task cost, from its transcripts

usage: agent-ledger [path...] [options]

  path            a session .jsonl, a project folder, or the projects root;
                  default: this directory's project under ~/.claude/projects
  --all           every project under ~/.claude/projects
  --by <key>      session (default) | branch | day | project
  --since <date>  only sessions started on or after YYYY-MM-DD
  --window <n>    context window for the peak percentage (default 1000000)
  --json          machine-readable output
  --html <file>   write a self-contained HTML report
  -v, --version   print the version
  -h, --help      this text

Costs are API list prices; on a subscription they are what the same traffic would
cost on the API. Reads only — nothing leaves the machine.`

function parse(argv) {
  const o = { paths: [], by: 'session', window: 1_000_000, json: false, html: null, since: null, all: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const val = () => {
      const v = argv[++i]
      if (v === undefined) fail(`${a} needs a value`)
      return v
    }
    if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0) }
    else if (a === '-v' || a === '--version') {
      const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'))
      console.log(pkg.version); process.exit(0)
    }
    else if (a === '--all') o.all = true
    else if (a === '--json') o.json = true
    else if (a === '--by') {
      o.by = val()
      if (!['session', 'branch', 'day', 'project'].includes(o.by)) fail(`--by must be session, branch, day or project, not "${o.by}"`)
    }
    else if (a === '--since') o.since = val()
    else if (a === '--html') o.html = val()
    else if (a === '--window') {
      o.window = Number(val())
      if (!(o.window > 0)) fail('--window must be a positive number')
    }
    else if (a.startsWith('-')) fail(`unknown option ${a} (see --help)`)
    else o.paths.push(a)
  }
  return o
}

function fail(msg) {
  console.error(`agent-ledger: ${msg}`)
  process.exit(1)
}

const o = parse(process.argv.slice(2))
let paths = o.paths
if (o.all) paths = [join(configDir(), 'projects')]
if (!paths.length) {
  const here = projectDirFor(process.cwd())
  if (!existsSync(here)) fail(`no Claude Code sessions for ${process.cwd()} (looked in ${here}); pass a path, or --all`)
  paths = [here]
}
for (const p of paths) {
  if (!existsSync(p)) fail(`cannot read ${p}${/\s/.test(p) ? ' — several paths in one argument? pass each separately' : ''}`)
}

let sessions = paths.flatMap(findSessions).map(readSession).filter((s) => s.total.responses)
if (o.since) sessions = sessions.filter((s) => (s.start ?? '') >= o.since)
if (!sessions.length) fail('no assistant responses with usage found')
sessions.sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))

let rows
try { rows = group(sessions, o.by) } catch (e) { fail(e.message) }
const opts = { by: o.by, window: o.window }
if (o.html) {
  writeFileSync(o.html, html(rows, opts))
  console.error(`agent-ledger: wrote ${o.html}`)
}
console.log(o.json ? json(rows, opts) : table(rows, opts))
