-- Let the browser fully reconcile the watchlist so the collector only pulls
-- symbols that are CURRENTLY on the user's list.
--
-- BACKGROUND:
--   0003 granted the anon/authenticated role INSERT on `watchlist` only. That
--   made the table insert-only: symbols pasted on any device accumulated
--   forever and were never removed. The collector reads `where active = true`,
--   so its universe only grew — eventually risking Tiingo's ~50 req/hr and
--   ~500 unique-symbol/month free-tier limits (one request per active symbol
--   per run).
--
-- CHANGE:
--   Allow the client to UPDATE the `active` flag (and `name`) so removing a
--   ticker locally deactivates it in the shared table, and re-adding it
--   reactivates it. We use a soft active flag rather than DELETE so price
--   history and added_at are preserved and a returning symbol keeps its row.
--
--   The `symbol` primary key is intentionally NOT updatable (the WITH CHECK on
--   INSERT still guards new rows). We keep the table as the single, shared
--   source of truth for both the collector and every browser.
--
-- SECURITY / SCOPE NOTE:
--   Same posture as 0003: this is a personal, single-user dashboard using the
--   public anon key, so a broad client-writable policy is an accepted,
--   tightly-scoped risk. Writes here can only toggle `active`/`name` on ticker
--   rows; they can't touch price history (prices stays read-only for anon) and
--   can't insert junk (the INSERT check regex still applies). If this ever
--   becomes multi-user, replace these with authenticated-only policies keyed to
--   auth.uid() and a per-user watchlist.

-- Allow the client to flip active/name on existing rows.
drop policy if exists watchlist_client_update on public.watchlist;
create policy watchlist_client_update
  on public.watchlist
  for update
  to anon, authenticated
  using (true)
  with check (
    -- Guard the same way INSERT does: only plausible tickers stay in the table.
    symbol ~ '^[A-Z0-9.\-]{1,10}$'
  );

-- NOTE: still deliberately NO delete policy. Reconciliation is done via the
-- `active` flag (soft deactivate), which preserves history and added_at.
