/**
 * Live-quote types.
 *
 * The browser NO LONGER calls Finnhub directly. Live prices are captured
 * server-side by the settle-positions Edge Function (which quotes Finnhub for
 * every pending/open position each minute) and written to the Supabase
 * `intraday_quotes` table. The browser reads that table via
 * `intradayQuotesStore` / `useLiveQuotes` — this frees the entire Finnhub
 * free-tier budget for the settler and removes the old browser/server 429
 * collisions.
 *
 * This module is kept only as the home of the shared `LiveQuote` shape that the
 * quote store, the overlay, and the hooks consume. There is intentionally no
 * browser-side network fetch here anymore.
 *
 * TOKEN
 * -----
 * `VITE_FINNHUB_TOKEN` is no longer used by the browser. The server settler uses
 * its own `FINNHUB_KEY` Supabase secret. The VITE var can be removed from the
 * client env; it is ignored here.
 */

/** A single real-time-ish quote for one symbol. */
export interface LiveQuote {
  symbol: string
  /** Current/last price. */
  price: number
  /** Prior session close (for % change vs the prior day). */
  prevClose: number
  /** Today's open. May be 0 when sourced from intraday_quotes (not stored there). */
  open: number
  /** Today's high. May be 0 when sourced from intraday_quotes (not stored there). */
  high: number
  /** Today's low. May be 0 when sourced from intraday_quotes (not stored there). */
  low: number
  /** When this quote was captured (ms epoch). */
  fetchedAt: number
}
