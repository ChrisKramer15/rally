// Supabase Edge Function: collect-daily-bars
//
// Pulls adjusted daily OHLCV bars from Tiingo for ONE watchlist and upserts them
// into public.prices. Runs server-side so:
//   * the Tiingo token stays a Supabase secret (never shipped to the browser), and
//   * Tiingo's lack of CORS no longer matters (this isn't a browser call).
//
// Invoked per-watchlist by pg_cron (see 0009_per_watchlist_cron.sql), which
// passes { watchlistId, mode, trigger } in the body:
//   * mode 'primary' — the list's nightly run: pull every active symbol.
//   * mode 'catchup' — SMART catch-up: skip symbols whose latest stored bar is
//                      already today, so a normal evening run leaves nothing to
//                      do the next morning. Keeps Tiingo request volume low.
//   * mode 'manual'  — an authenticated client refresh or dashboard invoke.
//
// Legacy / manual universe-wide runs are still supported: POST { symbols: [...] }
// (or nothing) collects that explicit set / the whole active table.
//
// Idempotent: prices has PK (symbol, date), so upserts are safe to repeat.
// A symbol belongs to exactly one list, so per-list runs never double-pull.
//
// Each run writes ONE pipeline_runs row with a per-STAGE breakdown (resolve ->
// fetch -> upsert) plus watchlist attribution, so the Data Pipeline page can
// show exactly where a run succeeded or failed.
//
// Required secrets (set with `supabase secrets set ...`):
//   TIINGO_KEY                  your Tiingo API token
//   SUPABASE_URL                (auto-provided in the Edge runtime)
//   SUPABASE_SERVICE_ROLE_KEY   (auto-provided; bypasses RLS to write)

import { createClient } from 'jsr:@supabase/supabase-js@2'

// --- config ----------------------------------------------------------------

const TIINGO_BASE = 'https://api.tiingo.com/tiingo/daily'

// How much history to (re)pull per run. A short window keeps daily runs cheap;
// the first ever run for a symbol still backfills this much.
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

type StageStatus = 'success' | 'partial' | 'failure' | 'skipped'

interface StageLog {
  stage: 'resolve' | 'fetch' | 'upsert'
  status: StageStatus
  ms: number
  detail: string
}

// --- helpers ---------------------------------------------------------------

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/** Minute after the 16:00 ET close at which a session's daily bar is final. */
const CLOSE_CUTOFF_MINUTES = 16 * 60 + 1 // 16:01 ET

const ET_WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
}

/** Break a Date into its America/New_York wall-clock parts. */
function etParts(date: Date): {
  year: number; month: number; day: number; hour: number; minute: number; weekday: number
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const rawHour = Number(get('hour'))
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: rawHour === 24 ? 0 : rawHour, // Intl can emit "24" at midnight
    minute: Number(get('minute')),
    weekday: ET_WEEKDAY_INDEX[get('weekday')] ?? 0,
  }
}

function toIsoDay(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Step an ISO day back one calendar day (UTC-noon anchor avoids DST edges). */
function previousIsoDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  anchor.setUTCDate(anchor.getUTCDate() - 1)
  return toIsoDay(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, anchor.getUTCDate())
}

/** Walk back to the most recent Mon-Fri (returns input if already a weekday). */
function lastWeekday(day: string): string {
  let cursor = day
  for (let i = 0; i < 7; i++) {
    const [y, m, d] = cursor.split('-').map(Number)
    const wd = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay()
    if (wd !== 0 && wd !== 6) return cursor
    cursor = previousIsoDay(cursor)
  }
  return cursor
}

/**
 * The most recent trading day whose daily bar should be considered FINAL as of
 * `now` (YYYY-MM-DD, ET). This is the date the freshest stored bar can possibly
 * carry, so the smart catch-up compares against THIS, not the raw calendar day
 * (a bar dated "today" doesn't exist until today's session closes + is pulled).
 *
 * Mirrors the client's marketCalendar.effectiveTradingDay:
 *   - weekday at/after 16:01 ET -> today
 *   - weekday before 16:01 ET   -> previous weekday
 *   - weekend                   -> previous weekday (Friday)
 * Holidays are intentionally not modeled (a missing bar just means no skip).
 */
