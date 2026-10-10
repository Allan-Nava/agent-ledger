#!/usr/bin/env node
// Builds the GitHub Pages site into site/dist/: the landing page (site/index.html with
// the sample table filled in) and the HTML report the tool writes for the same sample.
// The sample is synthetic — scripts/sample.mjs — and the page says so.
//
//   node scripts/site.mjs

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'site', 'dist')
const sample = join(mkdtempSync(join(tmpdir(), 'ledger-sample-')), 'project')
const run = (...args) => execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' })

run('scripts/sample.mjs', sample)
mkdirSync(OUT, { recursive: true })
run('bin/agent-ledger.mjs', sample, '--by', 'branch', '--html', join(OUT, 'report.html'))
const table = run('bin/agent-ledger.mjs', sample, '--by', 'branch').split('\n\n')[0]

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const page = readFileSync(join(ROOT, 'site', 'index.html'), 'utf8')
  .replace('{{TABLE}}', esc(table))
  .replaceAll('{{VERSION}}', version)
writeFileSync(join(OUT, 'index.html'), page)
console.log(`built ${OUT}: index.html, report.html (v${version})`)
