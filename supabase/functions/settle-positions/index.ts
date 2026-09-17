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
/**
 * Hard ceiling on distinct symbols quoted per run. Safe at 45 because the
 * browser no longer calls Finnhub directly (it reads intraday_quotes instead),
 * so this settler owns the whole ~60/min free-tier budget. 45 leaves ~15
 * requests of headroom under 60 for per-symbol retries and clock jitter.
 */
const MAX_SYMBOLS = 45
/** Small fetch concurrency — gentle on Finnhub's 60/min free tier. */
const FETCH_CONCURRENCY = 5
/**
 * Delay between fetch batches, so requests are spread across the minute rather
 * than bursting in one second (which can trip Finnhub's per-second sub-limit
 * even when the per-minute count is legal). With FETCH_CONCURRENCY=5 and
 * MAX_SYMBOLS=45 that's 9 batches; a 750ms gap spreads them over ~6s.
 */
const BATCH_PACING_MS = 750
/**
 * Grace window (hours) for pruning intraday_quotes AFTER a symbol is no longer
 * actively traded. Rows for a symbol with a live (pending/open) trade are NEVER
 * pruned — we keep the full intraday history for the entire life of the trade
 * so the chart can render it. Once the trade closes (its `trades` row is
 * deleted), the symbol's rows become eligible and are pruned once they age past
 * this window, leaving a just-closed trade chartable for a few days.
 */
const QUOTE_GRACE_HOURS = 72

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
  first_evaluated_at: string | null
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

