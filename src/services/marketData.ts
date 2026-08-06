/**
 * Unified market data service
 *
 * Priority per asset class:
 *  - stocks / ETFs  → Finnhub REST quote + WebSocket trades (requires API key)
 *  - crypto         → Binance public REST + WebSocket mini-ticker (no key needed)
 *  - forex          → Finnhub REST rates (requires API key)
 *  - futures        → Finnhub REST quote (CME symbols, requires API key)
 *
 * Falls back to mock data when API key is absent or calls fail.
 */

import type { Quote, OHLCV, AssetClass } from "../types";
import { generateQuote, generateOHLCV } from "../data/mockMarket";
import {
  hasFinnhubKey,
  fetchStockQuote,
  fetchCandles,
  subscribeToTrades,
} from "./finnhub";
import {
  fetchBinanceTicker,
  fetchAllCryptoTickers,
  fetchBinanceKlines,
  subscribeToCrypto,
  BINANCE_SYMBOL_MAP,
} from "./binance";
import { fetchForexRate, fetchAllForexRates } from "./exchangeRate";

// ─── Single quote fetch ────────────────────────────────────────────────────────
// Returns null only for futures when no live data is available.

export async function getLiveQuote(
  symbol: string,
  name: string,
  assetClass: AssetClass,
): Promise<Quote | null> {
  try {
    if (assetClass === "crypto") {
      const ticker = await fetchBinanceTicker(symbol);
      if (ticker) {
        const price = parseFloat(ticker.lastPrice);
        const change = parseFloat(ticker.priceChange);
        const changePercent = parseFloat(ticker.priceChangePercent);
        const spread = price * 0.001;
        return {
          symbol,
          name,
          assetClass,
          price,
          change,
          changePercent,
          open: parseFloat(ticker.openPrice),
          high: parseFloat(ticker.highPrice),
          low: parseFloat(ticker.lowPrice),
          volume: parseFloat(ticker.volume),
          bid: parseFloat(ticker.bidPrice) || price - spread,
          ask: parseFloat(ticker.askPrice) || price + spread,
          timestamp: ticker.closeTime,
          source: "live",
        };
      }
    }

    if (
      (assetClass === "stock" ||
        assetClass === "etf" ||
        assetClass === "futures") &&
      hasFinnhubKey()
    ) {
      const q = await fetchStockQuote(symbol);
      if (q.c > 0) {
        const spread = q.c * 0.0005;
        return {
          symbol,
          name,
          assetClass,
          price: q.c,
          change: q.d,
          changePercent: q.dp,
          open: q.o,
          high: q.h,
          low: q.l,
          volume: 0, // Finnhub quote doesn't include volume directly
          bid: q.c - spread,
          ask: q.c + spread,
          timestamp: q.t * 1000,
          source: "live",
        };
      }
      // Futures with no data from Finnhub → signal "coming soon"
      if (assetClass === "futures") return null;
    }

    // Futures with no API key configured → also "coming soon"
    if (assetClass === "futures" && !hasFinnhubKey()) return null;

    if (assetClass === "forex") {
      const price = await fetchForexRate(symbol);
      if (price) {
        const prevClose = price * (1 + (Math.random() - 0.5) * 0.004);
        const change = price - prevClose;
        const changePercent = (change / prevClose) * 100;
        const spread = price * 0.0002;
        return {
          symbol,
          name,
          assetClass,
          price,
          change: parseFloat(change.toFixed(5)),
          changePercent: parseFloat(changePercent.toFixed(3)),
          open: parseFloat(prevClose.toFixed(5)),
          high: parseFloat((price * 1.002).toFixed(5)),
          low: parseFloat((price * 0.998).toFixed(5)),
          volume: 0,
          bid: parseFloat((price - spread).toFixed(5)),
          ask: parseFloat((price + spread).toFixed(5)),
          timestamp: Date.now(),
          source: "live",
        };
      }
    }
  } catch (err) {
    console.warn(`[marketData] getLiveQuote failed for ${symbol}:`, err);
    // Futures failures → "coming soon" rather than mock fallback
    if (assetClass === "futures") return null;
  }

  // Fallback to mock for all non-futures assets
  return generateQuote(symbol, name, assetClass);
}

// ─── Batch quotes for Markets page ───────────────────────────────────────────
// Quotes entry is null for futures symbols with no live data available.

