// Supabase Edge Function: settle-positions
//
// The server-side heart of the LIVE paper-trading engine. Runs on pg_cron every
// minute during US market hours (see the 0022 migration) and:
//   1. reads all pending + open positions from `trades`,
//   2. fetches near-real-time Finnhub /quote for each distinct symbol,
//   3. FILLS pending limit orders whose limit was crossed (entry = limit price,
//      records filled_at),
//   4. SETTLES open positions whose stop/target was crossed (exit = the level,
//      records opened_at/closed_at), banking them into `closed_trades`,
//      deleting the `trades` row, and compounding realized P/L into the budget,
//   5. logs the run to `pipeline_runs` so the Data Pipeline page can show that
//      the Finnhub-backed settler is healthy alongside the Tiingo collector.
//
// This replaces the old browser-side, daily-bar fill/settle logic: fills/exits
// now happen whether or not any browser is open, at real timestamps.
//
// Secrets (set with `supabase secrets set ...`):
//   FINNHUB_KEY                 your Finnhub API token (server-side; NOT the
//                               browser VITE_ one, though the same key works)
//   SUPABASE_URL                (auto-provided in the Edge runtime)
//   SUPABASE_SERVICE_ROLE_KEY   (auto-provided; bypasses RLS to write)

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { isRetryableHttpStatus, nonRetryableError, retryableError, withRetry } from './retry.ts'
import {
  isRegularSessionOpen,
  realizedPnl,
  settleAt,
  shouldFill,
  type Side,
} from './settle.ts'

// --- config ----------------------------------------------------------------

const FINNHUB_BASE = 'https://finnhub.io/api/v1'
/** Hard ceiling on distinct symbols quoted per run (matches the app's live cap). */
const MAX_SYMBOLS = 30
/** Small fetch concurrency — gentle on Finnhub's 60/min free tier. */
const FETCH_CONCURRENCY = 5

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// --- types (snake_case rows, matching the trades/closed_trades schema) ------

interface TradeRow {
  id: string
  symbol: string
  name: string | null
  side: Side
  status: 'pending' | 'open'
  order_type: 'market' | 'limit'
  placed_date: string
  placed_at: string | null
  opened_date: string | null
  filled_at: string | null
  entry_price: number | string | null
  limit_price: number | string | null
  distal_price: number | string | null
  atr: number | string | null
  swing_target: number | string | null
  zone_kind: string | null
  zone_grade: string | null
  signal_strength: string | null
  proximal_price: number | string | null
  signal_date: string | null
  risk_reward: number | string
  shares: number
  stop_loss_price: number | string
  cash_out_price: number | string
}

interface FinnhubQuote {
  c: number
  pc: number
  t: number
}

