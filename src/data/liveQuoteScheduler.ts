/**
 * liveQuoteScheduler: a single, app-wide, budget-aware poller for Finnhub
 * real-time quotes.
 *
 * WHY A SINGLETON
 * ---------------
 * Finnhub's free tier allows ~60 requests/minute and `/quote` is one symbol per
 * request. Multiple screens (trade ticket, backtest, pipeline health) all want
 * live prices, often for the SAME symbols. If each polled independently we'd
 * double-spend the budget and risk 429s. Instead every consumer subscribes to
 * THIS one scheduler, which:
 *   • keeps the de-duplicated UNION of all subscribers' symbols,
 *   • paces requests to stay under a SAFE budget (below the hard 60/min cap),
 *   • only polls during regular US market hours (idles otherwise),
 *   • fans the latest quote map back out to every subscriber.
 *
 * BUDGET MATH
 * -----------
 * We target BUDGET_PER_MIN (45) requests/minute — 75% of the 60 cap for margin.
 * Each cycle we fetch every subscribed symbol once (one request each), then wait
 * long enough that (symbols / interval) stays under budget:
 *
 *   intervalMs = max(MIN_INTERVAL_MS, ceil(symbolCount / BUDGET_PER_MIN * 60s))
 *
 * So 25 symbols → ceil(25/45*60) = 34s between full refreshes = ~44 req/min.
 * Fewer symbols refresh faster; more symbols automatically slow down. The
 * per-cycle symbol count is itself capped by callers (the Signals cap), but the
 * self-throttle is the hard guarantee we never exceed budget regardless.
 */

import { fetchQuote, hasFinnhub, type LiveQuote } from './finnhub'
import { isRegularSessionOpen } from './marketCalendar'

/** Target requests/minute — kept below Finnhub's 60/min cap for safety margin. */
const BUDGET_PER_MIN = 45
/** Never poll faster than this, even with very few symbols (avoids hammering). */
const MIN_INTERVAL_MS = 6_000
/** Hard ceiling on how many symbols the scheduler will poll at once, as a final
 *  backstop beyond the caller-side signals cap. */
const MAX_SYMBOLS = 30
/** Small concurrency for each refresh cycle's fetches. */
const FETCH_CONCURRENCY = 5

export type SchedulerStatus = 'disabled' | 'idle' | 'polling' | 'closed'

/** Snapshot handed to subscribers on every update. */
export interface QuoteSnapshot {
  /** Latest quote per symbol (only symbols that have returned data). */
  quotes: Map<string, LiveQuote>
  /** Scheduler state: disabled (no token), idle (no symbols), polling, closed (market shut). */
  status: SchedulerStatus
  /** Last time a full refresh cycle completed (ms epoch), or null. */
  lastCycleAt: number | null
  /** Last request error message, if the most recent cycle hit one. */
  lastError: string | null
}

type Subscriber = (snapshot: QuoteSnapshot) => void

/** A registered subscription: its symbol set + change callback. */
interface Registration {
  symbols: Set<string>
  onUpdate: Subscriber
}

// ── Module singleton state ──────────────────────────────────────────────────
const registrations = new Set<Registration>()
const quotes = new Map<string, LiveQuote>()
let timer: ReturnType<typeof setTimeout> | null = null
let inFlight = false
let lastCycleAt: number | null = null
let lastError: string | null = null

/** The de-duplicated union of every subscriber's symbols, capped for safety. */
function unionSymbols(): string[] {
  const set = new Set<string>()
  for (const reg of registrations) {
    for (const sym of reg.symbols) {
      set.add(sym)
      if (set.size >= MAX_SYMBOLS) break
    }
    if (set.size >= MAX_SYMBOLS) break
  }
  return Array.from(set)
}

/** Current scheduler status given token/market/subscriber state. */
function currentStatus(symbolCount: number): SchedulerStatus {
  if (!hasFinnhub()) return 'disabled'
  if (!isRegularSessionOpen()) return 'closed'
  if (symbolCount === 0) return 'idle'
  return 'polling'
}

