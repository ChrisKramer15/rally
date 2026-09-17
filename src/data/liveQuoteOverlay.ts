/**
 * liveQuoteOverlay: merge near-real-time Finnhub quotes onto the daily-close
 * `Stock[]` feed for VALUATION/DISPLAY only.
 *
 * WHY
 * ---
 * The Backtest page and the shared `computePortfolioSummary` both read a
 * position's mark price by looking the symbol up in the `stocks` array and
 * taking `.price`. Rather than thread a second "live price" source through every
 * one of those call sites, we produce a NEW stocks array where the price (and
 * prevClose) of symbols we have a live quote for is swapped to the live value.
 * Passing THAT array to Backtest / the trade flow makes every downstream
 * calculation use live prices with no other code changes.
 *
 * SCOPE
 * -----
 * This affects valuation and display only. It does NOT touch the daily-close
 * `stocks` used by the homepage, watchlist, movers, index cards, or signal
 * generation, and it does NOT change fill/stop settlement (that logic reads the
 * daily-bar cache directly, not this array). `history` is left untouched so
 * sparklines/charts stay on daily data.
 */

import type { Stock } from './stocks'
import type { LiveQuote } from './finnhub'

/**
 * Return a copy of `stocks` with live price/prevClose merged in for any symbol
 * present in `liveQuotes`. Symbols without a live quote are returned unchanged.
 * When there are no live quotes, returns the original array reference (no
 * allocation, stable identity for memo/deps).
 */
export function overlayLiveQuotes(stocks: Stock[], liveQuotes: Map<string, LiveQuote>): Stock[] {
  if (liveQuotes.size === 0) return stocks
  let changed = false
  const out = stocks.map((s) => {
    const q = liveQuotes.get(s.symbol.toUpperCase())
    if (!q || !(q.price > 0)) return s
    changed = true
    return {
      ...s,
      price: q.price,
      // Prefer the live prior close so intraday % change is correct; fall back
      // to the daily prevClose when the live feed doesn't provide one.
      prevClose: q.prevClose > 0 ? q.prevClose : s.prevClose,
    }
  })
  return changed ? out : stocks
}
