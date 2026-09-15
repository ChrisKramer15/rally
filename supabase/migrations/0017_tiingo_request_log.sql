-- ---------------------------------------------------------------------------
-- 0017_tiingo_request_log.sql
--
-- Records ONE row per outbound Tiingo request the collector makes, so the
-- collector can enforce a HARD rolling-hour rate limit that mathematically
-- cannot be exceeded — regardless of partial primary failures, freshness-probe
-- failures, or two runs landing in the same rolling hour.
--
-- Why a table (not in-memory): Edge Functions are stateless and each invocation
-- is isolated, so there is no process memory shared across a primary run and a
-- later catch-up run. A tiny shared table is the only way for the collector to
-- know "how many Tiingo requests have I made in the last 60 minutes" across
-- separate invocations.
--
-- Access model (mirrors prices / pipeline_runs):
--   * The Edge Function (service_role) BYPASSES RLS and WRITES rows.
--   * The browser (anon) gets NO access — this is purely an internal governor.
--
-- Retention: only the last ~60 minutes matters for the rolling window. The
-- collector best-effort prunes old rows on each run; a periodic cleanup is
-- unnecessary for the free-tier volumes involved (≤ a few hundred rows/hour).
-- ---------------------------------------------------------------------------

create table if not exists public.tiingo_request_log (
  id            bigint generated always as identity primary key,
  -- When the request was made. The rolling-hour count is
  --   count(*) where requested_at >= now() - interval '60 minutes'.
  requested_at  timestamptz not null default now(),
  -- Which run mode issued it ('primary' | 'catchup' | 'manual'); useful for
  -- auditing how budget was spent, not required for the count.
  mode          text        not null default 'unknown',
  -- The symbol fetched (nullable; audit only).
  symbol        text
);

comment on table public.tiingo_request_log is
  'One row per outbound Tiingo request. Written only by the collector (service role); used to enforce a hard rolling-hour rate limit. Anon has no access.';

-- The rolling-window count filters by requested_at, so index it descending.
create index if not exists tiingo_request_log_requested_desc_idx
  on public.tiingo_request_log (requested_at desc);

alter table public.tiingo_request_log enable row level security;

-- NOTE: deliberately NO policies for anon/authenticated. Only the Edge Function
-- (service_role, which bypasses RLS) reads and writes this table.
