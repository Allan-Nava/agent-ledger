// API list prices, USD per million tokens. Someone else's product on their release
// cadence: re-verify against the current pricing page before every release and move
// PRICES_AS_OF with it. A subscription (Pro, Max) is not billed per token — on one,
// these figures are what the same traffic would cost on the API.
export const PRICES_AS_OF = '2026-10-08'

// read: cache-read multiplier on the input price. Writes are 1.25x (5-minute TTL)
// and 2x (1-hour TTL) on every model listed.
// fast: the price under `speed: "fast"`, where the model offers it.
// tiers: a higher rate card once the request's prompt passes `above` tokens.
const MODELS = {
  'claude-fable-5-1': { input: 10, output: 50, read: 0.025 },
  'claude-mythos-5-1': { input: 10, output: 50, read: 0.025 },
  'claude-fable-5': { input: 10, output: 50, read: 0.1 },
  'claude-opus-5-5': { input: 4, output: 20, read: 0.05, fast: { input: 8, output: 40 } },
  'claude-opus-5': { input: 5, output: 25, read: 0.1, fast: { input: 10, output: 50 } },
  'claude-opus-4-8': { input: 5, output: 25, read: 0.1, fast: { input: 10, output: 50 } },
  'claude-opus-4-7': { input: 5, output: 25, read: 0.1 },
  'claude-opus-4-6': { input: 5, output: 25, read: 0.1 },
  'claude-sonnet-5-5': { input: 2, output: 10, read: 0.1 },
  'claude-sonnet-5': { input: 2, output: 10, read: 0.1 },
  'claude-sonnet-4-6': { input: 3, output: 15, read: 0.1 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, read: 0.1, tiers: [{ above: 100_000, input: 0.5, output: 2.5 }] },
  'claude-haiku-4-5': { input: 1, output: 5, read: 0.1 },
}

const WRITE_5M = 1.25
const WRITE_1H = 2

// Bedrock prefixes the ID (`anthropic.claude-…`), some providers append a date or a
// context suffix (`[1m]`); none of that changes the list price.
export function priceFor(model) {
  if (!model) return null
  const id = model.replace(/^.*?(claude-)/, '$1').replace(/\[.*\]$/, '').replace(/-\d{8}$/, '')
  return MODELS[id] ? { id, ...MODELS[id] } : null
}

// usage: one API response's `usage`, already de-duplicated. Returns USD, or null when
// the model is not in the table — an unknown model is reported, never priced at zero.
export function costOf(model, u) {
  const p = priceFor(model)
  if (!p) return null
  const read = u.cache_read_input_tokens ?? 0
  const write = u.cache_creation_input_tokens ?? 0
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const w5m = u.cache_creation ? (u.cache_creation.ephemeral_5m_input_tokens ?? 0) : write
  const prompt = (u.input_tokens ?? 0) + write + read
  let card = u.speed === 'fast' && p.fast ? p.fast : p
  for (const t of p.tiers ?? []) if (prompt > t.above) card = t
  const inRate = card.input / 1e6
  return (
    (u.input_tokens ?? 0) * inRate +
    w5m * inRate * WRITE_5M +
    w1h * inRate * WRITE_1H +
    read * inRate * p.read +
    (u.output_tokens ?? 0) * (card.output / 1e6)
  )
}
