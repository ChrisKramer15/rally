# Rally — Market Dashboard

A React + TypeScript + Vite dashboard that tracks a user-defined watchlist with
live quotes and trend sparklines.

## Market data

Rally is a **daily** (swing-trading) dashboard scoped to **US stocks & ETFs**.
Crypto/forex (24/7 tickers) are intentionally out of scope — they need different
freshness logic.

- **Provider:** [Tiingo](https://www.tiingo.com) End-of-Day (EOD) daily bars,
  collected **server-side** and stored in Supabase. The browser reads bars from
  Supabase (CORS-safe); it never calls Tiingo directly (Tiingo isn't
  CORS-enabled, which is what forced the server-side collector). Tiingo free
  tier: ~50 req/hour, 1,000/day, **500 unique symbols/month** — now consumed by
  the collector, not the browser.
- **Config:** set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in a local
  `.env` (see `.env.example`). Without them, the app runs on a simulated feed and
  shows a "DEMO / simulated" pill. The Tiingo token is a Supabase *secret* used
  only by the collector — it is never shipped to the browser.
- **Watchlist (Tier 1):** curated by pasting tickers (e.g. from a scanner such as
  Scanz) via the "Paste tickers" button. Symbols persist to `localStorage`
  (`rally.watchlist`), capped at 40. This is the primary list, fetched first.
- **Trend history:** sparklines plot **real adjusted daily closes** from Tiingo.
  Adjusted values keep splits/dividends from creating artificial jumps.

### Trading-day freshness cache (Tier 2)

Daily bars don't change intraday, so the app caches them and only fetches
**stale** symbols. Freshness is tied to the US regular-session close:

- A session's bar is treated as **final one minute after the close (4:01 PM ET)**.
- Before that cutoff (and on weekends), the last confirmed session's bar is reused.
- After the cutoff, cached symbols go stale and the next visit pulls the new bar
  exactly once.

Implementation:

- `src/data/marketCalendar.ts` — `effectiveTradingDay()` / `isFresh()`,
  timezone-aware (America/New_York), dependency-free. Models the regular Mon–Fri
  session and the post-close cutoff; it does **not** track market holidays
  (a missing provider bar on a holiday is simply a no-op for the cache).
- `src/data/tiingo.ts` — the EOD client (`fetchDailyBars`, `fetchName`).
- `src/data/dailyCache.ts` — the localStorage cache (`rally.dailyCache.v1`),
  freshness partition, and a **monthly usage meter** (`rally.usage.v1`) that
  tracks unique symbols against the 500/month cap and is surfaced in the header.

Net effect: refreshing the page or revisiting later in the day costs **~0
requests** — a 40-symbol watchlist pulls once per trading day and re-renders
from cache after that.

## Backend: Supabase (daily collector + shared storage)

The browser can't call Tiingo directly (no CORS), so a small Supabase backend
does three things: **stores** daily bars, **collects** them on a daily schedule
server-side, and **serves** them to the browser with CORS + read-only RLS.

```
pg_cron (daily, after close)
   -> invoke_daily_collector()  (pg_net -> Edge Function)
      -> collect-daily-bars  (reads watchlist, pulls Tiingo, upserts prices)
                                        |
browser  --(anon key, read-only)-->  prices table  (RLS: public select only)
```

Files:

- `supabase/migrations/0001_prices_schema.sql` — `prices` + `watchlist` tables,
  indexes, and RLS (public read; writes only via the service role).
- `supabase/functions/collect-daily-bars/index.ts` — the collector (Deno Edge
  Function). Pulls adjusted Tiingo bars for the active watchlist and upserts.
- `supabase/migrations/0002_daily_cron.sql` — `pg_cron` job (Mon–Fri 21:10 UTC,
  safely after the US close in both DST states) that invokes the function via
  `pg_net`, reading the function URL + service-role key from Supabase Vault.
- `src/data/supabaseClient.ts` / `src/data/supabaseDailyStore.ts` — the
  browser read path (anon key). `src/data/tiingo.ts` now only holds the shared
  `DailyBar` type; the Tiingo *fetch* lives server-side in the Edge Function.

### One-time setup

```bash
# 1) Link the CLI to your project (get the ref from the dashboard URL)
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# 2) Apply the schema + cron migrations
supabase db push

# 3) Store the Tiingo token as a secret (server-side only, never in the client)
supabase secrets set TIINGO_KEY=your_tiingo_token

# 4) Deploy the collector
supabase functions deploy collect-daily-bars

# 5) In the SQL editor, populate Vault so cron can call the function
#    (see the commented block in 0002_daily_cron.sql):
#    select vault.create_secret('https://YOUR_REF.supabase.co/functions/v1/collect-daily-bars','collect_daily_bars_url');
#    select vault.create_secret('YOUR_SERVICE_ROLE_KEY','service_role_key');

# 6) Seed the watchlist, then run the collector once to backfill:
#    insert into watchlist (symbol) values ('AAPL'),('NVDA'),... ;
supabase functions invoke collect-daily-bars
```

Then set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env` (Project
Settings → API) and run the app — the header shows **LIVE** once bars are read.

### Watchlist sync

Pasting tickers in the app also **syncs them up to the Supabase `watchlist`
table** (`syncWatchlist` in `supabaseDailyStore.ts`, called from
`useWatchlist.save`). The daily collector reads that table, so anything you add
is tracked automatically on the next run — no manual seeding.

This needs a client write, so `migrations/0003_watchlist_client_insert.sql`
grants anon/authenticated **INSERT on `watchlist` only** (with a ticker-format
check). Everything else stays locked: `prices` is read-only for anon, and
`watchlist` UPDATE/DELETE are denied. Newly added symbols are picked up by the
next nightly cron run (the browser does not trigger the collector directly, to
avoid a public invoke surface / Tiingo-budget abuse). If this ever goes
multi-user, swap that policy for an authenticated-only one tied to `auth.uid()`.

> Note: `pg_cron`'s minimum granularity is 1 minute (irrelevant for a daily
> job). Free projects pause after ~a week idle, but the daily cron counts as
> activity and keeps it awake.

> Note: `src/data/historyStore.ts` (the older `localStorage` `HistoryStore`) is
> retained only for its shared `HISTORY_LEN` constant; the daily pipeline uses
> `dailyCache.ts` (bars carry OHLCV + a per-symbol `lastFetchedTradingDay`).

> Note: Scanz has no public API — scanner output is brought in manually via
> "Paste tickers". A fully automated scan would need a programmable source later.

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
