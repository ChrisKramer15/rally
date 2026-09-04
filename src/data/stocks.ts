export interface Stock {
  symbol: string
  name: string
  price: number
  prevClose: number
  history: number[]
}

export interface IndexQuote {
  symbol: string
  name: string
  value: number
  prevClose: number
  history: number[]
}

// Deterministic pseudo-random history generator so initial render is stable.
function makeHistory(seed: number, base: number, points = 40): number[] {
  const out: number[] = []
  let v = base
  let s = seed
  for (let i = 0; i < points; i++) {
    // simple LCG for repeatable noise
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const noise = (s / 0x7fffffff - 0.5) * base * 0.02
    const drift = Math.sin(i / 6 + seed) * base * 0.004
    v = Math.max(base * 0.85, v + noise + drift)
    out.push(Number(v.toFixed(2)))
  }
  return out
}

export const INITIAL_STOCKS: Stock[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', price: 232.14, prevClose: 229.87, history: makeHistory(3, 230) },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', price: 178.42, prevClose: 181.03, history: makeHistory(7, 179) },
  { symbol: 'TSLA', name: 'Tesla, Inc.', price: 421.88, prevClose: 409.12, history: makeHistory(11, 415) },
  { symbol: 'MSFT', name: 'Microsoft Corp.', price: 512.6, prevClose: 514.22, history: makeHistory(2, 512) },
  { symbol: 'AMZN', name: 'Amazon.com, Inc.', price: 241.05, prevClose: 236.9, history: makeHistory(5, 239) },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', price: 205.77, prevClose: 207.41, history: makeHistory(9, 206) },
  { symbol: 'META', name: 'Meta Platforms', price: 748.31, prevClose: 731.5, history: makeHistory(13, 740) },
  { symbol: 'AMD', name: 'Adv. Micro Devices', price: 168.9, prevClose: 170.22, history: makeHistory(17, 169) },
  { symbol: 'NFLX', name: 'Netflix, Inc.', price: 892.4, prevClose: 878.15, history: makeHistory(19, 885) },
  { symbol: 'INTC', name: 'Intel Corp.', price: 24.31, prevClose: 24.88, history: makeHistory(23, 24.5) },
  { symbol: 'CRM', name: 'Salesforce, Inc.', price: 342.77, prevClose: 338.9, history: makeHistory(29, 340) },
  { symbol: 'ORCL', name: 'Oracle Corp.', price: 188.62, prevClose: 191.04, history: makeHistory(31, 189) },
  { symbol: 'ADBE', name: 'Adobe Inc.', price: 512.18, prevClose: 519.33, history: makeHistory(37, 515) },
  { symbol: 'CSCO', name: 'Cisco Systems', price: 61.44, prevClose: 60.9, history: makeHistory(41, 61) },
  { symbol: 'QCOM', name: 'Qualcomm Inc.', price: 172.55, prevClose: 174.2, history: makeHistory(43, 173) },
  { symbol: 'TXN', name: 'Texas Instruments', price: 205.9, prevClose: 203.44, history: makeHistory(47, 204) },
  { symbol: 'AVGO', name: 'Broadcom Inc.', price: 1642.3, prevClose: 1618.75, history: makeHistory(53, 1630) },
  { symbol: 'PYPL', name: 'PayPal Holdings', price: 84.12, prevClose: 85.6, history: makeHistory(59, 85) },
  { symbol: 'UBER', name: 'Uber Technologies', price: 78.35, prevClose: 76.9, history: makeHistory(61, 77.5) },
  { symbol: 'SHOP', name: 'Shopify Inc.', price: 118.44, prevClose: 121.02, history: makeHistory(67, 119) },
  { symbol: 'JPM', name: 'JPMorgan Chase', price: 268.9, prevClose: 265.15, history: makeHistory(71, 267) },
  { symbol: 'BAC', name: 'Bank of America', price: 47.62, prevClose: 46.98, history: makeHistory(73, 47.2) },
  { symbol: 'WFC', name: 'Wells Fargo', price: 78.11, prevClose: 77.4, history: makeHistory(79, 77.8) },
  { symbol: 'GS', name: 'Goldman Sachs', price: 612.45, prevClose: 604.9, history: makeHistory(83, 608) },
  { symbol: 'MS', name: 'Morgan Stanley', price: 138.7, prevClose: 137.22, history: makeHistory(89, 138) },
  { symbol: 'V', name: 'Visa Inc.', price: 342.18, prevClose: 344.6, history: makeHistory(97, 343) },
  { symbol: 'MA', name: 'Mastercard Inc.', price: 548.9, prevClose: 543.2, history: makeHistory(101, 546) },
  { symbol: 'DIS', name: 'Walt Disney Co.', price: 114.62, prevClose: 116.05, history: makeHistory(103, 115) },
  { symbol: 'KO', name: 'Coca-Cola Co.', price: 70.44, prevClose: 69.9, history: makeHistory(107, 70.2) },
  { symbol: 'PEP', name: 'PepsiCo, Inc.', price: 152.31, prevClose: 153.8, history: makeHistory(109, 153) },
  { symbol: 'MCD', name: "McDonald's Corp.", price: 308.75, prevClose: 305.4, history: makeHistory(113, 307) },
  { symbol: 'NKE', name: 'Nike, Inc.', price: 78.9, prevClose: 80.15, history: makeHistory(127, 79.5) },
  { symbol: 'SBUX', name: 'Starbucks Corp.', price: 98.44, prevClose: 96.9, history: makeHistory(131, 97.5) },
  { symbol: 'WMT', name: 'Walmart Inc.', price: 102.18, prevClose: 101.3, history: makeHistory(137, 101.8) },
  { symbol: 'COST', name: 'Costco Wholesale', price: 942.6, prevClose: 951.2, history: makeHistory(139, 947) },
  { symbol: 'HD', name: 'Home Depot', price: 412.9, prevClose: 408.5, history: makeHistory(149, 410) },
  { symbol: 'PG', name: 'Procter & Gamble', price: 168.44, prevClose: 169.9, history: makeHistory(151, 169) },
  { symbol: 'JNJ', name: 'Johnson & Johnson', price: 162.3, prevClose: 160.85, history: makeHistory(157, 161.5) },
  { symbol: 'PFE', name: 'Pfizer Inc.', price: 26.11, prevClose: 26.55, history: makeHistory(163, 26.3) },
  { symbol: 'MRK', name: 'Merck & Co.', price: 98.75, prevClose: 97.4, history: makeHistory(167, 98) },
]

