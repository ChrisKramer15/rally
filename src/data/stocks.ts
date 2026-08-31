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
]

export const INITIAL_INDICES: IndexQuote[] = [
  { symbol: 'SPX', name: 'S&P 500', value: 6142.33, prevClose: 6098.11, history: makeHistory(21, 6120) },
  { symbol: 'NDX', name: 'Nasdaq 100', value: 22418.9, prevClose: 22201.4, history: makeHistory(23, 22310) },
  { symbol: 'DJI', name: 'Dow Jones', value: 45012.5, prevClose: 45188.2, history: makeHistory(29, 45100) },
  { symbol: 'VIX', name: 'Volatility', value: 13.42, prevClose: 14.05, history: makeHistory(31, 13.8) },
]

export function changePct(current: number, prevClose: number): number {
  return ((current - prevClose) / prevClose) * 100
}

export function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
