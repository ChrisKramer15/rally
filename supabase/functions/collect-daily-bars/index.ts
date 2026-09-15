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
import { effectiveCatchupDay } from './calendar.ts'
import { isRetryableHttpStatus, nonRetryableError, retryableError, withRetry } from './retry.ts'

// --- config ----------------------------------------------------------------

const TIINGO_BASE = 'https://api.tiingo.com/tiingo/daily'

// How much history to (re)pull per run. A short window keeps daily runs cheap;
// the first ever run for a symbol still backfills this much.
const DEFAULT_LOOKBACK_DAYS = 400

// ── Hard rolling-hour rate limit ─────────────────────────────────────────────
// Tiingo's free tier allows ~50 requests per rolling hour. We enforce a HARD
// budget below that so we can NEVER exceed the cap, even if a partial primary
// failure leaves a catch-up with lots to re-fetch, or two runs land in the same
// rolling hour. The limit is enforced at the moment of each request by counting
// rows in tiingo_request_log over the last 60 minutes (see 0017 migration).
const RATE_WINDOW_MINUTES = 60
// Total requests allowed in any rolling 60-minute window (headroom under ~50).
const HOURLY_BUDGET = 45
// Requests RESERVED for 'primary' runs. A 'catchup' (or 'manual') run may only
// use budget up to (HOURLY_BUDGET - PRIMARY_RESERVE), so it can never consume
// headroom a primary needs. A 'primary' run may use the full HOURLY_BUDGET.
// This makes primary strictly higher priority than catch-up regardless of
// scheduling, satisfying "primaries always win budget."
const PRIMARY_RESERVE = 40

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

