/**
 * Binance public REST + WebSocket — NO API key required
 * CORS-enabled public endpoint: https://data-api.binance.vision
 * Covers: crypto spot pairs (BTC, ETH, SOL, BNB, XRP, ADA, DOGE, etc.)
 * Docs: https://developers.binance.com/docs/binance-spot-api-docs/rest-api
 */

const REST_BASE = 'https://data-api.binance.vision/api/v3';
const WS_BASE   = 'wss://data-stream.binance.vision/ws';

// ─── Symbol mapping ───────────────────────────────────────────────────────────
// Our display symbols ("BTC/USD") → Binance ticker ("BTCUSDT")

export const BINANCE_SYMBOL_MAP: Record<string, string> = {
  'BTC/USD':  'BTCUSDT',
  'ETH/USD':  'ETHUSDT',
  'SOL/USD':  'SOLUSDT',
  'BNB/USD':  'BNBUSDT',
  'XRP/USD':  'XRPUSDT',
  'ADA/USD':  'ADAUSDT',
  'DOGE/USD': 'DOGEUSDT',
};

export const BINANCE_REVERSE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(BINANCE_SYMBOL_MAP).map(([k, v]) => [v, k])
);

function toBinance(displaySymbol: string): string | null {
  return BINANCE_SYMBOL_MAP[displaySymbol] ?? null;
}

// ─── REST: ticker snapshot ────────────────────────────────────────────────────

export interface BinanceTicker {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  prevClosePrice: string;
  lastPrice: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  count: number;
}

export async function fetchBinanceTicker(displaySymbol: string): Promise<BinanceTicker | null> {
  const binSym = toBinance(displaySymbol);
  if (!binSym) return null;
  try {
    const res = await fetch(`${REST_BASE}/ticker/24hr?symbol=${binSym}`);
    if (!res.ok) return null;
    return res.json() as Promise<BinanceTicker>;
  } catch {
    return null;
  }
}

export async function fetchAllCryptoTickers(): Promise<BinanceTicker[]> {
  const symbols = Object.values(BINANCE_SYMBOL_MAP);
  try {
    const symbolsParam = encodeURIComponent(JSON.stringify(symbols));
    const res = await fetch(`${REST_BASE}/ticker/24hr?symbols=${symbolsParam}`);
    if (!res.ok) return [];
    return res.json() as Promise<BinanceTicker[]>;
  } catch {
    return [];
  }
}

// ─── REST: Klines (OHLCV history) ─────────────────────────────────────────────

export type BinanceKline = [
  number, // 0: open time
  string, // 1: open
  string, // 2: high
  string, // 3: low
  string, // 4: close
  string, // 5: volume
  number, // 6: close time
  string, // 7: quote volume
  number, // 8: trade count
  string, // 9: taker buy base vol
  string, // 10: taker buy quote vol
  string, // 11: ignore
];

export async function fetchBinanceKlines(displaySymbol: string, days = 90): Promise<BinanceKline[]> {
  const binSym = toBinance(displaySymbol);
  if (!binSym) return [];
  try {
    const res = await fetch(
      `${REST_BASE}/klines?symbol=${binSym}&interval=1d&limit=${days}`
    );
    if (!res.ok) return [];
    return res.json() as Promise<BinanceKline[]>;
  } catch {
    return [];
  }
}

// ─── WebSocket: mini-ticker stream ────────────────────────────────────────────

type PriceCallback = (displaySymbol: string, price: number, change: number, changePercent: number) => void;

const cryptoWsConnections = new Map<string, { ws: WebSocket; callbacks: Set<PriceCallback> }>();

export function subscribeToCrypto(displaySymbol: string, cb: PriceCallback): () => void {
  const binSym = toBinance(displaySymbol);
  if (!binSym) return () => {};

  const streamName = `${binSym.toLowerCase()}@miniTicker`;
  const url = `${WS_BASE}/${streamName}`;

  if (!cryptoWsConnections.has(displaySymbol)) {
    const callbacks = new Set<PriceCallback>();
    const ws = new WebSocket(url);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          s: string; c: string; o: string; h: string; l: string; v: string;
        };
        const price = parseFloat(msg.c);
        const open = parseFloat(msg.o);
        const change = price - open;
        const changePercent = (change / open) * 100;
        const dispSym = BINANCE_REVERSE_MAP[msg.s];
        if (dispSym) {
          callbacks.forEach((fn) => fn(dispSym, price, change, changePercent));
        }
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      cryptoWsConnections.delete(displaySymbol);
    };

    cryptoWsConnections.set(displaySymbol, { ws, callbacks });
  }

  const conn = cryptoWsConnections.get(displaySymbol)!;
  conn.callbacks.add(cb);

  return () => {
    conn.callbacks.delete(cb);
    if (conn.callbacks.size === 0) {
      conn.ws.close();
      cryptoWsConnections.delete(displaySymbol);
    }
  };
}

export function disconnectAllCrypto() {
  for (const conn of cryptoWsConnections.values()) {
    conn.ws.close();
  }
  cryptoWsConnections.clear();
}
