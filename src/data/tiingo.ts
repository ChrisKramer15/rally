/**
 * Shared daily-bar type.
 *
 * NOTE: The browser no longer calls Tiingo directly — Tiingo isn't CORS-enabled,
 * so a static frontend can't fetch it from the browser. The Tiingo fetch now
 * lives server-side in the Supabase Edge Function (`supabase/functions/
 * collect-daily-bars`), which pulls Tiingo and upserts bars into the `prices`
 * table. The browser reads those bars from Supabase (see supabaseDailyStore.ts).
 *
 * This module is kept as the canonical home of the `DailyBar` shape that the
 * cache, store, and hook all share.
 */

import type { TradingDay } from './marketCalendar'

/** One adjusted daily OHLCV bar. Adjusted fields account for splits/dividends. */
export interface DailyBar {
  /** Session date as YYYY-MM-DD (exchange local). */
  date: TradingDay
  open: number
  high: number
  low: number
  close: number
  volume: number
}