async function fetchTiingoBars(
  symbol: string,
  token: string,
  startDate: string,
): Promise<PriceRow[]> {
  const url = `${TIINGO_BASE}/${encodeURIComponent(symbol)}/prices?startDate=${startDate}&format=json`

  // Retry only TRANSIENT failures (network error / 5xx incl. 504 Gateway
  // Timeout). A 429 or other 4xx is classified non-retryable and fails fast so
  // we never spend extra Tiingo quota chasing a rate limit or a bad ticker.
  return await withRetry(async () => {
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${token}`,
      },
    })

    if (res.status === 404) return [] // unknown ticker: skip
    if (!res.ok) {
      const msg = `Tiingo ${symbol} failed: ${res.status} ${res.statusText}`
      // 429 / 4xx -> non-retryable; 5xx -> retryable transient upstream error.
      throw isRetryableHttpStatus(res.status) ? retryableError(msg) : nonRetryableError(msg)
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
  })
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Best-effort message extraction from an unknown thrown value. */
function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ── Rate-limit governor ──────────────────────────────────────────────────────

/**
 * The effective request budget for a run's mode.
 *   • primary  -> the full HOURLY_BUDGET (highest priority).
 *   • catchup / manual / anything else -> HOURLY_BUDGET - PRIMARY_RESERVE, so
 *     these can never spend budget reserved for primaries.
 * Never returns a negative number.
 */
function budgetForMode(mode: string): number {
  if (mode === 'primary') return HOURLY_BUDGET
  return Math.max(0, HOURLY_BUDGET - PRIMARY_RESERVE)
}

/**
 * Count Tiingo requests made in the last RATE_WINDOW_MINUTES. This is the
 * authoritative "how much have we already spent this hour" number, shared across
 * separate Edge Function invocations via the tiingo_request_log table. On a read
 * error we FAIL CLOSED (treat the window as full) so a probe failure can never
 * cause us to exceed the cap.
 */
async function countRecentRequests(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<number> {
  const since = new Date(Date.now() - RATE_WINDOW_MINUTES * 60_000).toISOString()
  const { count, error } = await supabase
    .from('tiingo_request_log')
    .select('id', { count: 'exact', head: true })
    .gte('requested_at', since)
  if (error) return HOURLY_BUDGET // fail closed: assume no budget left
  return count ?? 0
}

/**
 * Record that we issued `syms.length` Tiingo requests. Best-effort: a logging
 * failure must never crash the run (the count read fails closed anyway).
 */
async function recordRequests(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  mode: string,
  syms: string[],
): Promise<void> {
  if (syms.length === 0) return
  try {
    const now = new Date().toISOString()
    await supabase
      .from('tiingo_request_log')
      .insert(syms.map((symbol) => ({ requested_at: now, mode, symbol })))
  } catch (e) {
    console.error('tiingo_request_log insert failed:', errMessage(e))
  }
}

/** Best-effort prune of rows older than the rolling window; keeps the table tiny. */
async function pruneRequestLog(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - RATE_WINDOW_MINUTES * 60_000).toISOString()
    await supabase.from('tiingo_request_log').delete().lt('requested_at', cutoff)
  } catch {
    // best-effort; stale rows only slightly inflate the count toward safety
  }
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
    symbols_deferred?: number
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
    // These reads hit Supabase PostgREST (not Tiingo), so retrying transient
    // 504s here is free of any rate-limit concern and stops a single blip from
    // zeroing out an entire run (the dominant failure mode we observed).
    try {
      const listRow = await withRetry(async () => {
        const { data, error } = await supabase
          .from('watchlists')
          .select('name')
          .eq('id', watchlistId)
          .maybeSingle()
        if (error) throw retryableError(error.message)
        return data as { name: string } | null
      })
      watchlistName = listRow?.name ?? null
    } catch (e) {
      return await failResolve(`watchlist lookup failed: ${errMessage(e)}`)
    }

    try {
      symbols = await withRetry(async () => {
        const { data, error } = await supabase
          .from('watchlist')
          .select('symbol')
          .eq('active', true)
          .eq('watchlist_id', watchlistId)
        if (error) throw retryableError(error.message)
        return (data ?? []).map((r) => (r as { symbol: string }).symbol)
      })
    } catch (e) {
      return await failResolve(`watchlist read failed: ${errMessage(e)}`)
    }
  } else {
    // No list + no explicit symbols would mean the WHOLE active universe (up to
    // 400 symbols) in a single run. On Tiingo's free tier (~50 requests/hour)
    // that instantly trips the rate limit and burns the monthly unique-symbol
    // budget for a run that's guaranteed to mostly fail. There's no safe meaning
    // for an unbounded sweep here: legitimate collection is the per-watchlist
    // cron (≤40 symbols/list, staggered one list per hour), and a deliberate
    // manual refresh must pass an explicit `symbols` list. So we HARD REFUSE an
    // unscoped run rather than attempt it.
    return await failResolve(
      'Refused: unscoped full-universe sweep is disabled (Tiingo free-tier ' +
        'rate limit). Pass a watchlistId for a per-list run, or an explicit ' +
        'symbols[] for a bounded manual refresh.',
    )
  }

  const resolvedCount = symbols.length

  // ── Smart catch-up: drop symbols that already hold today's bar ───────────
  let skipped = 0
  if (mode === 'catchup' && symbols.length > 0) {
    // Compare against the latest SAFELY PUBLISHED trading day (not the raw
    // calendar date, and not a session that just closed and isn't published yet):
    // a symbol is "current" when it already holds a bar for effectiveCatchupDay.
    const freshDay = effectiveCatchupDay()
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

  // ── HARD rolling-hour rate limit ───────────────────────────────────────
  // Each Tiingo fetch = one request. Before fetching, compute how many requests
  // this run may still make: (mode budget) − (requests already made this hour).
  // We fetch AT MOST that many symbols and DEFER the rest to the next scheduled
  // run. Because the budget for a catch-up excludes PRIMARY_RESERVE, a catch-up
  // can never eat into a primary's headroom. Fails closed on any probe error.
  await pruneRequestLog(supabase)
  const alreadyUsed = await countRecentRequests(supabase)
  const modeBudget = budgetForMode(mode)
  const remaining = Math.max(0, modeBudget - alreadyUsed)

  // Split the resolved symbols into what we can fetch now vs. what must wait.
  const toFetch = symbols.slice(0, remaining)
  const deferred = symbols.slice(remaining)

  // Reserve budget up front by recording the requests we're about to make, so a
  // concurrent invocation counting the window sees them immediately (no race
  // where two runs both read the same low count and both proceed).
  await recordRequests(supabase, mode, toFetch)

  const fetchStart = performance.now()
  let fetchMs = 0
  let upsertMs = 0

  // Small concurrency: gentle on Tiingo's per-hour cap.
  const concurrency = 4
  for (let i = 0; i < toFetch.length; i += concurrency) {
    const batch = toFetch.slice(i, i + concurrency)
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

  const deferredCount = deferred.length

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
      `${fetchedOk}/${toFetch.length} fetched ok` +
      (failedCount ? ` · ${failedCount} errored` : '') +
      (deferredCount
        ? ` · ${deferredCount} deferred (rate-limit budget ${remaining}/${modeBudget}` +
          `${mode === 'primary' ? '' : `, ${PRIMARY_RESERVE} reserved for primary`}): ${deferred.join(', ')}`
        : '') +
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

  // Run-level note. Deferral (rate-limit budget spent) is a HEALTHY outcome —
  // the leftover symbols get picked up by the next scheduled run — so it's
  // surfaced as a message, not a failure. Empty (likely delisted) symbols are
  // also flagged here for at-a-glance visibility on the monitoring page.
  const messageParts: string[] = []
  if (deferredCount) {
    messageParts.push(
      `${deferredCount} symbol${deferredCount > 1 ? 's' : ''} deferred to the next run ` +
        `(hourly rate-limit budget reached): ${deferred.join(', ')}`,
    )
  }
  if (emptyCount) {
    messageParts.push(
      `${emptyCount} symbol${emptyCount > 1 ? 's' : ''} returned no data (likely delisted): ${emptySymbols.join(', ')}`,
    )
  }
  const message = messageParts.length ? messageParts.join(' | ') : undefined

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
    symbols_deferred: deferredCount,
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
    deferred: deferredCount ? deferred : undefined,
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
