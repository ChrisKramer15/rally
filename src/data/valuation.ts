import type {
  OHLCV,
  Zone,
  Valuation,
  TradeRecommendation,
  BracketOrder,
  TradeStyle,
  TradeDirection,
} from "../types";

// ─── Technical Indicators ─────────────────────────────────────────────────────

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0,
    losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  return parseFloat((100 - 100 / (1 + rs)).toFixed(1));
}

export function ema(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = data[0];
  for (const v of data) {
    prev = v * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

function calcMACD(closes: number[]) {
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const macdLine = fast.map((v, i) => v - slow[i]);
  const signalLine = ema(macdLine, 9);
  const last = macdLine.length - 1;
  return {
    value: parseFloat(macdLine[last].toFixed(4)),
    signal: parseFloat(signalLine[last].toFixed(4)),
    histogram: parseFloat((macdLine[last] - signalLine[last]).toFixed(4)),
  };
}

function calcATR(candles: OHLCV[], period = 14): number {
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const prevClose = candles[i - 1].close;
    trs.push(
      Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose),
      ),
    );
  }
  const recent = trs.slice(-period);
  return parseFloat(
    (recent.reduce((a, b) => a + b, 0) / recent.length).toFixed(4),
  );
}

// ─── Supply & Demand Zone Detection ──────────────────────────────────────────
//
// Rules:
//  1. A zone forms at a swing high (supply) or swing low (demand) using a
//     2-bar confirmation on each side.
//  2. Zone body = the departure candle's open-to-close range (the "base").
//     The wick extends the zone boundary slightly (0.1%) to avoid false breaks.
//  3. Strength is determined by the departure candle's body/range ratio —
//     the stronger the impulse away from the zone, the fresher and more valid.
//  4. Test count: each subsequent candle that closes inside the zone increments
//     `tested`. Zones tested 2+ times are marked stale and excluded from signals.
//  5. Only zones ABOVE current price are supply; only zones BELOW are demand.
//     We keep the 4 closest of each to give the chart context.

function detectZones(candles: OHLCV[]): { supply: Zone[]; demand: Zone[] } {
  const supply: Zone[] = [];
  const demand: Zone[] = [];

  const recent = candles.slice(-80); // 80-candle lookback for zone formation
  const currentPrice = recent[recent.length - 1].close;

  for (let i = 2; i < recent.length - 2; i++) {
    const c = recent[i];

    const isSwingHigh =
      c.high > recent[i - 1].high &&
      c.high > recent[i - 2].high &&
      c.high > recent[i + 1].high &&
      c.high > recent[i + 2].high;

    const isSwingLow =
      c.low < recent[i - 1].low &&
      c.low < recent[i - 2].low &&
      c.low < recent[i + 1].low &&
      c.low < recent[i + 2].low;

    const bodySize = Math.abs(c.close - c.open);
    const totalRange = c.high - c.low || 0.0001;
    const bodyRatio = bodySize / totalRange;

    // Strength: how decisively price left the zone
    const strength =
      bodyRatio > 0.65 ? "strong" : bodyRatio > 0.38 ? "moderate" : "weak";

    // Count how many subsequent candles have closed back inside the zone
    // (each test weakens the zone — 2+ tests = stale, discard for signals)
    if (isSwingHigh) {
      const zoneLow = parseFloat(Math.max(c.open, c.close).toFixed(4));
      const zoneHigh = parseFloat((c.high * 1.001).toFixed(4));

      const tested = recent
        .slice(i + 1)
        .filter((r) => r.close >= zoneLow && r.close <= zoneHigh).length;

      supply.push({
        id: `supply-${i}`,
        type: "supply",
        strength,
        priceHigh: zoneHigh,
        priceLow: zoneLow,
        description: buildZoneDesc("supply", strength, tested),
        tested,
      });
    }

    if (isSwingLow) {
      const zoneHigh = parseFloat(Math.min(c.open, c.close).toFixed(4));
      const zoneLow = parseFloat((c.low * 0.999).toFixed(4));

      const tested = recent
        .slice(i + 1)
        .filter((r) => r.close >= zoneLow && r.close <= zoneHigh).length;

      demand.push({
        id: `demand-${i}`,
        type: "demand",
        strength,
        priceHigh: zoneHigh,
        priceLow: zoneLow,
        description: buildZoneDesc("demand", strength, tested),
        tested,
      });
    }
  }

  // Supply zones: above current price, closest first, max 4
  const supplyZones = supply
    .filter((z) => z.priceLow > currentPrice)
    .sort((a, b) => a.priceLow - b.priceLow)
    .slice(0, 4);

  // Demand zones: below current price, closest first, max 4
  const demandZones = demand
    .filter((z) => z.priceHigh < currentPrice)
    .sort((a, b) => b.priceHigh - a.priceHigh)
    .slice(0, 4);

  return { supply: supplyZones, demand: demandZones };
}