function effectiveTradingDay(now: Date = new Date()): string {
  const et = etParts(now)
  const today = toIsoDay(et.year, et.month, et.day)
  if (et.weekday === 0 || et.weekday === 6) {
    return lastWeekday(previousIsoDay(today))
  }
  const minutesSinceMidnight = et.hour * 60 + et.minute
  if (minutesSinceMidnight >= CLOSE_CUTOFF_MINUTES) return today
  return lastWeekday(previousIsoDay(today))
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
// run outcome, so failures here are swallowed.
async function logRun(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  row: {
    status: 'success' | 'partial' | 'failure'
    started_at: string
    duration_ms: number
    trigger: string
    mode: string
    watchlist_id: string | null
    watchlist_name: string | null
    symbols_total: number
    symbols_failed: number
    symbols_skipped: number
    bars_collected: number
    per_symbol: Record<string, number>
    errors: Record<string, string>
    stages: StageLog[]
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
  const stages: StageLog[] = []

  const tiingoKey = Deno.env.get('TIINGO_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!tiingoKey || !supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Missing required environment/secrets.' }, 500)
  }

  // Service-role client bypasses RLS so it can write to prices + pipeline_runs.
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  // Optional overrides via POST body:
  //   { symbols?: string[], lookbackDays?: number, trigger?: string,
  //     mode?: 'primary'|'catchup'|'manual', watchlistId?: string }
  let explicitSymbols: string[] | undefined
  let lookbackDays = DEFAULT_LOOKBACK_DAYS
  let trigger = 'unknown'
  let mode = 'primary'
  let watchlistId: string | null = null
  try {
    if (req.headers.get('content-type')?.includes('application/json')) {
      const body = await req.json()
      if (Array.isArray(body?.symbols)) explicitSymbols = body.symbols
      if (Number.isFinite(body?.lookbackDays)) lookbackDays = body.lookbackDays
      if (typeof body?.trigger === 'string' && body.trigger) trigger = body.trigger
      if (typeof body?.mode === 'string' && body.mode) mode = body.mode
      if (typeof body?.watchlistId === 'string' && body.watchlistId) watchlistId = body.watchlistId
    }
  } catch {
    // No/invalid body is fine; fall back to the active universe + defaults.
  }

  // ── Stage 1: resolve the symbol universe + list attribution ──────────────
  const resolveStart = performance.now()
  let symbols: string[] = []
  let watchlistName: string | null = null

  const failResolve = async (msg: string) => {
    stages.push({
      stage: 'resolve',
      status: 'failure',
      ms: Math.round(performance.now() - resolveStart),
      detail: msg,
    })
    await logRun(supabase, {
      status: 'failure',
      started_at: startedAt.toISOString(),
      duration_ms: elapsed(),
      trigger,
      mode,
      watchlist_id: watchlistId,
      watchlist_name: watchlistName,
      symbols_total: 0,
      symbols_failed: 0,
      symbols_skipped: 0,
      bars_collected: 0,
      per_symbol: {},
      errors: {},
      stages,
      message: msg,
    })
    return json({ error: msg }, 500)
  }

  if (explicitSymbols) {
    // Explicit override (manual/legacy). No list scoping.
    symbols = explicitSymbols
  } else if (watchlistId) {
    // Per-list run: scope symbols to this watchlist and grab its name for logs.
    const { data: listRow, error: listErr } = await supabase
      .from('watchlists')
      .select('name')
      .eq('id', watchlistId)
      .maybeSingle()
    if (listErr) return await failResolve(`watchlist lookup failed: ${listErr.message}`)
    watchlistName = (listRow as { name: string } | null)?.name ?? null

    const { data, error } = await supabase
      .from('watchlist')
      .select('symbol')
      .eq('active', true)
      .eq('watchlist_id', watchlistId)
    if (error) return await failResolve(`watchlist read failed: ${error.message}`)
    symbols = (data ?? []).map((r) => (r as { symbol: string }).symbol)
  } else {
    // No list + no explicit symbols: the whole active universe (manual sweep).
    const { data, error } = await supabase
      .from('watchlist')
      .select('symbol')
      .eq('active', true)
    if (error) return await failResolve(`watchlist read failed: ${error.message}`)
    symbols = (data ?? []).map((r) => (r as { symbol: string }).symbol)
  }

  const resolvedCount = symbols.length

  // ── Smart catch-up: drop symbols that already hold today's bar ───────────
  let skipped = 0
  if (mode === 'catchup' && symbols.length > 0) {
    // Compare against the latest FINAL trading day (not the raw calendar date):
    // the freshest bar Tiingo can return is the last completed session's, so a
    // symbol is "current" when it already holds a bar for effectiveTradingDay.
    const freshDay = effectiveTradingDay()
    const { data: freshRows, error: freshErr } = await supabase
      .from('prices')
      .select('symbol')
      .eq('date', freshDay)
      .in('symbol', symbols)
    if (freshErr) {
      // If the freshness probe fails, fall back to pulling everything (safe).
      stages.push({
        stage: 'resolve',
        status: 'partial',
        ms: Math.round(performance.now() - resolveStart),
        detail: `${resolvedCount} symbols; catch-up freshness probe failed (${freshErr.message}), pulling all`,
      })
    } else {
      const alreadyFresh = new Set(
        (freshRows ?? []).map((r) => (r as { symbol: string }).symbol),
      )
      const before = symbols.length
      symbols = symbols.filter((s) => !alreadyFresh.has(s))
      skipped = before - symbols.length
      stages.push({
        stage: 'resolve',
        status: 'success',
        ms: Math.round(performance.now() - resolveStart),
        detail: `${resolvedCount} in list · ${skipped} already current (skipped) · ${symbols.length} to fetch`,
      })
    }
  } else {
    stages.push({
      stage: 'resolve',
      status: 'success',
      ms: Math.round(performance.now() - resolveStart),
      detail: `${resolvedCount} symbols${watchlistName ? ` in "${watchlistName}"` : ''}`,
    })
  }

  if (symbols.length === 0) {
    // Nothing to do — for catch-up this is the common (healthy) outcome.
    const detail =
      mode === 'catchup'
        ? `nothing to catch up (${skipped} already current)`
        : 'no active symbols to collect'
    stages.push({ stage: 'fetch', status: 'skipped', ms: 0, detail })
    stages.push({ stage: 'upsert', status: 'skipped', ms: 0, detail: 'no bars' })
    await logRun(supabase, {
      status: 'success',
      started_at: startedAt.toISOString(),
      duration_ms: elapsed(),
      trigger,
      mode,
      watchlist_id: watchlistId,
      watchlist_name: watchlistName,
      symbols_total: resolvedCount,
      symbols_failed: 0,
      symbols_skipped: skipped,
      bars_collected: 0,
      per_symbol: {},
      errors: {},
      stages,
      message: detail,
    })
    return json({ ok: true, message: detail, collected: 0, skipped })
  }

  // ── Stage 2 + 3: fetch from Tiingo, upsert into prices ───────────────────
  const startDate = isoDaysAgo(lookbackDays)
  const results: Record<string, number> = {}
  const errors: Record<string, string> = {}

  const fetchStart = performance.now()
  let fetchMs = 0
  let upsertMs = 0

  // Small concurrency: gentle on Tiingo's per-hour cap.
  const concurrency = 4
  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency)
    await Promise.all(
      batch.map(async (sym) => {
        const t0 = performance.now()
        let bars: PriceRow[]
        try {
          bars = await fetchTiingoBars(sym, tiingoKey, startDate)
        } catch (e) {
          errors[sym] = e instanceof Error ? e.message : String(e)
          fetchMs += performance.now() - t0
          return
        }
        fetchMs += performance.now() - t0

        if (bars.length === 0) {
          results[sym] = 0
          return
        }
        const u0 = performance.now()
        const { error } = await supabase
          .from('prices')
          .upsert(bars, { onConflict: 'symbol,date' })
        upsertMs += performance.now() - u0
        if (error) {
          errors[sym] = error.message
        } else {
          results[sym] = bars.length
        }
      }),
    )
  }

  const collected = Object.values(results).reduce((a, b) => a + b, 0)
  const failedCount = Object.keys(errors).length
  const fetchedOk = Object.keys(results).length
  const upsertedSymbols = Object.values(results).filter((n) => n > 0).length

  // Symbols that responded OK but returned ZERO bars. Tiingo does this for a
  // delisted / unknown / mis-formatted ticker (404 or an empty window), and the
  // old code silently swallowed it as a success. Surface it so a dead ticker
  // (e.g. an acquired name that stopped trading) shows up on the Data Pipeline
  // page instead of quietly wasting a collection slot forever.
  const emptySymbols = Object.keys(results)
    .filter((sym) => results[sym] === 0)
    .sort()
  const emptyCount = emptySymbols.length

  // Fetch stage reflects how many symbols we got a (non-error) response for,
  // and now flags any that came back empty (likely delisted).
  stages.push({
    stage: 'fetch',
    status: failedCount === 0 ? 'success' : fetchedOk > 0 ? 'partial' : 'failure',
    ms: Math.round(fetchMs),
    detail:
      `${fetchedOk}/${symbols.length} fetched ok` +
      (failedCount ? ` · ${failedCount} errored` : '') +
      (emptyCount ? ` · ${emptyCount} returned no data (likely delisted): ${emptySymbols.join(', ')}` : ''),
  })
  // Upsert stage reflects the write into prices.
  stages.push({
    stage: 'upsert',
    status: collected > 0 || upsertedSymbols > 0 ? 'success' : failedCount > 0 ? 'failure' : 'skipped',
    ms: Math.round(upsertMs),
    detail: `${collected} bars across ${upsertedSymbols} symbols`,
  })
  void fetchStart

  const status = failedCount === 0 ? 'success' : fetchedOk > 0 ? 'partial' : 'failure'

  // Run-level note when symbols came back empty, so the delisted tickers are
  // visible at a glance on the monitoring page (not just buried in per_symbol).
  const message = emptyCount
    ? `${emptyCount} symbol${emptyCount > 1 ? 's' : ''} returned no data (likely delisted): ${emptySymbols.join(', ')}`
    : undefined

  await logRun(supabase, {
    status,
    started_at: startedAt.toISOString(),
    duration_ms: elapsed(),
    trigger,
    mode,
    watchlist_id: watchlistId,
    watchlist_name: watchlistName,
    symbols_total: resolvedCount,
    symbols_failed: failedCount,
    symbols_skipped: skipped,
    bars_collected: collected,
    per_symbol: results,
    errors,
    stages,
    message,
  })

  return json({
    ok: failedCount === 0,
    watchlistId,
    watchlist: watchlistName,
    mode,
    symbols: symbols.length,
    skipped,
    collected,
    empty: emptyCount ? emptySymbols : undefined,
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
