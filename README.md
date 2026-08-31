# Rally — Market Dashboard

A React + TypeScript + Vite dashboard that tracks a user-defined watchlist with
live quotes and trend sparklines.

## Market data

- **Provider:** [Finnhub](https://finnhub.io) (`/quote`), polled every 60 seconds.
  The free tier allows 60 requests/minute, which covers the 45-symbol watchlist cap.
- **API key:** set `VITE_FINNHUB_KEY` in a local `.env` (see `.env.example`).
  Without a key, the app runs on a simulated feed and shows a "DEMO / simulated" pill.
- **Watchlist:** curated by pasting tickers (e.g. from a scanner such as Scanz) via
  the "Paste tickers" button. Symbols persist to `localStorage` (`rally.watchlist`),
  capped at 45.
- **Trend history:** sparklines show **real polled points only** — no synthetic
  seeding. History accumulates one point per poll and is persisted so it survives
  reloads (see below).

## Trend history persistence (and the database migration)

Price history is stored behind a small swappable interface in
`src/data/historyStore.ts`:

```ts
interface HistoryStore {
  load(symbols: string[]): Promise<SymbolHistory>
  save(history: SymbolHistory): Promise<void>
}
```

The current implementation, `LocalHistoryStore`, is backed by `localStorage`
(key `rally.history`, 40-point rolling window per symbol). The interface is
async so a database-backed implementation can replace it without touching the
consuming hook (`useWatchlistMarket`) or any component.

**Why a database is the planned next step (before the trade-recommendation sprint):**

- `localStorage` is per-browser and per-device — history isn't shared across
  users or devices, which a recommendation engine needs.
- History only accumulates while the app is open, leaving gaps (overnight,
  pre-market) — exactly the data a gap/RVOL strategy depends on.
- It's small (~5 MB) and user-clearable — unsuitable for backtesting a large
  universe over time.
- Indicators like RVOL and gap % need server-side historical averages, not
  browser-side partial data.

**Migration outline (later task, no backend built yet):**

1. Stand up a backend job that polls Finnhub (or a bulk provider) on a schedule
   and writes to a `prices(symbol, ts, price, volume)` table (Postgres or a
   time-series DB such as TimescaleDB/InfluxDB). A server-side collector also
   sidesteps client rate limits and the free-tier "personal use only" terms.
2. Add `class ApiHistoryStore implements HistoryStore` that fetches from that
   backend.
3. Swap the exported `historyStore` singleton in `src/data/historyStore.ts` to
   the new implementation. The dashboard and recommendation engine then read
   shared, gap-free history.

> Note: Scanz has no public API — it's an end-user scanner platform. Scanner
> output is brought in manually via "Paste tickers". A fully automated scan
> would require a programmable source (e.g. Polygon's full-market snapshot) in a
> later sprint.

---

## Template notes (React + TypeScript + Vite)

This project was bootstrapped from Vite's React + TypeScript template, which
provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
