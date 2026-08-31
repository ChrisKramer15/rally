-- Allow the browser to sync pasted tickers into the watchlist.
--
-- The frontend uses the anon key. To let "Paste tickers" add symbols the daily
-- collector will then track, we grant anon/authenticated INSERT on the
-- `watchlist` table ONLY. Everything else stays locked down:
--   * prices  -> still read-only for anon (no write policy exists).
--   * watchlist UPDATE/DELETE -> still denied (no policies for those actions).
--
-- Scope/security note: this makes `watchlist` a public INSERT surface for anyone
-- holding the (public) anon key. For a personal single-user dashboard that's an
-- acceptable, tightly-scoped risk — new rows are just ticker symbols; they can't
-- read or alter price history, and can't remove entries. If this ever becomes
-- multi-user, replace this with an authenticated-only policy tied to auth.uid().

drop policy if exists watchlist_client_insert on public.watchlist;
create policy watchlist_client_insert
  on public.watchlist
  for insert
  to anon, authenticated
  with check (
    -- Basic sanity guard: only plausible US stock/ETF tickers (letters, digits,
    -- dot, dash), 1–10 chars. Keeps junk out of the collector's universe.
    symbol ~ '^[A-Z0-9.\-]{1,10}$'
  );
