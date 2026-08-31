// Supabase Edge Function: collect-daily-bars
//
// Pulls adjusted daily OHLCV bars from Tiingo for the active watchlist and
// upserts them into public.prices. Runs server-side so:
//   * the Tiingo token stays a Supabase secret (never shipped to the browser), and
//   * Tiingo's lack of CORS no longer matters (this isn't a browser call).
//
// Invoked two ways:
//   * daily by pg_cron (see the cron migration), and
//   * manually (dashboard "Deploy/Invoke", or an authenticated client refresh).
//
// Idempotent: prices has PK (symbol, date), so upserts are safe to repeat.
//
// Required secrets (set with `supabase secrets set ...`):
//   TIINGO_KEY                  your Tiingo API token
//   SUPABASE_URL                (auto-provided in the Edge runtime)
//   SUPABASE_SERVICE_ROLE_KEY   (auto-provided; bypasses RLS to write)

import { createClient } from 'jsr:@supabase/supabase-js@2'

// --- config ----------------------------------------------------------------

const TIINGO_BASE = 'https://api.tiingo.com/tiingo/daily'

// How much history to (re)pull per run. A short window keeps daily runs cheap;
// the first ever run for a symbol still backfills this much. Widen for a deeper
// one-time backfill if needed.
const DEFAULT_LOOKBACK_DAYS = 400

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// --- types -----------------------------------------------------------------

interface TiingoRow {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  adjOpen: number
  adjHigh: number
  adjLow: number
  adjClose: number
  adjVolume: number
}

interface PriceRow {
  symbol: string
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// --- helpers ---------------------------------------------------------------

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

async function fetchTiingoBars(
  symbol: string,
  token: string,
  startDate: string,
): Promise<PriceRow[]> {
  const url = `${TIINGO_BASE}/${encodeURIComponent(symbol)}/prices?startDate=${startDate}&format=json`
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token ${token}`,
    },
  })

  if (res.status === 404) return [] // unknown ticker: skip
  if (!res.ok) {
    throw new Error(`Tiingo ${symbol} failed: ${res.status} ${res.statusText}`)
  }

  const rows = (await res.json()) as TiingoRow[]
  if (!Array.isArray(rows)) return []

  return rows.map((r) => ({
    symbol,
    date: r.date.slice(0, 10),
    // Adjusted values so splits/dividends don't create artificial jumps.
    open: round2(r.adjOpen ?? r.open),
    high: round2(r.adjHigh ?? r.high),
    low: round2(r.adjLow ?? r.low),
    close: round2(r.adjClose ?? r.close),
    volume: Math.round(r.adjVolume ?? r.volume ?? 0),
  }))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Persist a single run record. Best-effort: logging must never mask the actual
// run outcome, so failures here are swallowed (the collector already succeeded
// or failed on its own terms).
async function logRun(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  row: {
    status: 'success' | 'partial' | 'failure'
    started_at: string
    duration_ms: number
    trigger: string
    symbols_total: number
    symbols_failed: number
    bars_collected: number
    per_symbol: Record<string, number>
    errors: Record<string, string>
    message?: string
  },
): Promise<void> {
  try {
    await supabase.from('pipeline_runs').insert({
      ...row,
      finished_at: new Date().toISOString(),
    })
  } catch (e) {
    console.error('pipeline_runs insert failed:', e instanceof Error ? e.message : String(e))
  }
}

// --- handler ---------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startedAt = new Date()
  const runStart = performance.now()
  const elapsed = () => Math.round(performance.now() - runStart)

  const tiingoKey = Deno.env.get('TIINGO_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!tiingoKey || !supabaseUrl || !serviceRoleKey) {
    // No service-role client available here to log with; can't persist a run.
    return json({ error: 'Missing required environment/secrets.' }, 500)
  }

  // Service-role client bypasses RLS so it can write to prices + pipeline_runs.
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  // Optional overrides via POST body:
  //   { symbols?: string[], lookbackDays?: number, trigger?: string }
  let symbols: string[] | undefined
  let lookbackDays = DEFAULT_LOOKBACK_DAYS
  let trigger = 'unknown'
  try {
    if (req.headers.get('content-type')?.includes('application/json')) {
      const body = await req.json()
      if (Array.isArray(body?.symbols)) symbols = body.symbols
      if (Number.isFinite(body?.lookbackDays)) lookbackDays = body.lookbackDays
      if (typeof body?.trigger === 'string' && body.trigger) trigger = body.trigger
    }
  } catch {
    // No/invalid body is fine; fall back to the watchlist + defaults.
  }

  // Resolve the symbol universe: explicit override, else the active watchlist.
  if (!symbols) {
    const { data, error } = await supabase
      .from('watchlist')
      .select('symbol')
      .eq('active', true)
    if (error) {
      await logRun(supabase, {
        status: 'failure',
        started_at: startedAt.toISOString(),
        duration_ms: elapsed(),
        trigger,
        symbols_total: 0,
        symbols_failed: 0,
        bars_collected: 0,
        per_symbol: {},
        errors: {},
        message: `watchlist read failed: ${error.message}`,
      })
      return json({ error: `watchlist read failed: ${error.message}` }, 500)
    }
    symbols = (data ?? []).map((r) => r.symbol)
  }

  if (symbols.length === 0) {
    await logRun(supabase, {
      status: 'success',
      started_at: startedAt.toISOString(),
      duration_ms: elapsed(),
      trigger,
      symbols_total: 0,
      symbols_failed: 0,
      bars_collected: 0,
      per_symbol: {},
      errors: {},
      message: 'No active symbols to collect.',
    })
    return json({ ok: true, message: 'No active symbols to collect.', collected: 0 })
  }

  const startDate = isoDaysAgo(lookbackDays)
  const results: Record<string, number> = {}
  const errors: Record<string, string> = {}

  // Small concurrency: gentle on Tiingo's per-hour cap. Daily run, no rush.
  const concurrency = 4
  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency)
    await Promise.all(
      batch.map(async (sym) => {
        try {
          const bars = await fetchTiingoBars(sym, tiingoKey, startDate)
          if (bars.length === 0) {
            results[sym] = 0
            return
          }
          const { error } = await supabase
            .from('prices')
            .upsert(bars, { onConflict: 'symbol,date' })
          if (error) {
            errors[sym] = error.message
          } else {
            results[sym] = bars.length
          }
        } catch (e) {
          errors[sym] = e instanceof Error ? e.message : String(e)
        }
      }),
    )
  }

  const collected = Object.values(results).reduce((a, b) => a + b, 0)
  const failedCount = Object.keys(errors).length

  await logRun(supabase, {
    status: failedCount === 0 ? 'success' : 'partial',
    started_at: startedAt.toISOString(),
    duration_ms: elapsed(),
    trigger,
    symbols_total: symbols.length,
    symbols_failed: failedCount,
    bars_collected: collected,
    per_symbol: results,
    errors,
  })

  return json({
    ok: failedCount === 0,
    symbols: symbols.length,
    collected,
    perSymbol: results,
    errors: failedCount ? errors : undefined,
  })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