/** Build the snapshot object shared with subscribers. */
function snapshot(symbolCount: number): QuoteSnapshot {
  return {
    quotes: new Map(quotes),
    status: currentStatus(symbolCount),
    lastCycleAt,
    lastError,
  }
}

/** Notify every subscriber with the current snapshot. */
function notifyAll(): void {
  const symbolCount = unionSymbols().length
  const snap = snapshot(symbolCount)
  for (const reg of registrations) reg.onUpdate(snap)
}

/** Fetch an array of symbols with small concurrency, updating the quote map. */
async function fetchBatch(symbols: string[]): Promise<void> {
  let hitError: string | null = null
  for (let i = 0; i < symbols.length; i += FETCH_CONCURRENCY) {
    const batch = symbols.slice(i, i + FETCH_CONCURRENCY)
    await Promise.all(
      batch.map(async (sym) => {
        const q = await fetchQuote(sym)
        if (q) quotes.set(sym, q)
        else hitError = hitError ?? `No quote for ${sym}`
      }),
    )
  }
  lastError = hitError
}

/** The interval (ms) between full refresh cycles for the given symbol count. */
function intervalFor(symbolCount: number): number {
  if (symbolCount <= 0) return MIN_INTERVAL_MS
  const budgetPaceMs = Math.ceil((symbolCount / BUDGET_PER_MIN) * 60_000)
  return Math.max(MIN_INTERVAL_MS, budgetPaceMs)
}

/**
 * Run one refresh cycle, then schedule the next. Skips the actual fetch when the
 * market is closed / disabled / no symbols, but keeps a slow heartbeat so it
 * notices when the market opens or symbols get added.
 */
async function cycle(): Promise<void> {
  timer = null
  if (inFlight) return
  const symbols = unionSymbols()
  const status = currentStatus(symbols.length)

  if (status === 'polling') {
    inFlight = true
    try {
      await fetchBatch(symbols)
      lastCycleAt = Date.now()
    } finally {
      inFlight = false
    }
    notifyAll()
  } else {
    // Disabled / closed / idle: don't spend requests, just re-broadcast state.
    notifyAll()
  }

  // Reschedule only while there are subscribers AND a token exists. When
  // polling, pace by budget; when idle/closed, use a slow heartbeat to detect
  // market-open / new symbols. When 'disabled' (no token) we never reschedule —
  // the feed can't turn on without a reload, so there's nothing to wait for.
  if (registrations.size > 0 && status !== 'disabled') {
    const nextMs = status === 'polling' ? intervalFor(symbols.length) : 30_000
    timer = setTimeout(() => void cycle(), nextMs)
  }
}

/** Kick the scheduler if it isn't already running and there's work/subscribers. */
function ensureRunning(): void {
  if (timer === null && !inFlight && registrations.size > 0) {
    // Run the first cycle on the next tick so a burst of subscribe() calls
    // (e.g. several components mounting) coalesce into one initial union.
    timer = setTimeout(() => void cycle(), 0)
  }
}

/**
 * Subscribe to live quotes for a set of symbols. Returns an object with:
 *   • update(symbols) — replace this subscription's symbol set (call when the
 *     signal list / open trade changes),
 *   • unsubscribe()   — remove this subscription.
 *
 * The callback fires with the latest snapshot on each refresh cycle (and once
 * synchronously on subscribe with whatever's already cached).
 */
export function subscribeQuotes(
  initialSymbols: string[],
  onUpdate: Subscriber,
): { update: (symbols: string[]) => void; unsubscribe: () => void } {
  const reg: Registration = {
    symbols: new Set(initialSymbols.map((s) => s.toUpperCase())),
    onUpdate,
  }
  registrations.add(reg)

  // Emit the current cache immediately so a new subscriber isn't blank until the
  // next cycle.
  onUpdate(snapshot(unionSymbols().length))
  ensureRunning()

  return {
    update(symbols: string[]) {
      reg.symbols = new Set(symbols.map((s) => s.toUpperCase()))
      ensureRunning()
    },
    unsubscribe() {
      registrations.delete(reg)
      if (registrations.size === 0 && timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
