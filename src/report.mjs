import { PRICES_AS_OF } from './pricing.mjs'

const SUMS = ['responses', 'input', 'write5m', 'write1h', 'read', 'output', 'cost', 'unpriced']

export function billable(t) {
  return t.input + t.write5m + t.write1h + t.output
}

export function hitRatio(t) {
  return t.read + t.input ? t.read / (t.read + t.input) : null
}

const label = (s) => s.title ?? s.prompt ?? s.id

// by: session | branch | day | project. A branch is the closest thing a transcript has
// to a ticket: every session spent on it, whatever it was called, lands in one row.
export function group(sessions, by) {
  if (by === 'session') {
    return sessions.map((s) => ({ key: label(s), sessions: [s], ...s.total, peak: s.main.peak, subagents: s.subagentCount, start: s.start }))
  }
  const keyOf = {
    branch: (s) => s.branch ?? '(no branch)',
    day: (s) => (s.start ?? '').slice(0, 10) || '(no date)',
    project: (s) => s.cwd ?? '(unknown)',
  }[by]
  if (!keyOf) throw new Error(`--by must be session, branch, day or project, not "${by}"`)
  const rows = new Map()
  for (const s of sessions) {
    const k = keyOf(s)
    const r = rows.get(k) ?? { key: k, sessions: [], peak: 0, subagents: 0, start: s.start, ...Object.fromEntries(SUMS.map((x) => [x, 0])) }
    r.sessions.push(s)
    for (const x of SUMS) r[x] += s.total[x]
    r.peak = Math.max(r.peak, s.main.peak)
    r.subagents += s.subagentCount
    if ((s.start ?? '') < (r.start ?? '￿')) r.start = s.start
    rows.set(k, r)
  }
  return [...rows.values()]
}

export function totals(rows) {
  const t = Object.fromEntries(SUMS.map((x) => [x, 0]))
  for (const r of rows) for (const x of SUMS) t[x] += r[x]
  t.sessions = rows.reduce((n, r) => n + r.sessions.length, 0)
  return t
}

const n = (x) => x.toLocaleString('en-GB')
const usd = (x) => (x >= 100 ? `$${x.toFixed(0)}` : x >= 1 ? `$${x.toFixed(2)}` : `$${x.toFixed(3)}`)
const pct = (x) => (x === null ? '—' : x < 1 && x >= 0.995 ? `${(Math.floor(1000 * x) / 10).toFixed(1)}%` : `${(100 * x).toFixed(0)}%`)
const clip = (s, w) => (s.length > w ? `${s.slice(0, w - 1)}…` : s)

export function table(rows, { by, window }) {
  const cols = [by, 'sessions', 'resp', 'peak ctx', 'billable', 'cache read', 'hit', 'cost']
  const t = totals(rows)
  const line = (r, key, sessions) => [
    clip(key, 48), sessions, n(r.responses), r.peak === undefined ? '' : `${n(r.peak)} (${pct(r.peak / window)})`,
    n(billable(r)), n(r.read), pct(hitRatio(r)), usd(r.cost) + (r.unpriced ? '*' : ''),
  ]
  const data = rows.map((r) => line(r, r.key, String(r.sessions.length)))
  data.push(line({ ...t, peak: undefined }, 'total', String(t.sessions)))
  const w = cols.map((c, i) => Math.max(c.length, ...data.map((r) => r[i].length)))
  const fmt = (r) => r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ')
  const out = [fmt(cols), w.map((x) => '-'.repeat(x)).join('  '), ...data.slice(0, -1).map(fmt), w.map((x) => '-'.repeat(x)).join('  '), fmt(data.at(-1))]
  out.push('')
  out.push(`API list prices as of ${PRICES_AS_OF}; on a subscription this is what the same traffic would cost on the API.`)
  out.push(`billable = uncached input + cache writes + output. peak ctx is the largest single prompt, against a ${n(window)} window.`)
  if (t.unpriced) out.push(`* ${n(t.unpriced)} responses from a model with no price in the table — left out of the cost, not priced at zero.`)
  return out.join('\n')
}