export const INITIAL_INDICES: IndexQuote[] = [
  { symbol: 'SPX', name: 'S&P 500', value: 6142.33, prevClose: 6098.11, history: makeHistory(21, 6120) },
  { symbol: 'NDX', name: 'Nasdaq 100', value: 22418.9, prevClose: 22201.4, history: makeHistory(23, 22310) },
  { symbol: 'DJI', name: 'Dow Jones', value: 45012.5, prevClose: 45188.2, history: makeHistory(29, 45100) },
  { symbol: 'VIX', name: 'Volatility', value: 13.42, prevClose: 14.05, history: makeHistory(31, 13.8) },
]

/**
 * Broad-market indices are shown via their liquid ETF proxies, since the app is
 * scoped to stocks & ETFs and Tiingo's free EOD tier covers ETFs cleanly (raw
 * index symbols like ^GSPC are not reliably available). Each proxy flows through
 * the exact same Supabase daily-bar pipeline as watchlist symbols.
 *
 * `symbol` is the ETF ticker actually stored/fetched; `label` is the index name
 * shown on the card. VIX is intentionally omitted — there's no clean spot-VIX
 * ETF (VIX products track futures and diverge), and it doesn't fit the daily
 * OHLCV model.
 */
export interface IndexProxy {
  /** ETF ticker fetched from Tiingo/Supabase. */
  symbol: string
  /** Friendly index name shown on the card. */
  label: string
}

export const INDEX_PROXIES: IndexProxy[] = [
  { symbol: 'SPY', label: 'S&P 500' },
  { symbol: 'QQQ', label: 'Nasdaq 100' },
  { symbol: 'DIA', label: 'Dow Jones' },
]

/** The ETF proxy symbols the index cards track. */
export const INDEX_PROXY_SYMBOLS: string[] = INDEX_PROXIES.map((p) => p.symbol)

// Maximum number of tickers a SINGLE watchlist will track. A daily pull is one
// Tiingo request per symbol; 40 fits comfortably in a single hourly window
// (free tier ~50/hr). Each list collects in its own staggered hour, so 40/list
// keeps every list under the per-hour cap.
export const MAX_WATCHLIST = 40

// Maximum number of named watchlists. Each list gets its own staggered nightly
// collection slot (slot 1..10). 10 lists × 40 symbols = up to 400 distinct
// symbols, under Tiingo's 500-unique-symbols/month cap (a symbol lives in
// exactly one list, so lists never double-count a symbol).
export const MAX_WATCHLISTS = 10

/** Default watchlist symbols, derived from the seed stocks. */
export const DEFAULT_SYMBOLS: string[] = INITIAL_STOCKS.map((s) => s.symbol)

/**
 * Parse a free-form pasted string into a clean, deduped, uppercased list of
 * ticker symbols. Accepts commas, whitespace, and newlines as separators.
 * Caps the result at MAX_WATCHLIST.
 */
export function parseTickers(raw: string, max = MAX_WATCHLIST): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const token of raw.split(/[\s,]+/)) {
    const sym = token.trim().toUpperCase()
    // US stocks & ETFs only. Allow letters, digits, dots and dashes (e.g.
    // BRK.B, BF-B). The ':' pair syntax (crypto/forex like BINANCE:BTCUSDT) is
    // intentionally excluded — those are 24/7 tickers with different freshness.
    if (!sym || !/^[A-Z0-9.-]+$/.test(sym)) continue
    if (seen.has(sym)) continue
    seen.add(sym)
    out.push(sym)
    if (out.length >= max) break
  }
  return out
}

export function changePct(current: number, prevClose: number): number {
  return ((current - prevClose) / prevClose) * 100
}

export function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