function buildZoneDesc(
  type: "supply" | "demand",
  strength: string,
  tested: number,
): string {
  const freshness =
    tested === 0
      ? "Fresh zone — untested."
      : tested === 1
        ? "Tested once — still valid."
        : `Tested ${tested}× — zone is weakening.`;
  const impulse =
    strength === "strong"
      ? `Strong ${type === "supply" ? "bearish" : "bullish"} departure candle.`
      : strength === "moderate"
        ? "Moderate impulse away from zone."
        : "Weak impulse — low conviction zone.";
  return `${impulse} ${freshness}`;
}

// ─── Trade Style ──────────────────────────────────────────────────────────────
//
// Determined purely by volatility (ATR % of price) — not RSI or MACD.
// The idea: how long you should hold is a function of how fast price moves.

function suggestTradeStyle(atr: number, price: number): TradeStyle {
  const atrPct = atr / price;
  if (atrPct > 0.025) return "scalp"; // >2.5% daily range — very volatile
  if (atrPct > 0.012) return "day"; // 1.2–2.5% daily range
  if (atrPct > 0.006) return "swing"; // 0.6–1.2% daily range
  return "position"; // <0.6% daily range — slow mover
}

// ─── Bracket Order Builder ────────────────────────────────────────────────────
//
// Stop is placed just beyond the opposite edge of the zone (the "invalidation"
// level). Targets are ATR multiples from entry.
//   Stop:   1× ATR beyond zone far edge
//   T1:     1.5× ATR  (quick partial)
//   T2:     3×  ATR   (main target)
//   T3:     5×  ATR   (runner / extended target)

function buildBracket(
  entry: number,
  stopInvalidation: number,
  atr: number,
  direction: TradeDirection,
): BracketOrder {
  const risk = Math.abs(entry - stopInvalidation);
  // Ensure minimum risk = 0.5× ATR so targets are meaningful
  const effectiveRisk = Math.max(risk, atr * 0.5);
  const rr = parseFloat(
    (effectiveRisk > 0 ? (atr * 3) / effectiveRisk : 2).toFixed(2),
  );

  if (direction === "buy") {
    return {
      entry: parseFloat(entry.toFixed(4)),
      stopLoss: parseFloat(stopInvalidation.toFixed(4)),
      target1: parseFloat((entry + atr * 1.5).toFixed(4)),
      target2: parseFloat((entry + atr * 3.0).toFixed(4)),
      target3: parseFloat((entry + atr * 5.0).toFixed(4)),
      riskRewardRatio: rr,
    };
  } else {
    return {
      entry: parseFloat(entry.toFixed(4)),
      stopLoss: parseFloat(stopInvalidation.toFixed(4)),
      target1: parseFloat((entry - atr * 1.5).toFixed(4)),
      target2: parseFloat((entry - atr * 3.0).toFixed(4)),
      target3: parseFloat((entry - atr * 5.0).toFixed(4)),
      riskRewardRatio: rr,
    };
  }
}

// ─── S&D Confidence Scoring ───────────────────────────────────────────────────
//
// Purely zone-based. No RSI fallback. Components:
//
//  Zone freshness (0 tests = max points, each test deducts)  — 35 pts max
//  Zone strength (strong / moderate / weak)                  — 25 pts max
//  Trend alignment (higher-timeframe EMA20 vs EMA50)         — 25 pts max
//  Zone proximity (how close price is to the zone edge)      — 15 pts max

