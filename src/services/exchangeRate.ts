/**
 * ExchangeRate-API — free, no API key required
 * https://open.er-api.com
 * Updates ~every 24h, covers all major forex pairs
 */

const BASE_URL = 'https://open.er-api.com/v6/latest';

// Cache rates per base currency for the session to avoid redundant fetches
const cache = new Map<string, { rates: Record<string, number>; fetchedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getRates(baseCurrency: string): Promise<Record<string, number> | null> {
  const cached = cache.get(baseCurrency);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rates;
  }
  try {
    const res = await fetch(`${BASE_URL}/${baseCurrency}`);
    if (!res.ok) return null;
    const data = await res.json() as { result: string; rates: Record<string, number> };
    if (data.result !== 'success') return null;
    cache.set(baseCurrency, { rates: data.rates, fetchedAt: Date.now() });
    return data.rates;
  } catch {
    return null;
  }
}

/**
 * Get the exchange rate for a forex pair like "EUR/USD", "GBP/USD", "USD/JPY".
 * Returns null if the fetch fails.
 */
export async function fetchForexRate(displaySymbol: string): Promise<number | null> {
  const [from, to] = displaySymbol.split('/');
  if (!from || !to) return null;
  const rates = await getRates(from);
  return rates?.[to] ?? null;
}

/**
 * Fetch all supported forex pairs at once.
 * Returns a map of displaySymbol → rate.
 */
export const FOREX_SYMBOLS = [
  { symbol: 'EUR/USD', base: 'EUR', quote: 'USD' },
  { symbol: 'GBP/USD', base: 'GBP', quote: 'USD' },
  { symbol: 'USD/JPY', base: 'USD', quote: 'JPY' },
  { symbol: 'AUD/USD', base: 'AUD', quote: 'USD' },
  { symbol: 'USD/CAD', base: 'USD', quote: 'CAD' },
  { symbol: 'USD/CHF', base: 'USD', quote: 'CHF' },
];

export async function fetchAllForexRates(): Promise<Map<string, number>> {
  const result = new Map<string, number>();

  // Collect unique base currencies to minimize API calls
  const bases = [...new Set(FOREX_SYMBOLS.map((s) => s.base))];

  await Promise.all(
    bases.map(async (base) => {
      const rates = await getRates(base);
      if (!rates) return;
      FOREX_SYMBOLS
        .filter((s) => s.base === base)
        .forEach((s) => {
          const rate = rates[s.quote];
          if (rate != null) result.set(s.symbol, rate);
        });
    })
  );

  return result;
}