// --- helpers ---------------------------------------------------------------

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Eastern-time YYYY-MM-DD for a date column (matches the client's todayEasternISO). */
function easternISODate(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Fetch one Finnhub quote. Returns null on empty/unknown symbol. Throws (classified) on transient errors. */
async function fetchQuote(symbol: string, token: string): Promise<number | null> {
  const url = `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`
  return await withRetry(async () => {
    const res = await fetch(url)
    if (!res.ok) {
      const msg = `Finnhub ${symbol} failed: ${res.status} ${res.statusText}`
      throw isRetryableHttpStatus(res.status) ? retryableError(msg) : nonRetryableError(msg)
    }
    const q = (await res.json()) as FinnhubQuote
    if (!q || (q.c === 0 && q.t === 0)) return null // unknown symbol
    return Number.isFinite(q.c) && q.c > 0 ? q.c : null
  })
}

/** Best-effort run log into pipeline_runs, tagged so the UI can distinguish it. */
// deno-lint-ignore no-explicit-any
async function logRun(supabase: any, row: Record<string, unknown>): Promise<void> {
  try {
    await supabase.from('pipeline_runs').insert({
      ...row,
      finished_at: new Date().toISOString(),
    })
  } catch (e) {
    console.error('pipeline_runs insert failed:', errMessage(e))
  }
}

// --- handler ---------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const startedAt = new Date()
  const runStart = performance.now()
  const elapsed = () => Math.round(performance.now() - runStart)

  const finnhubKey = Deno.env.get('FINNHUB_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!finnhubKey || !supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Missing required environment/secrets.' }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  let trigger = 'cron'
  try {
    if (req.headers.get('content-type')?.includes('application/json')) {
      const body = await req.json()
      if (typeof body?.trigger === 'string' && body.trigger) trigger = body.trigger
    }
  } catch {
    // no body is fine
  }

  const finish = async (
    status: 'success' | 'partial' | 'failure',
    detail: Record<string, unknown>,
    message?: string,
  ) => {
    await logRun(supabase, {
      status,
      started_at: startedAt.toISOString(),
      duration_ms: elapsed(),
      trigger,
      mode: 'settle',
      watchlist_id: null,
      watchlist_name: 'settle-positions',
      symbols_total: (detail.symbolsQuoted as number) ?? 0,
      symbols_failed: (detail.quoteErrors as number) ?? 0,
      symbols_skipped: 0,
      bars_collected: 0,
      per_symbol: {},
      errors: (detail.errorMap as Record<string, string>) ?? {},
      stages: [],
      message,
    })
    return json({ ok: status !== 'failure', ...detail, message }, status === 'failure' ? 500 : 200)
  }

  // Guard: outside RTH there's nothing to settle live. No-op (not an error).
  if (!isRegularSessionOpen(startedAt)) {
    return await finish('success', { skipped: 'market-closed' }, 'Market closed; nothing to settle.')
  }

  // ── 1) Read pending + open positions ──────────────────────────────────────
  let rows: TradeRow[]
  try {
    const { data, error } = await withRetry(async () => {
      const r = await supabase.from('trades').select('*').in('status', ['pending', 'open'])
      if (r.error) throw retryableError(r.error.message)
      return r
    })
    if (error) throw new Error(error.message)
    rows = (data ?? []) as TradeRow[]
  } catch (e) {
    return await finish('failure', {}, `Read trades failed: ${errMessage(e)}`)
  }

  if (rows.length === 0) {
    return await finish('success', { symbolsQuoted: 0, filled: 0, settled: 0 }, 'No open/pending positions.')
  }

  // ── 2) Quote each distinct symbol (capped) ────────────────────────────────
  const symbols = Array.from(new Set(rows.map((r) => r.symbol.toUpperCase()))).slice(0, MAX_SYMBOLS)
  const priceBySymbol = new Map<string, number>()
  const errorMap: Record<string, string> = {}
  for (let i = 0; i < symbols.length; i += FETCH_CONCURRENCY) {
    const batch = symbols.slice(i, i + FETCH_CONCURRENCY)
    await Promise.all(
      batch.map(async (sym) => {
        try {
          const price = await fetchQuote(sym, finnhubKey)
          if (price != null) priceBySymbol.set(sym, price)
        } catch (e) {
          errorMap[sym] = errMessage(e)
        }
      }),
    )
  }

  const nowIso = startedAt.toISOString()
  const todayEt = easternISODate(startedAt)

  // ── 3) Fill pending limits + 4) settle open positions ─────────────────────
  const toUpsertTrades: Record<string, unknown>[] = []
  const closedRows: Record<string, unknown>[] = []
  const closedIds: string[] = []
  let realizedTotal = 0
  let filled = 0
  let settled = 0

  for (const r of rows) {
    const live = priceBySymbol.get(r.symbol.toUpperCase())
    if (live == null) continue // no quote this run — leave untouched

    let status = r.status
    let entry = num(r.entry_price)
    let filledAt = r.filled_at
    let openedDate = r.opened_date

    // FILL: pending limit whose limit was crossed → open at the limit price.
    if (status === 'pending' && r.order_type === 'limit') {
      const limit = num(r.limit_price)
      if (shouldFill({ side: r.side, limitPrice: limit, livePrice: live })) {
        status = 'open'
        entry = limit
        filledAt = nowIso
        openedDate = todayEt
        filled++
      } else {
        continue // still resting; nothing to write
      }
    }

    // SETTLE: an open position (either already open, or just filled above)
    // whose stop/target was crossed → bank it and remove the trades row.
    if (status === 'open') {
      const exit = settleAt({
        side: r.side,
        stopLossPrice: num(r.stop_loss_price),
        cashOutPrice: num(r.cash_out_price),
        livePrice: live,
      })
      if (exit) {
        const pnl = realizedPnl(r.side, entry, exit.exitPrice, r.shares)
        realizedTotal += pnl
        settled++
        closedRows.push({
          id: r.id,
          symbol: r.symbol,
          name: r.name,
          side: r.side,
          shares: r.shares,
          entry_price: entry,
          exit_price: exit.exitPrice,
          realized_pnl: pnl,
          opened_date: openedDate,
          closed_date: todayEt,
          opened_at: filledAt,
          closed_at: nowIso,
          zone_kind: r.zone_kind,
          zone_grade: r.zone_grade,
          signal_strength: r.signal_strength,
          proximal_price: r.proximal_price,
          signal_date: r.signal_date,
          order_type: r.order_type,
          limit_price: r.limit_price,
          distal_price: r.distal_price,
          stop_loss_price: r.stop_loss_price,
          cash_out_price: r.cash_out_price,
          placed_date: r.placed_date,
          placed_at: r.placed_at,
        })
        closedIds.push(r.id)
        continue // moved to closed_trades; don't upsert back into trades
      }

      // Filled this run but not exiting yet — persist the pending→open flip.
      if (r.status === 'pending') {
        toUpsertTrades.push({
          ...r,
          status: 'open',
          entry_price: entry,
          filled_at: filledAt,
          opened_date: openedDate,
          updated_at: nowIso,
        })
      }
    }
  }

  // ── 5) Persist changes ────────────────────────────────────────────────────
  const writeErrors: string[] = []

  if (toUpsertTrades.length > 0) {
    const { error } = await supabase.from('trades').upsert(toUpsertTrades, { onConflict: 'id' })
    if (error) writeErrors.push(`upsert trades: ${error.message}`)
  }

  if (closedRows.length > 0) {
    const { error: insErr } = await supabase.from('closed_trades').insert(closedRows)
    if (insErr) {
      writeErrors.push(`insert closed: ${insErr.message}`)
    } else {
      // Only remove the open rows once the banked rows are safely inserted.
      const { error: delErr } = await supabase.from('trades').delete().in('id', closedIds)
      if (delErr) writeErrors.push(`delete settled trades: ${delErr.message}`)

      // Compound realized P/L into the single-row budget.
      if (realizedTotal !== 0) {
        const { data: pf, error: readErr } = await supabase
          .from('portfolio')
          .select('budget')
          .eq('id', 'default')
          .maybeSingle()
        if (readErr) {
          writeErrors.push(`read budget: ${readErr.message}`)
        } else {
          const nextBudget = num((pf as { budget: number | string } | null)?.budget) + realizedTotal
          const { error: budErr } = await supabase
            .from('portfolio')
            .update({ budget: nextBudget, updated_at: nowIso })
            .eq('id', 'default')
          if (budErr) writeErrors.push(`update budget: ${budErr.message}`)
        }
      }
    }
  }

  const quoteErrors = Object.keys(errorMap).length
  const detail = {
    symbolsQuoted: priceBySymbol.size,
    quoteErrors,
    errorMap,
    filled,
    settled,
    realizedTotal,
  }

  if (writeErrors.length > 0) {
    return await finish('failure', detail, writeErrors.join(' · '))
  }
  const status = quoteErrors > 0 && priceBySymbol.size === 0 ? 'failure' : quoteErrors > 0 ? 'partial' : 'success'
  return await finish(status, detail, `filled ${filled}, settled ${settled}`)
})