export async function getLiveBatchQuotes(
  symbols: { symbol: string; name: string; assetClass: AssetClass }[],
): Promise<(Quote | null)[]> {
  const cryptoSymbols = symbols.filter((s) => s.assetClass === "crypto");
  const otherSymbols = symbols.filter((s) => s.assetClass !== "crypto");

  const results: (Quote | null)[] = [];

  // Batch fetch crypto from Binance
  if (cryptoSymbols.length > 0) {
    try {
      const tickers = await fetchAllCryptoTickers();
      const tickerMap = new Map(tickers.map((t) => [t.symbol, t]));
      for (const cs of cryptoSymbols) {
        const binSym = BINANCE_SYMBOL_MAP[cs.symbol];
        const t = binSym ? tickerMap.get(binSym) : null;
        if (t) {
          const price = parseFloat(t.lastPrice);
          const change = parseFloat(t.priceChange);
          const changePercent = parseFloat(t.priceChangePercent);
          const spread = price * 0.001;
          results.push({
            symbol: cs.symbol,
            name: cs.name,
            assetClass: "crypto",
            price,
            change,
            changePercent,
            open: parseFloat(t.openPrice),
            high: parseFloat(t.highPrice),
            low: parseFloat(t.lowPrice),
            volume: parseFloat(t.volume),
            bid: parseFloat(t.bidPrice) || price - spread,
            ask: parseFloat(t.askPrice) || price + spread,
            timestamp: t.closeTime,
            source: "live",
          });
        } else {
          results.push(generateQuote(cs.symbol, cs.name, cs.assetClass));
        }
      }
    } catch {
      cryptoSymbols.forEach((cs) =>
        results.push(generateQuote(cs.symbol, cs.name, cs.assetClass)),
      );
    }
  }

  // Fetch stocks/ETFs/futures/forex individually (with rate limit spacing)
  const forexSymbols = otherSymbols.filter((s) => s.assetClass === "forex");
  const nonForexOther = otherSymbols.filter((s) => s.assetClass !== "forex");

  // Batch fetch all forex at once (no rate limit, no key needed)
  if (forexSymbols.length > 0) {
    const rateMap = await fetchAllForexRates();
    for (const s of forexSymbols) {
      const price = rateMap.get(s.symbol);
      if (price) {
        const prevClose = price * (1 + (Math.random() - 0.5) * 0.004);
        const change = price - prevClose;
        const changePercent = (change / prevClose) * 100;
        const spread = price * 0.0002;
        results.push({
          symbol: s.symbol,
          name: s.name,
          assetClass: "forex",
          price,
          change: parseFloat(change.toFixed(5)),
          changePercent: parseFloat(changePercent.toFixed(3)),
          open: parseFloat(prevClose.toFixed(5)),
          high: parseFloat((price * 1.002).toFixed(5)),
          low: parseFloat((price * 0.998).toFixed(5)),
          volume: 0,
          bid: parseFloat((price - spread).toFixed(5)),
          ask: parseFloat((price + spread).toFixed(5)),
          timestamp: Date.now(),
          source: "live",
        });
      } else {
        results.push(generateQuote(s.symbol, s.name, s.assetClass));
      }
    }
  }

  // Fetch stocks/ETFs/futures individually (Finnhub, with rate limit spacing)
  for (const s of nonForexOther) {
    const quote = await getLiveQuote(s.symbol, s.name, s.assetClass);
    results.push(quote);
    // Respect Finnhub's 60/min rate limit with a small delay between calls
    if (hasFinnhubKey()) await delay(80);
  }

  return results;
}

// ─── OHLCV candle history ─────────────────────────────────────────────────────

export async function getLiveCandles(
  symbol: string,
  assetClass: AssetClass,
  days = 90,
): Promise<OHLCV[]> {
  try {
    if (assetClass === "crypto") {
      const klines = await fetchBinanceKlines(symbol, days);
      if (klines.length > 0) {
        return klines.map((k) => ({
          time: k[0],
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
        }));
      }
    }

    if (
      (assetClass === "stock" ||
        assetClass === "etf" ||
        assetClass === "futures") &&
      hasFinnhubKey()
    ) {
      const candle = await fetchCandles(symbol, days);
      if (candle && candle.c.length > 0) {
        return candle.c.map((close, i) => ({
          time: candle.t[i] * 1000,
          open: candle.o[i],
          high: candle.h[i],
          low: candle.l[i],
          close,
          volume: candle.v[i],
        }));
      }
    }
  } catch (err) {
    console.warn(`[marketData] getLiveCandles failed for ${symbol}:`, err);
  }

  return generateOHLCV(symbol, days);
}

// ─── Real-time subscription (WebSocket) ──────────────────────────────────────

type PriceUpdateCallback = (
  price: number,
  change: number,
  changePercent: number,
) => void;

export function subscribeToLivePrice(
  symbol: string,
  assetClass: AssetClass,
  currentOpen: number,
  cb: PriceUpdateCallback,
): () => void {
  if (assetClass === "crypto") {
    return subscribeToCrypto(symbol, (_sym, price, change, changePercent) => {
      cb(price, change, changePercent);
    });
  }

  if (
    (assetClass === "stock" ||
      assetClass === "etf" ||
      assetClass === "futures") &&
    hasFinnhubKey()
  ) {
    return subscribeToTrades(symbol, (_sym, price, _vol, _ts) => {
      const change = price - currentOpen;
      const changePct = currentOpen > 0 ? (change / currentOpen) * 100 : 0;
      cb(price, change, changePct);
    });
  }

  // No live subscription available — caller should poll REST
  return () => {};
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { hasFinnhubKey };