/** A captured quote: the current price plus the extra fields we persist. */
interface Quote {
  /** Current/last price (`c`). */
  price: number
  /** Prior session close (`pc`), or null when the provider didn't supply one. */
  prevClose: number | null
  /** Provider quote time (`t`, unix seconds), or null. */
  providerTs: number | null
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

/**
 * Fetch one Finnhub quote. Returns null on empty/unknown symbol. Throws
 * (classified) on transient errors. Returns the full quote (price + prev close
 * + provider timestamp) so the caller can both settle against `price` and
 * persist the whole thing to intraday_quotes.
 */
async function fetchQuote(symbol: string, token: string): Promise<Quote | null> {
  const url = `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`
  return await withRetry(async () => {
    const res = await fetch(url)
    if (!res.ok) {
      const msg = `Finnhub ${symbol} failed: ${res.status} ${res.statusText}`
      throw isRetryableHttpStatus(res.status) ? retryableError(msg) : nonRetryableError(msg)
    }
    const q = (await res.json()) as FinnhubQuote
    if (!q || (q.c === 0 && q.t === 0)) return null // unknown symbol
    if (!(Number.isFinite(q.c) && q.c > 0)) return null
    return {
      price: q.c,
      prevClose: Number.isFinite(q.pc) && q.pc > 0 ? q.pc : null,
      providerTs: Number.isFinite(q.t) && q.t > 0 ? q.t : null,
    }
  })
}

/**
 * Best-effort persist of the quotes captured this run into intraday_quotes.
 * Mirrors how the collector treats tiingo_request_log: a logging/write failure
 * here must NEVER break the fill/settle path, so all errors are swallowed.
 *
 * Prune policy (lifecycle-aware): rows for a symbol that is STILL actively
 * traded (`activeSymbols`) are kept regardless of age, so an open position
 * retains its full intraday history for the whole life of the trade. Only rows
 * whose symbol is NOT in the active set are eligible, and only once they age
 * past QUOTE_GRACE_HOURS — so a just-closed trade stays chartable for a few
 * days and the table still stays bounded.
 *
 * @param activeSymbols UPPERCASE symbols with a live (pending/open) trade this run.
 */
async function persistQuotes(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  quotes: Map<string, Quote>,
  quotedAtIso: string,
  activeSymbols: string[],
): Promise<void> {
  if (quotes.size === 0) return
  const rows = Array.from(quotes.entries()).map(([symbol, q]) => ({
    symbol,
    quoted_at: quotedAtIso,
    price: q.price,
    prev_close: q.prevClose,
    provider_ts: q.providerTs != null ? new Date(q.providerTs * 1000).toISOString() : null,
  }))
  try {
    // onConflict guards the rare case of two runs sharing a quoted_at second.
    await supabase.from('intraday_quotes').upsert(rows, { onConflict: 'symbol,quoted_at' })
  } catch (e) {
    console.error('intraday_quotes insert failed:', errMessage(e))
  }
  try {
    const cutoff = new Date(Date.now() - QUOTE_GRACE_HOURS * 3_600_000).toISOString()
    let del = supabase.from('intraday_quotes').delete().lt('quoted_at', cutoff)
    // Never prune a symbol we're still trading — keep its whole history alive
    // until the trade closes. `not in (...)` is skipped when nothing is active.
    if (activeSymbols.length > 0) {
      del = del.not('symbol', 'in', `(${activeSymbols.join(',')})`)
    }
    await del
  } catch {
    // best-effort prune; stale rows only slightly inflate the table.
  }
}

/** Sleep helper for pacing fetch batches. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
    const data = await withRetry(async () => {
      const r = await supabase.from('trades').select('*').in('status', ['pending', 'open'])
      if (r.error) throw retryableError(r.error.message)
      return r.data
    })
    rows = (data ?? []) as TradeRow[]
  } catch (e) {
    return await finish('failure', {}, `Read trades failed: ${errMessage(e)}`)
  }

  if (rows.length === 0) {
    return await finish('success', { symbolsQuoted: 0, filled: 0, settled: 0 }, 'No open/pending positions.')
  }

  // ── 2) Quote each distinct symbol (capped) ────────────────────────────────
  const symbols = Array.from(new Set(rows.map((r) => r.symbol.toUpperCase()))).slice(0, MAX_SYMBOLS)
  // Full captured quotes (persisted to intraday_quotes). priceBySymbol is the
  // price-only view the fill/settle logic reads.
  const quoteBySymbol = new Map<string, Quote>()
  const priceBySymbol = new Map<string, number>()
  const errorMap: Record<string, string> = {}
  for (let i = 0; i < symbols.length; i += FETCH_CONCURRENCY) {
    // Pace batches (except the first) so ~40 requests spread across the minute
    // instead of bursting — avoids Finnhub's per-second sub-limit.
    if (i > 0 && BATCH_PACING_MS > 0) await sleep(BATCH_PACING_MS)
    const batch = symbols.slice(i, i + FETCH_CONCURRENCY)
    await Promise.all(
      batch.map(async (sym) => {
        try {
          const quote = await fetchQuote(sym, finnhubKey)
          if (quote != null) {
            quoteBySymbol.set(sym, quote)
            priceBySymbol.set(sym, quote.price)
          }
        } catch (e) {
          errorMap[sym] = errMessage(e)
        }
      }),
    )
  }

  const nowIso = startedAt.toISOString()
  const todayEt = easternISODate(startedAt)

  // Persist the quotes we just pulled so the browser can read live prices from
  // the DB (no Finnhub call) and we accumulate intraday history. Best-effort —
  // never blocks or fails the fill/settle path below.
  //
  // The keep-set for the prune is EVERY active symbol from `rows` (not the
  // MAX_SYMBOLS-capped `symbols`), so even a symbol whose quote fetch was capped
  // this run still has its history protected while the trade is live.
  const activeSymbols = Array.from(new Set(rows.map((r) => r.symbol.toUpperCase())))
  await persistQuotes(supabase, quoteBySymbol, nowIso, activeSymbols)

  // ── 3) Fill pending limits + 4) settle open positions ─────────────────────
  const toUpdateTrades: Record<string, unknown>[] = []
  const closedRows: Record<string, unknown>[] = []
  const closedIds: string[] = []
  let realizedTotal = 0
  let filled = 0
  let settled = 0
  let invalidated = 0

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
      const wouldFill = shouldFill({ side: r.side, limitPrice: limit, livePrice: live })

      // FIRST-EVALUATION GUARD. A limit is meant to fill on a PULLBACK to your
      // price. If the very first live quote the settler ever sees for this order
      // already satisfies the fill, price was already on the wrong side when it
      // was placed — the pullback already happened (a stale/used-up signal). We
      // do NOT fill it (that would fill at the limit and often stop out on the
      // same quote — the "instantly filled and closed" bug). Instead we bank it
      // as an INVALIDATED $0 trade: it never really opened, so there's no loss,
      // and the history shows "didn't take, price already gone."
      //
      // `first_evaluated_at` is the durable "this order has rested through a run
      // without filling" marker. It's null on the first run that evaluates the
      // order and set thereafter, so a fill is only honored once it's non-null.
      const isFirstEval = r.first_evaluated_at == null

      if (wouldFill && isFirstEval) {
        // Invalidate: bank a $0 closed trade (reason 'invalidated') and remove
        // the pending row. Reuses the settle bank-and-delete path below — a $0
        // realized_pnl leaves the budget untouched.
        invalidated++
        closedRows.push({
          id: r.id,
          symbol: r.symbol,
          name: r.name,
          side: r.side,
          shares: r.shares,
          // Never opened: entry == exit == the limit it would have filled at, so
          // realized P/L is exactly 0 no matter how the UI recomputes it.
          entry_price: limit,
          exit_price: limit,
          realized_pnl: 0,
          opened_date: null,
          closed_date: todayEt,
          opened_at: null,
          closed_at: nowIso,
          exit_reason: 'invalidated',
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
        continue // banked as invalidated; never opened
      }

      if (wouldFill) {
        // Rested through at least one prior run (first_evaluated_at set), and now
        // the limit is crossed → a REAL fill.
        status = 'open'
        entry = limit
        filledAt = nowIso
        openedDate = todayEt
        filled++
      } else {
        // Still resting and not filling. If this was its first evaluation, stamp
        // the marker so a future crossing counts as a real fill (and a crossing
        // THIS run on a later re-place can't masquerade as a rested fill).
        if (isFirstEval) {
          toUpdateTrades.push({
            id: r.id,
            first_evaluated_at: nowIso,
            updated_at: nowIso,
          })
        }
        continue // nothing else to write
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
          exit_reason: exit.reason,
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
      // Only the changed columns, keyed by id: this is an UPDATE, not an upsert.
      // `rows` is a snapshot read at the top of the run; if the user cancelled
      // this pending order mid-run (deleting its trades row), an upsert would
      // RESURRECT the deleted row from that stale snapshot. An update matches
      // zero rows and is a harmless no-op instead.
      if (r.status === 'pending') {
        toUpdateTrades.push({
          id: r.id,
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

  if (toUpdateTrades.length > 0) {
    // Per-row UPDATE keyed by id (not a bulk upsert): a row cancelled by the
    // user mid-run is simply not matched, so a fill can't recreate a deleted
    // order. Counts are tiny (≤ MAX_SYMBOLS), so sequential updates are fine.
    for (const upd of toUpdateTrades) {
      const { id, ...changes } = upd as { id: string } & Record<string, unknown>
      const { error } = await supabase.from('trades').update(changes).eq('id', id)
      if (error) writeErrors.push(`update trade ${id}: ${error.message}`)
    }
  }

  if (closedRows.length > 0) {
    // `rows` is a stale snapshot read at the top of the run. A position the user
    // cancelled mid-run is already gone, and we must NOT bank a closed trade (or
    // count its P/L) for an order that no longer exists. Re-read which of the
    // to-be-settled ids STILL exist, and only act on those.
    const { data: liveRows, error: existErr } = await supabase
      .from('trades')
      .select('id')
      .in('id', closedIds)
    if (existErr) {
      writeErrors.push(`recheck settled trades: ${existErr.message}`)
    } else {
      const settledIds = new Set(((liveRows ?? []) as { id: string }[]).map((d) => d.id))
      const rowsToBank = closedRows.filter((c) => settledIds.has(c.id as string))
      const idsToDelete = closedIds.filter((id) => settledIds.has(id))

      // Insert the banked rows FIRST (durable), then delete the source rows —
      // so a failed insert never leaves a position deleted-but-not-banked.
      let banked = false
      if (rowsToBank.length > 0) {
        const { error: insErr } = await supabase.from('closed_trades').insert(rowsToBank)
        if (insErr) {
          writeErrors.push(`insert closed: ${insErr.message}`)
        } else {
          banked = true
        }
      }

      if (banked && idsToDelete.length > 0) {
        const { error: delErr } = await supabase.from('trades').delete().in('id', idsToDelete)
        if (delErr) writeErrors.push(`delete settled trades: ${delErr.message}`)
      }

      // Compound realized P/L, but only over positions that actually settled
      // (not ones cancelled out from under us mid-run).
      const bankedPnl = banked
        ? rowsToBank.reduce((sum, c) => sum + num(c.realized_pnl as number), 0)
        : 0
      if (bankedPnl !== 0) {
        const { data: pf, error: readErr } = await supabase
          .from('portfolio')
          .select('budget')
          .eq('id', 'default')
          .maybeSingle()
        if (readErr) {
          writeErrors.push(`read budget: ${readErr.message}`)
        } else {
          const nextBudget = num((pf as { budget: number | string } | null)?.budget) + bankedPnl
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
    invalidated,
    realizedTotal,
  }

  if (writeErrors.length > 0) {
    return await finish('failure', detail, writeErrors.join(' · '))
  }
  const status = quoteErrors > 0 && priceBySymbol.size === 0 ? 'failure' : quoteErrors > 0 ? 'partial' : 'success'
  return await finish(status, detail, `filled ${filled}, settled ${settled}, invalidated ${invalidated}`)
})