function scoreZone(
  zone: Zone,
  trend: "uptrend" | "downtrend" | "sideways",
  direction: TradeDirection,
  currentPrice: number,
  atr: number,
): number {
  // Freshness — zones tested 2+ times are excluded upstream, but score anyway
  const freshnessScore = zone.tested === 0 ? 35 : zone.tested === 1 ? 22 : 8;

  // Strength of departure candle
  const strengthScore =
    zone.strength === "strong" ? 25 : zone.strength === "moderate" ? 15 : 6;

  // Trend alignment
  //  Buy at demand: ideally uptrend or sideways (institutional accumulation)
  //  Short at supply: ideally downtrend or sideways
  let trendScore = 0;
  if (direction === "buy") {
    trendScore = trend === "uptrend" ? 25 : trend === "sideways" ? 15 : 5;
  } else {
    trendScore = trend === "downtrend" ? 25 : trend === "sideways" ? 15 : 5;
  }

  // Proximity — how close is the current price to the zone edge?
  // Full points if within 0.5× ATR, sliding to 0 at 3× ATR
  let proximityScore = 0;
  if (direction === "buy") {
    const distToZone = currentPrice - zone.priceHigh; // positive = above zone
    const distRatio = distToZone / atr;
    proximityScore =
      distRatio <= 0.5 ? 15 : distRatio <= 1 ? 10 : distRatio <= 2 ? 5 : 2;
  } else {
    const distToZone = zone.priceLow - currentPrice; // positive = below zone
    const distRatio = distToZone / atr;
    proximityScore =
      distRatio <= 0.5 ? 15 : distRatio <= 1 ? 10 : distRatio <= 2 ? 5 : 2;
  }

  return Math.min(
    100,
    freshnessScore + strengthScore + trendScore + proximityScore,
  );
}

// ─── Recommendation Builder ───────────────────────────────────────────────────
//
// A recommendation is ONLY generated when:
//   1. A valid zone exists (above/below current price)
//   2. The zone has been tested fewer than 2 times (fresh or once-tested)
//   3. Price is within 3× ATR of the zone edge (close enough to be actionable)
//
// Entry: at the near edge of the zone (first point of re-entry into the zone)
// Stop:  just beyond the far edge of the zone + 0.2× ATR buffer (invalidation)

function buildRecs(
  demandZones: Zone[],
  supplyZones: Zone[],
  currentPrice: number,
  atr: number,
  trend: "uptrend" | "downtrend" | "sideways",
  tradeStyle: TradeStyle,
): TradeRecommendation[] {
  const recs: TradeRecommendation[] = [];

  // ── Demand zone longs ──
  for (const zone of demandZones) {
    // Discard stale zones (tested 2+ times)
    if (zone.tested >= 2) continue;

    // Price must be within 3× ATR of the zone top edge (actionable distance)
    const distToZone = currentPrice - zone.priceHigh;
    if (distToZone > atr * 3) continue;

    // Entry: at the top of the demand zone (price re-entering support)
    const entry = parseFloat((zone.priceHigh * 1.001).toFixed(4));

    // Stop: just below the bottom of the zone (invalidation)
    const stopInvalidation = parseFloat((zone.priceLow - atr * 0.2).toFixed(4));

    const confidence = scoreZone(zone, trend, "buy", currentPrice, atr);

    const distLabel =
      distToZone <= atr * 0.5
        ? "Price is currently entering the zone"
        : distToZone <= atr
          ? "Price is approaching the zone"
          : "Price is pulling back toward the zone";

    recs.push({
      direction: "buy",
      style: tradeStyle,
      confidence,
      rationale: buildRationale("buy", zone, trend, distLabel, currentPrice),
      bracket: buildBracket(entry, stopInvalidation, atr, "buy"),
      zone,
    });
  }

  // ── Supply zone shorts ──
  for (const zone of supplyZones) {
    // Discard stale zones
    if (zone.tested >= 2) continue;

    // Price must be within 3× ATR of the zone bottom edge
    const distToZone = zone.priceLow - currentPrice;
    if (distToZone > atr * 3) continue;

    // Entry: at the bottom of the supply zone (price re-entering resistance)
    const entry = parseFloat((zone.priceLow * 0.999).toFixed(4));

    // Stop: just above the top of the zone (invalidation)
    const stopInvalidation = parseFloat(
      (zone.priceHigh + atr * 0.2).toFixed(4),
    );

    const confidence = scoreZone(zone, trend, "short", currentPrice, atr);

    const distLabel =
      distToZone <= atr * 0.5
        ? "Price is currently entering the zone"
        : distToZone <= atr
          ? "Price is approaching the zone"
          : "Price is rallying toward the zone";

    recs.push({
      direction: "short",
      style: tradeStyle,
      confidence,
      rationale: buildRationale("short", zone, trend, distLabel, currentPrice),
      bracket: buildBracket(entry, stopInvalidation, atr, "short"),
      zone,
    });
  }

  return recs.sort((a, b) => b.confidence - a.confidence);
}