export function json(rows, { by, window }) {
  return JSON.stringify({
    pricesAsOf: PRICES_AS_OF, by, window,
    totals: totals(rows),
    rows: rows.map(({ sessions, ...r }) => ({ ...r, billable: billable(r), hitRatio: hitRatio(r), sessions: sessions.map((s) => s.id) })),
  }, null, 2)
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

export function html(rows, { by, window }) {
  const t = totals(rows)
  const max = Math.max(...rows.map((r) => r.cost), 1e-9)
  const sorted = [...rows].sort((a, b) => b.cost - a.cost)
  const body = sorted.map((r) => `<tr>
<td class="k">${esc(clip(r.key, 80))}</td><td>${r.sessions.length}</td><td>${n(r.responses)}</td>
<td>${n(r.peak)} <span class="dim">${pct(r.peak / window)}</span></td><td>${n(billable(r))}</td><td>${pct(hitRatio(r))}</td>
<td class="c"><span class="bar" style="width:${((100 * r.cost) / max).toFixed(1)}%"></span>${usd(r.cost)}${r.unpriced ? '*' : ''}</td></tr>`).join('\n')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-ledger report</title>
<style>
:root{--bg:#fbfaf8;--fg:#1d1b19;--dim:#6b665f;--line:#e4e0da;--bar:#b7552f33;--accent:#b7552f}
@media (prefers-color-scheme:dark){:root{--bg:#171513;--fg:#ece8e2;--dim:#9b958c;--line:#2e2a26;--bar:#d0764f40;--accent:#d0764f}}
body{background:var(--bg);color:var(--fg);font:14px/1.45 ui-sans-serif,system-ui,sans-serif;margin:0;padding:24px 16px}
main{max-width:1100px;margin:0 auto}h1{font-size:20px;margin:0 0 4px}.dim{color:var(--dim)}
.kpis{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0}.kpi{border:1px solid var(--line);border-radius:8px;padding:10px 14px;min-width:140px}
.kpi b{display:block;font-size:20px;font-variant-numeric:tabular-nums}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}th{color:var(--dim);font-weight:500}
td.k,th:first-child{text-align:left;white-space:normal}td.c{position:relative;min-width:110px}
.bar{position:absolute;left:0;top:4px;bottom:4px;background:var(--bar);border-radius:3px}
footer{margin-top:16px;color:var(--dim);font-size:12px}
</style></head><body><main>
<h1>agent-ledger</h1><div class="dim">Claude Code sessions, grouped by ${esc(by)} — API list prices as of ${PRICES_AS_OF}</div>
<div class="kpis">
<div class="kpi"><span class="dim">cost</span><b>${usd(t.cost)}</b></div>
<div class="kpi"><span class="dim">sessions</span><b>${n(t.sessions)}</b></div>
<div class="kpi"><span class="dim">billable tokens</span><b>${n(billable(t))}</b></div>
<div class="kpi"><span class="dim">cache hit</span><b>${pct(hitRatio(t))}</b></div>
</div>
<div class="wrap"><table><thead><tr><th>${esc(by)}</th><th>sessions</th><th>responses</th><th>peak ctx</th><th>billable</th><th>hit</th><th>cost</th></tr></thead>
<tbody>
${body}
</tbody></table></div>
<footer>billable = uncached input + cache writes + output. Peak ctx is the largest single prompt, against a ${n(window)} window. On a subscription the cost is what the same traffic would cost on the API.${t.unpriced ? ` * ${n(t.unpriced)} responses from a model with no price in the table are left out of the cost.` : ''}</footer>
</main></body></html>
`
}

// Two runs side by side — before/after a change, one model against another. Each side
// is every session under its path, summed; the subagent rows say how much of the cost
// was delegated, which is the question when the subagent model is what changed.
export function compare(a, b, labels) {
  const sum = (sessions) => {
    const t = totals(group(sessions, 'session'))
    const sub = { cost: 0, responses: 0, count: 0 }
    let peak = 0
    for (const s of sessions) {
      sub.cost += s.subagents.cost
      sub.responses += s.subagents.responses
      sub.count += s.subagentCount
      peak = Math.max(peak, s.main.peak)
    }
    return { ...t, peak, sub }
  }
  const A = sum(a)
  const B = sum(b)
  const delta = (x, y) => (x ? `${y >= x ? '+' : ''}${((100 * (y - x)) / x).toFixed(0)}%` : '—')
  const rows = [
    ['sessions', n(A.sessions), n(B.sessions), ''],
    ['responses', n(A.responses), n(B.responses), delta(A.responses, B.responses)],
    ['peak ctx', n(A.peak), n(B.peak), delta(A.peak, B.peak)],
    ['billable', n(billable(A)), n(billable(B)), delta(billable(A), billable(B))],
    ['output', n(A.output), n(B.output), delta(A.output, B.output)],
    ['cache read', n(A.read), n(B.read), delta(A.read, B.read)],
    ['hit', pct(hitRatio(A)), pct(hitRatio(B)), ''],
    ['subagents', n(A.sub.count), n(B.sub.count), ''],
    ['subagent cost', usd(A.sub.cost), usd(B.sub.cost), delta(A.sub.cost, B.sub.cost)],
    ['cost', usd(A.cost) + (A.unpriced ? '*' : ''), usd(B.cost) + (B.unpriced ? '*' : ''), delta(A.cost, B.cost)],
  ]
  const cols = ['', labels[0], labels[1], `${labels[1]} vs ${labels[0]}`]
  const w = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => r[i].length)))
  const fmt = (r) => r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ')
  const out = [fmt(cols), w.map((x) => '-'.repeat(x)).join('  '), ...rows.map(fmt), '']
  out.push(`API list prices as of ${PRICES_AS_OF}. Each side is every session under its path, summed; peak ctx is the larger main-thread peak.`)
  if (A.unpriced || B.unpriced) out.push('* responses from a model with no price in the table are left out of the cost.')
  return { text: out.join('\n'), json: { pricesAsOf: PRICES_AS_OF, labels, a: A, b: B } }
}
