/**
 * Static ticker -> company/fund name map.
 *
 * WHY THIS EXISTS
 * ---------------
 * The daily-bar collector only pulls PRICE data from Tiingo (the `/prices`
 * endpoint) — it never fetches company metadata, so the `watchlist.name` column
 * is usually empty and the UI would otherwise show the ticker twice (symbol on
 * top, symbol again as the "name"). Rather than spend Tiingo's tight request
 * budget on a metadata lookup per symbol, we ship this bundled lookup table.
 *
 * TRADEOFFS
 * ---------
 *   + Zero API cost, works offline, instant.
 *   - Static: goes stale as listings change and won't cover every obscure
 *     ticker. When a symbol isn't found here we fall back to any name already
 *     stored in Supabase, and finally to the ticker itself (the UI simply hides
 *     the second line in that case, so there's no duplicate).
 *
 * COVERAGE
 * --------
 * Common US large/mid-cap stocks and the most-traded ETFs. Extend freely: keys
 * are UPPERCASE tickers, values are display names. Order doesn't matter.
 */

/** UPPERCASE ticker -> display name. */
export const TICKER_NAMES: Record<string, string> = {
  // --- Mega-cap tech / communication ---
  AAPL: 'Apple Inc.',
  MSFT: 'Microsoft Corp.',
  NVDA: 'NVIDIA Corp.',
  GOOGL: 'Alphabet Inc. (A)',
  GOOG: 'Alphabet Inc. (C)',
  AMZN: 'Amazon.com, Inc.',
  META: 'Meta Platforms',
  TSLA: 'Tesla, Inc.',
  AVGO: 'Broadcom Inc.',
  ORCL: 'Oracle Corp.',
  CRM: 'Salesforce, Inc.',
  ADBE: 'Adobe Inc.',
  AMD: 'Adv. Micro Devices',
  INTC: 'Intel Corp.',
  CSCO: 'Cisco Systems',
  QCOM: 'Qualcomm Inc.',
  TXN: 'Texas Instruments',
  IBM: 'IBM Corp.',
  NOW: 'ServiceNow, Inc.',
  INTU: 'Intuit Inc.',
  AMAT: 'Applied Materials',
  MU: 'Micron Technology',
  LRCX: 'Lam Research',
  ADI: 'Analog Devices',
  KLAC: 'KLA Corp.',
  SNPS: 'Synopsys, Inc.',
  CDNS: 'Cadence Design',
  PANW: 'Palo Alto Networks',
  CRWD: 'CrowdStrike',
  SNOW: 'Snowflake Inc.',
  PLTR: 'Palantir Technologies',
  NFLX: 'Netflix, Inc.',
  DIS: 'Walt Disney Co.',
  CMCSA: 'Comcast Corp.',
  T: 'AT&T Inc.',
  VZ: 'Verizon Communications',
  TMUS: 'T-Mobile US',

  // --- Internet / software / fintech ---
  PYPL: 'PayPal Holdings',
  UBER: 'Uber Technologies',
  LYFT: 'Lyft, Inc.',
  ABNB: 'Airbnb, Inc.',
  SHOP: 'Shopify Inc.',
  SQ: 'Block, Inc.',
  COIN: 'Coinbase Global',
  ROKU: 'Roku, Inc.',
  SPOT: 'Spotify Technology',
  DDOG: 'Datadog, Inc.',
  NET: 'Cloudflare, Inc.',
  ZS: 'Zscaler, Inc.',
  MDB: 'MongoDB, Inc.',
  TEAM: 'Atlassian Corp.',
  WDAY: 'Workday, Inc.',

  // --- Financials ---
  JPM: 'JPMorgan Chase',
  BAC: 'Bank of America',
  WFC: 'Wells Fargo',
  C: 'Citigroup Inc.',
  GS: 'Goldman Sachs',
  MS: 'Morgan Stanley',
  SCHW: 'Charles Schwab',
  BLK: 'BlackRock, Inc.',
  AXP: 'American Express',
  V: 'Visa Inc.',
  MA: 'Mastercard Inc.',
  BRK_B: 'Berkshire Hathaway (B)',
  'BRK.B': 'Berkshire Hathaway (B)',
  PGR: 'Progressive Corp.',
  CB: 'Chubb Ltd.',
  USB: 'U.S. Bancorp',
  PNC: 'PNC Financial',
  COF: 'Capital One',

  // --- Consumer ---
  WMT: 'Walmart Inc.',
  COST: 'Costco Wholesale',
  HD: 'Home Depot',
  LOW: "Lowe's Cos.",
  TGT: 'Target Corp.',
  NKE: 'Nike, Inc.',
  SBUX: 'Starbucks Corp.',
  MCD: "McDonald's Corp.",
  CMG: 'Chipotle Mexican Grill',
  KO: 'Coca-Cola Co.',
  PEP: 'PepsiCo, Inc.',
  PG: 'Procter & Gamble',
  CL: 'Colgate-Palmolive',
  MDLZ: 'Mondelez Intl.',
  PM: 'Philip Morris Intl.',
  MO: 'Altria Group',
  KHC: 'Kraft Heinz',
  GIS: 'General Mills',

  // --- Healthcare ---
  JNJ: 'Johnson & Johnson',
  UNH: 'UnitedHealth Group',
  LLY: 'Eli Lilly & Co.',
  PFE: 'Pfizer Inc.',
  MRK: 'Merck & Co.',
  ABBV: 'AbbVie Inc.',
  ABT: 'Abbott Laboratories',
  TMO: 'Thermo Fisher',
  DHR: 'Danaher Corp.',
  BMY: 'Bristol Myers Squibb',
  AMGN: 'Amgen Inc.',
  GILD: 'Gilead Sciences',
  CVS: 'CVS Health',
  MDT: 'Medtronic plc',
  ISRG: 'Intuitive Surgical',
  VRTX: 'Vertex Pharma',
  REGN: 'Regeneron Pharma',
  MRNA: 'Moderna, Inc.',

  // --- Industrials / energy / materials ---
  XOM: 'Exxon Mobil',
  CVX: 'Chevron Corp.',
  COP: 'ConocoPhillips',
  SLB: 'Schlumberger',
  OXY: 'Occidental Petroleum',
  BA: 'Boeing Co.',
  CAT: 'Caterpillar Inc.',
  DE: 'Deere & Co.',
  GE: 'GE Aerospace',
  HON: 'Honeywell Intl.',
  LMT: 'Lockheed Martin',
  RTX: 'RTX Corp.',
  UPS: 'United Parcel Service',
  FDX: 'FedEx Corp.',
  UNP: 'Union Pacific',
  MMM: '3M Co.',
  EMR: 'Emerson Electric',
  LIN: 'Linde plc',
  FCX: 'Freeport-McMoRan',
  NEM: 'Newmont Corp.',

  // --- Autos / travel ---
  F: 'Ford Motor Co.',
  GM: 'General Motors',
  RIVN: 'Rivian Automotive',
  LCID: 'Lucid Group',
  DAL: 'Delta Air Lines',
  UAL: 'United Airlines',
  AAL: 'American Airlines',
  CCL: 'Carnival Corp.',
  MAR: 'Marriott Intl.',
  BKNG: 'Booking Holdings',

  // --- Popular ETFs ---
  SPY: 'SPDR S&P 500 ETF',
  VOO: 'Vanguard S&P 500 ETF',
  IVV: 'iShares Core S&P 500',
  QQQ: 'Invesco QQQ Trust',
  DIA: 'SPDR Dow Jones ETF',
  IWM: 'iShares Russell 2000',
  VTI: 'Vanguard Total Market',
  ARKK: 'ARK Innovation ETF',
  XLK: 'Tech Select Sector SPDR',
  XLF: 'Financial Select SPDR',
  XLE: 'Energy Select SPDR',
  XLV: 'Health Care Select SPDR',
  XLY: 'Cons. Discr. Select SPDR',
  XLP: 'Cons. Staples Select SPDR',
  XLI: 'Industrial Select SPDR',
  XLU: 'Utilities Select SPDR',
  XLB: 'Materials Select SPDR',
  XLRE: 'Real Estate Select SPDR',
  XLC: 'Comm. Services SPDR',
  SMH: 'VanEck Semiconductor',
  SOXX: 'iShares Semiconductor',
  GLD: 'SPDR Gold Shares',
  SLV: 'iShares Silver Trust',
  TLT: 'iShares 20+ Yr Treasury',
  HYG: 'iShares High Yield Bond',
  EEM: 'iShares Emerging Markets',
  EFA: 'iShares MSCI EAFE',
}

/**
 * Look up a display name for a ticker from the static map.
 *
 * Normalizes case and the `BRK.B` / `BRK-B` / `BRK_B` share-class variants so a
 * dotted or dashed ticker still matches. Returns `undefined` when unknown so
 * callers can fall back to another source (Supabase, then the ticker itself).
 */
export function lookupTickerName(symbol: string): string | undefined {
  if (!symbol) return undefined
  const upper = symbol.toUpperCase()
  if (TICKER_NAMES[upper]) return TICKER_NAMES[upper]
  // Normalize share-class separators (BRK.B / BRK-B / BRK_B -> BRK_B key).
  const normalized = upper.replace(/[.-]/g, '_')
  return TICKER_NAMES[normalized]
}