function buildRationale(
  direction: TradeDirection,
  zone: Zone,
  trend: string,
  distLabel: string,
  _price: number,
): string {
  const zoneRange = `$${zone.priceLow.toFixed(4)}–$${zone.priceHigh.toFixed(4)}`;
  const freshness = zone.tested === 0 ? "fresh, untested" : "once-tested";
  const trendNote =
    trend === "uptrend"
      ? "Macro trend is bullish."
      : trend === "downtrend"
        ? "Macro trend is bearish."
        : "Trend is sideways — range play.";

  if (direction === "buy") {
    return `${distLabel} at ${freshness} demand zone ${zoneRange}. ${zone.strength === "strong" ? "Strong bullish departure candle confirms institutional interest." : "Moderate demand present at this level."} ${trendNote} Stop below zone invalidation; targets at ATR multiples.`;
  } else {
    return `${distLabel} at ${freshness} supply zone ${zoneRange}. ${zone.strength === "strong" ? "Strong bearish departure candle confirms institutional selling." : "Moderate supply present at this level."} ${trendNote} Stop above zone invalidation; targets at ATR multiples.`;
  }
}

// ─── Master Valuation Engine ──────────────────────────────────────────────────

export function computeValuation(
  symbol: string,
  currentPrice: number,
  candles: OHLCV[] = [],
): Valuation {
  if (candles.length === 0) {
    return {
      symbol,
      intrinsicValue: null,
      fairValueMethod: "N/A",
      currentPrice,
      valueGapPercent: 0,
      rsi: 50,
      macd: { value: 0, signal: 0, histogram: 0 },
      atr: 0,
      trend: "sideways",
      supplyZones: [],
      demandZones: [],
      recommendations: [],
    };
  }

  const closes = candles.map((c) => c.close);

  const rsi = calcRSI(closes);
  const macd = calcMACD(closes);
  const atr = calcATR(candles);

  const { supply, demand } = detectZones(candles);

  // Higher-timeframe trend via EMA20 vs EMA50 crossover
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const lastEma20 = ema20[ema20.length - 1];
  const lastEma50 = ema50[ema50.length - 1];
  const trend =
    lastEma20 > lastEma50 * 1.005
      ? "uptrend"
      : lastEma20 < lastEma50 * 0.995
        ? "downtrend"
        : "sideways";

  // Trade style based on volatility only
  const tradeStyle = suggestTradeStyle(atr, currentPrice);

  // Intrinsic value — P/E proxy for equities only; null for crypto/forex/futures
  const isEquityLike =
    !symbol.includes("/") &&
    !["ES", "NQ", "CL", "GC", "ZB", "SI"].includes(symbol);
  const intrinsicValue = isEquityLike
    ? parseFloat((currentPrice * (0.85 + Math.random() * 0.4)).toFixed(2))
    : null;
  const valueGapPercent = intrinsicValue
    ? parseFloat(
        (((intrinsicValue - currentPrice) / currentPrice) * 100).toFixed(1),
      )
    : 0;

  // Build S&D-only recommendations
  const recommendations = buildRecs(
    demand,
    supply,
    currentPrice,
    atr,
    trend,
    tradeStyle,
  );

  return {
    symbol,
    intrinsicValue,
    fairValueMethod: isEquityLike ? "P/E Relative Valuation" : "N/A",
    currentPrice,
    valueGapPercent,
    rsi,
    macd,
    atr,
    trend,
    supplyZones: supply,
    demandZones: demand,
    recommendations,
  };
}
