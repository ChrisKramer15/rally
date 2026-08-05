/**
 * Finnhub REST + WebSocket client
 * Free tier: 60 REST calls/min, real-time WebSocket for stocks/forex/crypto
 * Docs: https://finnhub.io/docs/api
 */

const API_KEY = import.meta.env.VITE_FINNHUB_API_KEY as string | undefined;
const REST_BASE = 'https://finnhub.io/api/v1';

export function hasFinnhubKey(): boolean {
  return !!API_KEY && API_KEY !== 'your_finnhub_api_key_here';
}

// ─── REST helpers ──────────────────────────────────────────────────────────────

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!hasFinnhubKey()) throw new Error('No Finnhub API key configured');
  const url = new URL(`${REST_BASE}${path}`);
  url.searchParams.set('token', API_KEY!);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Finnhub ${res.status}: ${await res.text()}`);
  return res.json() as T;
}

// ─── Quote (stocks & ETFs) ────────────────────────────────────────────────────

export interface FinnhubQuote {
  c: number;   // current price
  d: number;   // change
  dp: number;  // change percent
  h: number;   // high
  l: number;   // low
  o: number;   // open
  pc: number;  // prev close
  t: number;   // timestamp
}

export async function fetchStockQuote(symbol: string): Promise<FinnhubQuote> {
  return get<FinnhubQuote>('/quote', { symbol });
}

// ─── Forex quote ──────────────────────────────────────────────────────────────

export interface FinnhubForexRate {
  base: string;
  quote: Record<string, number>;
}

// Forex from /forex/rates — returns all rates from a base currency
export async function fetchForexQuote(fromSymbol: string): Promise<number | null> {
  // fromSymbol = e.g. "EUR/USD" → base=EUR, we get USD rate
  const [from, to] = fromSymbol.split('/');
  if (!from || !to) return null;
  try {
    const data = await get<FinnhubForexRate>('/forex/rates', { base: from });
    return data.quote[to] ?? null;
  } catch {
    return null;
  }
}

// ─── Candle history (stocks, ETFs) ───────────────────────────────────────────

export interface FinnhubCandle {
  c: number[];  // closes
  h: number[];  // highs
  l: number[];  // lows
  o: number[];  // opens
  v: number[];  // volumes
  t: number[];  // timestamps (unix seconds)
  s: string;    // status: 'ok' | 'no_data'
}

export async function fetchCandles(symbol: string, days = 90): Promise<FinnhubCandle | null> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 86400;
  try {
    const data = await get<FinnhubCandle>('/stock/candle', {
      symbol,
      resolution: 'D',
      from: String(from),
      to: String(to),
    });
    if (data.s !== 'ok') return null;
    return data;
  } catch {
    return null;
  }
}

// ─── WebSocket streaming ──────────────────────────────────────────────────────

type TradeCallback = (symbol: string, price: number, volume: number, ts: number) => void;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const subscribers = new Map<string, Set<TradeCallback>>();
let isConnected = false;

function connect() {
  if (!hasFinnhubKey()) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  ws = new WebSocket(`wss://ws.finnhub.io?token=${API_KEY}`);

  ws.onopen = () => {
    isConnected = true;
    // Re-subscribe to all active symbols
    for (const symbol of subscribers.keys()) {
      ws!.send(JSON.stringify({ type: 'subscribe', symbol }));
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string) as {
        type: string;
        data?: { s: string; p: number; v: number; t: number }[];
      };
      if (msg.type === 'trade' && msg.data) {
        for (const trade of msg.data) {
          const cbs = subscribers.get(trade.s);
          if (cbs) cbs.forEach((cb) => cb(trade.s, trade.p, trade.v, trade.t));
        }
      }
    } catch {
      // ignore parse errors
    }
  };

  ws.onclose = () => {
    isConnected = false;
    // Reconnect after 3 seconds
    reconnectTimer = setTimeout(connect, 3000);
  };

  ws.onerror = () => {
    ws?.close();
  };
}

export function subscribeToTrades(symbol: string, cb: TradeCallback): () => void {
  if (!hasFinnhubKey()) return () => {};

  if (!subscribers.has(symbol)) {
    subscribers.set(symbol, new Set());
  }
  subscribers.get(symbol)!.add(cb);

  // Ensure connected
  connect();

  // Subscribe if already open
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'subscribe', symbol }));
  }

  return () => {
    const cbs = subscribers.get(symbol);
    if (cbs) {
      cbs.delete(cb);
      if (cbs.size === 0) {
        subscribers.delete(symbol);
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'unsubscribe', symbol }));
        }
      }
    }
  };
}

export function disconnectFinnhub() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ws?.close();
  ws = null;
  isConnected = false;
  subscribers.clear();
}

export { isConnected as finnhubConnected };
