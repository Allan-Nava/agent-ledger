# agent-ledger

What each coding-agent task cost, read off the agent's own transcripts.

```bash
npx agent-ledger
```

```
day         sessions  resp       peak ctx  billable  cache read    hit    cost
----------  --------  ----  -------------  --------  ----------  -----  ------
2026-10-08         1   126  271,501 (27%)   728,332  18,257,892  99.9%  $10.58
----------  --------  ----  -------------  --------  ----------  -----  ------
total              1   126                  728,332  18,257,892  99.9%  $10.58

API list prices as of 2026-10-08; on a subscription this is what the same traffic would cost on the API.
billable = uncached input + cache writes + output. peak ctx is the largest single prompt, against a 1,000,000 window.
```

Claude Code writes every session to a JSONL under `~/.claude/projects/`, and every API
response in it carries its `usage`. That is enough to say, per session, per branch or
per day: how many tokens you paid for, how much the prompt cache saved, how close the
context came to the window, and what it cost at list price. No API key, no account,
nothing leaves the machine.

## Usage

```bash
npx agent-ledger                        # this directory's sessions
npx agent-ledger --by branch            # one row per git branch — the closest a transcript gets to "per ticket"
npx agent-ledger --all --by project     # every project on this machine
npx agent-ledger --since 2026-10-01 --by day
npx agent-ledger --html report.html     # a self-contained page to share
npx agent-ledger --json                 # for your own scripts
npx agent-ledger path/to/session.jsonl  # one session, or a project folder
```

Node 18 or newer. No dependencies.

## What the columns mean

| Column | |
|---|---|
| `resp` | API responses. Claude Code writes one response as several transcript entries — one per content block, each repeating the full `usage` — so they are counted once per message ID. Summing entries roughly doubles every figure. |
| `peak ctx` | The largest single prompt (uncached input + cache writes + cache reads) in the main thread, and its share of the window (`--window`, default 1M). Past ~40% a session is worth ending at a clean boundary rather than pushing on. |
| `billable` | Uncached input + cache writes + output: the tokens charged at full rate or more. |
| `cache read` | Tokens served from the prompt cache, charged at a fraction of the input price. |
| `hit` | Cache reads over cache reads plus uncached input. |
| `cost` | At API list prices. Cache writes are priced by TTL (1.25× for 5 minutes, 2× for 1 hour, read off `usage.cache_creation`), cache reads at the model's multiplier, fast mode at its own price, Haiku 5.5 on its higher rate card above a 100K-token prompt. A model with no price is marked `*` and left out of the cost — never priced at zero. |

Subagents are counted in the session that launched them: their transcripts sit in
`<session>/subagents/`, and their tokens and cost are added to the session's row. The
peak is the main thread's, since a subagent has its own window.

## On a subscription

Pro and Max are not billed per token. The cost column is then what the same traffic
would have cost on the API — useful for comparing tasks, models and habits, not as
your bill.

## Prices

The table is in [`src/pricing.mjs`](src/pricing.mjs), dated (`PRICES_AS_OF`), and
re-verified before every release. Prices are someone else's product on their release
cadence: a stale price is a bug — open an issue.

## Not yet

- **Codex CLI.** Its transcripts have a different shape; support lands once it is
  checked against real ones rather than guessed.
- **Comparing two runs** (before/after a change, one model against another) side by
  side.

## Licence

MIT
