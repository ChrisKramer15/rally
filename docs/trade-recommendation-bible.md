# Trade Recommendation Bible

> A living document of principles. This defines *what* we look at and *how* we
> reason about trade recommendations. It is intentionally implementation-free —
> Kiro will translate these principles into code later. Edit freely; anything
> marked `TODO` is a prompt for you to fill in.
>
> **Status:** DRAFT — not yet ready to implement
> **Last updated:** 2026-08-31

---

## 0. Purpose & Scope

What this document is for and what it deliberately does *not* cover.

- **Goal of recommendations:** TODO — one or two sentences. (e.g. "Surface end-of-day swing-trade setups from the watchlist.")
- **Trading style:** Daily / swing (end-of-day bars only — no intraday). TODO confirm.
- **Time horizon of a typical trade:** TODO (e.g. days to a few weeks).
- **Out of scope:** TODO (e.g. intraday, options, crypto, leverage, day-trading).
- **Disclaimer stance:** Not financial advice. TODO — any additional language you want surfaced in the UI.

---

## 1. Philosophy & Guiding Principles

The high-level beliefs that everything else should be consistent with.

- TODO — e.g. "Trade with the trend, not against it."
- TODO — e.g. "No signal without volume confirmation."
- TODO — e.g. "Avoid recommendations during earnings weeks."
- TODO — e.g. "Prefer fewer, higher-conviction signals over many weak ones."

---

## 2. Universe — What We Look At

Which instruments are eligible for a recommendation.

- **Eligible instruments:** US stocks & ETFs (matches current pipeline). TODO confirm.
- **Source universe:** The active watchlist (currently up to 40 symbols). TODO — should recommendations also consider index proxies (SPY/QQQ/DIA)?
- **Exclusions / filters:** TODO (e.g. price floor, minimum average volume, exclude leveraged/inverse ETFs).
- **Minimum data requirement:** TODO — how much history must exist before a symbol is eligible (e.g. "at least 200 trading days").

---

## 3. Inputs & Indicators

The raw and derived data a recommendation may consider. For each indicator,
note the parameters and *why* it matters.

### 3.1 Available raw data (already collected)
- Adjusted daily OHLCV: `open`, `high`, `low`, `close`, `volume` per `(symbol, date)`.
- History depth: currently ~260 bars surfaced to the app (collector backfills ~400 calendar days). TODO — note the longest lookback any rule below needs, so we know if we must widen history.

### 3.2 Indicators to compute
| Indicator | Parameters | Why it matters / how it's used |
|-----------|------------|--------------------------------|
| Simple moving average (SMA) | TODO (e.g. 20, 50, 200) | TODO |
| Exponential moving average (EMA) | TODO | TODO |
| RSI | TODO (e.g. 14) | TODO |
| MACD | TODO (e.g. 12/26/9) | TODO |
| Volume average / relative volume | TODO | TODO |
| Volatility (e.g. ATR, stdev) | TODO | TODO |
| 52-week / N-day high-low | TODO | TODO |
| _add rows as needed_ | | |

---

## 4. Signal Rules — What Recommendations Should Consider

The actual logic. State each rule so it could be evaluated mechanically on a
symbol's bars. Be explicit about thresholds.

### 4.1 Bullish / Buy conditions
- TODO — e.g. "20-day SMA crosses above 50-day SMA (golden cross)."
- TODO — e.g. "RSI(14) rising from below 40 but not yet above 70."
- TODO — e.g. "Close breaks above prior 20-day high on above-average volume."

### 4.2 Bearish / Sell / Avoid conditions
- TODO — e.g. "20-day SMA crosses below 50-day SMA (death cross)."
- TODO — e.g. "RSI(14) above 70 and turning down."

### 4.3 Neutral / No-trade conditions
- TODO — when we explicitly recommend doing nothing (e.g. choppy/low-volume, insufficient history, conflicting signals).

### 4.4 Conflict resolution
- TODO — how to reconcile when bullish and bearish rules both fire (e.g. priority order, or downgrade to neutral).

---

## 5. Scoring & Conviction

How individual rule outputs combine into a single recommendation.

- **Scoring approach:** TODO — e.g. weighted sum of rule hits, or a simple points system, or tiered gates.
- **Conviction levels:** TODO — e.g. Strong Buy / Buy / Hold / Sell / Strong Sell, and the score cutoffs for each.
- **Weights:** TODO — relative importance of each signal from section 4.
- **Ranking:** TODO — if presenting a "top N" list, how symbols are ordered (by score, by conviction, by expected move).

---

## 6. Risk & Position Management

Even if the app only *suggests*, state the risk framing behind a recommendation.

- **Entry reference:** TODO (e.g. next-day open, or last close).
- **Stop-loss logic:** TODO (e.g. below recent swing low, or N x ATR).
- **Target / take-profit logic:** TODO.
- **Position sizing:** TODO (e.g. fixed fraction, risk-based). Or explicitly out of scope.
- **Max concurrent recommendations:** TODO.

---

## 7. Timing & Freshness

When recommendations are generated and how long they're valid.

- **Generation cadence:** TODO — e.g. once daily after the close, alongside the collector run.
- **Validity window:** TODO — e.g. valid until the next daily bar.
- **Stale handling:** TODO — what happens if data is missing or stale for a symbol.
- **Market calendar caveat:** the current freshness logic does not account for holidays/half-days. TODO — note if that matters for timing.

---

## 8. Output & Presentation

What a recommendation looks like to the user.

- **Recommendation object (conceptual fields):** TODO — e.g. symbol, signal, conviction, score, rationale, key levels, generated-at.
- **Rationale requirement:** TODO — should every recommendation carry a human-readable "why"? (Recommended: yes.)
- **Where it appears in the UI:** TODO — e.g. a new column on the watchlist, a dedicated "Signals" view, or the dashboard.
- **Persistence:** TODO — is a history of past recommendations kept (for review/backtesting), or is it recomputed live each load?

---

## 9. Evaluation & Backtesting (optional / future)

How we'd know if the recommendations are any good.

- **Success metric:** TODO — e.g. hit rate, average return N days out.
- **Backtest data needs:** TODO — how much history, which fields.
- **Review cadence:** TODO.

---

## 10. Open Questions & Decisions Log

Running list of things still undecided. Move items out as they're settled.

- TODO — open question 1
- TODO — open question 2

### Decisions made
- 2026-08-31 — Format: recommendations use daily bars only (swing model). _(confirm/adjust)_
