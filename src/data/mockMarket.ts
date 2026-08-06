import type { Quote, OHLCV, AssetClass } from "../types";

// ─── Symbol catalogue ─────────────────────────────────────────────────────────

export const SYMBOLS: Record<AssetClass, { symbol: string; name: string }[]> = {
  stock: [
    { symbol: "AAPL", name: "Apple Inc." },
    { symbol: "MSFT", name: "Microsoft Corp." },
    { symbol: "GOOGL", name: "Alphabet Inc." },
    { symbol: "AMZN", name: "Amazon.com Inc." },
    { symbol: "NVDA", name: "NVIDIA Corp." },
    { symbol: "TSLA", name: "Tesla Inc." },
    { symbol: "META", name: "Meta Platforms" },
    { symbol: "JPM", name: "JPMorgan Chase" },
    { symbol: "JNJ", name: "Johnson & Johnson" },
  ],
  etf: [
    { symbol: "SPY", name: "SPDR S&P 500 ETF" },
    { symbol: "QQQ", name: "Invesco QQQ Trust" },
    { symbol: "IWM", name: "iShares Russell 2000" },
    { symbol: "GLD", name: "SPDR Gold Shares" },
    { symbol: "TLT", name: "iShares 20+ Year Treasury" },
    { symbol: "XLF", name: "Financial Select Sector" },
    { symbol: "ARKK", name: "ARK Innovation ETF" },
  ],
  crypto: [
    { symbol: "BTC/USD", name: "Bitcoin" },
    { symbol: "ETH/USD", name: "Ethereum" },
    { symbol: "SOL/USD", name: "Solana" },
    { symbol: "BNB/USD", name: "BNB" },
    { symbol: "XRP/USD", name: "XRP" },
    { symbol: "ADA/USD", name: "Cardano" },
    { symbol: "DOGE/USD", name: "Dogecoin" },
  ],
  futures: [
    { symbol: "ES", name: "E-mini S&P 500" },
    { symbol: "NQ", name: "E-mini NASDAQ-100" },
    { symbol: "CL", name: "Crude Oil WTI" },
    { symbol: "GC", name: "Gold Futures" },
    { symbol: "ZB", name: "30-Year T-Bond" },
    { symbol: "SI", name: "Silver Futures" },
  ],
  forex: [
    { symbol: "EUR/USD", name: "Euro / US Dollar" },
    { symbol: "GBP/USD", name: "British Pound / USD" },
    { symbol: "USD/JPY", name: "US Dollar / Japanese Yen" },
    { symbol: "AUD/USD", name: "Australian Dollar / USD" },
    { symbol: "USD/CAD", name: "US Dollar / Canadian Dollar" },
    { symbol: "USD/CHF", name: "US Dollar / Swiss Franc" },
  ],
};

// ─── Seed prices ─────────────────────────────────────────────────────────────

const BASE_PRICES: Record<string, number> = {
  AAPL: 227,
  MSFT: 415,
  GOOGL: 178,
  AMZN: 204,
  NVDA: 132,
  TSLA: 248,
  META: 568,
  JPM: 238,
  V: 290,
  JNJ: 152,
  SPY: 556,
  QQQ: 481,
  IWM: 209,
  GLD: 232,
  TLT: 93,
  XLF: 45,
  ARKK: 52,
  "BTC/USD": 98400,
  "ETH/USD": 3640,
  "SOL/USD": 178,
  "BNB/USD": 621,
  "XRP/USD": 0.62,
  "ADA/USD": 0.44,
  "DOGE/USD": 0.17,
  ES: 5540,
  NQ: 19820,
  CL: 78,
  GC: 2340,
  ZB: 115,
  SI: 30,
  "EUR/USD": 1.088,
  "GBP/USD": 1.272,
  "USD/JPY": 149.8,
  "AUD/USD": 0.648,
  "USD/CAD": 1.362,
  "USD/CHF": 0.891,
};

/** Simulate a real-time price tick with ±0.3% jitter */
function livePrice(base: number): number {
  const jitter = (Math.random() - 0.5) * 0.006;
  return parseFloat((base * (1 + jitter)).toFixed(base < 10 ? 5 : 2));
}

export function generateQuote(
  symbol: string,
  name: string,
  assetClass: AssetClass,
): Quote {
  const base = BASE_PRICES[symbol] ?? 100;
  const price = livePrice(base);
  const prevClose = base * (1 + (Math.random() - 0.5) * 0.02);
  const change = parseFloat((price - prevClose).toFixed(price < 10 ? 5 : 2));
  const changePercent = parseFloat(((change / prevClose) * 100).toFixed(2));
  const spread = price * 0.001;

  return {
    symbol,
    name,
    assetClass,
    price,
    change,
    changePercent,
    open: parseFloat(
      (prevClose * (1 + (Math.random() - 0.5) * 0.005)).toFixed(2),
    ),
    high: parseFloat((price * (1 + Math.random() * 0.008)).toFixed(2)),
    low: parseFloat((price * (1 - Math.random() * 0.008)).toFixed(2)),
    volume: Math.floor(Math.random() * 50_000_000) + 1_000_000,
    marketCap:
      assetClass === "stock" ? price * (Math.random() * 10e9 + 1e9) : undefined,
    bid: parseFloat((price - spread / 2).toFixed(price < 10 ? 5 : 2)),
    ask: parseFloat((price + spread / 2).toFixed(price < 10 ? 5 : 2)),
    timestamp: Date.now(),
    source: "mock",
  };
}

/** Generate synthetic OHLCV history (daily candles, n days back) */
export function generateOHLCV(symbol: string, days = 90): OHLCV[] {
  const base = BASE_PRICES[symbol] ?? 100;
  const candles: OHLCV[] = [];
  let close = base * (0.8 + Math.random() * 0.4);
  const now = Date.now();

  for (let i = days; i >= 0; i--) {
    const open = close * (1 + (Math.random() - 0.5) * 0.015);
    const high = Math.max(open, close) * (1 + Math.random() * 0.01);
    const low = Math.min(open, close) * (1 - Math.random() * 0.01);
    close = open * (1 + (Math.random() - 0.5) * 0.02);
    candles.push({
      time: now - i * 86_400_000,
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
      volume: Math.floor(Math.random() * 30_000_000) + 500_000,
    });
  }
  return candles;
}

/** All symbols flattened */
export function getAllSymbols(): {
  symbol: string;
  name: string;
  assetClass: AssetClass;
}[] {
  return (
    Object.entries(SYMBOLS) as [
      AssetClass,
      { symbol: string; name: string }[],
    ][]
  ).flatMap(([assetClass, items]) => items.map((i) => ({ ...i, assetClass })));
}
