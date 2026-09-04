-- ---------------------------------------------------------------------------
-- 0008_multi_watchlist.sql
--
-- Introduces up to 10 NAMED watchlists.
--
-- Design decisions (confirmed with the product owner):
--   * A symbol belongs to EXACTLY ONE watchlist. That keeps `watchlist.symbol`
--     a globally-unique primary key: we simply add a `watchlist_id` column
--     rather than moving to a composite (watchlist_id, symbol) key. The client
--     reconcile logic stays simple because one symbol == one row == one list.
--   * `prices` is intentionally left UNTOUCHED (still keyed by (symbol, date)).
--     Downstream Signals / Backtest / Pipeline read `prices` by symbol, so the
--     UNION across all lists is free — no per-list bar duplication.
--   * `pipeline_runs` gains a watchlist attribution + a per-STAGE breakdown so
--     the Data Pipeline page can show which list ran and where it succeeded or
--     failed (resolve -> fetch -> upsert).
--   * The existing active watchlist is preserved as a default list named "Main"
--     (slot 1), which keeps the current 20:30 CT schedule.
--
-- Re-runnable: guarded with IF NOT EXISTS / idempotent backfills.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- watchlists: the parent list registry (max 10 enforced app-side + a trigger).
--   slot drives the collection schedule: list in slot N collects at
--   (20:30 CT + (N-1) hours). Slot 1 = the original "Main" schedule.
-- ---------------------------------------------------------------------------
create table if not exists public.watchlists (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- 1..10. Determines the staggered nightly collection hour.
  slot        integer not null check (slot between 1 and 10),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  -- One list per slot so schedules never collide.
  constraint watchlists_slot_unique unique (slot)
);

comment on table public.watchlists is
  'Named symbol lists (max 10). slot drives the staggered nightly collection time.';

-- Hard cap at 10 lists, enforced in the DB as a safety net behind the app cap.
create or replace function public.enforce_watchlist_cap()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.watchlists) >= 10 then
    raise exception 'Watchlist cap reached (max 10).';
  end if;
  return new;
end;
$$;

drop trigger if exists watchlists_cap on public.watchlists;
create trigger watchlists_cap
  before insert on public.watchlists
  for each row execute function public.enforce_watchlist_cap();

-- ---------------------------------------------------------------------------
-- watchlist: add the list foreign key. symbol stays the PK (one symbol == one
-- list), so a symbol row simply points at the list that owns it.
-- ---------------------------------------------------------------------------
alter table public.watchlist
  add column if not exists watchlist_id uuid references public.watchlists(id) on delete cascade;

create index if not exists watchlist_list_idx on public.watchlist (watchlist_id);

-- ---------------------------------------------------------------------------
-- Seed the default "Main" list (slot 1) and adopt every existing symbol into it
-- so nothing is lost and the current schedule is preserved.
-- ---------------------------------------------------------------------------
insert into public.watchlists (name, slot)
select 'Main', 1
where not exists (select 1 from public.watchlists where slot = 1);

update public.watchlist w
set watchlist_id = (select id from public.watchlists where slot = 1)
where w.watchlist_id is null;

-- ---------------------------------------------------------------------------
-- pipeline_runs: attribute each run to a list + record a per-stage breakdown.
--   watchlist_id / watchlist_name : which list this run collected (nullable for
--                                   legacy rows and universe-wide manual runs).
--   mode                          : 'primary' | 'catchup' | 'manual'
--   symbols_skipped               : symbols the smart catch-up skipped because
--                                   today's bar was already stored.
--   stages                        : ordered stage log, e.g.
--     [{ "stage":"resolve","status":"success","ms":12,"detail":"40 symbols" },
--      { "stage":"fetch","status":"partial","ms":8100,"detail":"38/40 ok" },
--      { "stage":"upsert","status":"success","ms":340,"detail":"456 bars" }]
-- ---------------------------------------------------------------------------
alter table public.pipeline_runs
  add column if not exists watchlist_id uuid references public.watchlists(id) on delete set null,
  add column if not exists watchlist_name text,
  add column if not exists mode text not null default 'primary',
  add column if not exists symbols_skipped integer not null default 0,
  add column if not exists stages jsonb not null default '[]'::jsonb;

create index if not exists pipeline_runs_watchlist_idx
  on public.pipeline_runs (watchlist_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security.
-- Service role (Edge Function) bypasses RLS. Single-user app: the browser (anon)
-- gets read on everything and full manage rights on `watchlists` + `watchlist`
-- so the UI can create/rename/delete lists and reconcile symbols. prices +
-- pipeline_runs remain read-only for anon (only the collector writes them).
-- ---------------------------------------------------------------------------
alter table public.watchlists enable row level security;

drop policy if exists watchlists_public_read on public.watchlists;
create policy watchlists_public_read
  on public.watchlists
  for select
  to anon, authenticated
  using (true);

drop policy if exists watchlists_client_insert on public.watchlists;
create policy watchlists_client_insert
  on public.watchlists
  for insert
  to anon, authenticated
  with check (char_length(name) between 1 and 40 and slot between 1 and 10);

drop policy if exists watchlists_client_update on public.watchlists;
create policy watchlists_client_update
  on public.watchlists
  for update
  to anon, authenticated
  using (true)
  with check (char_length(name) between 1 and 40 and slot between 1 and 10);

drop policy if exists watchlists_client_delete on public.watchlists;
create policy watchlists_client_delete
  on public.watchlists
  for delete
  to anon, authenticated
  using (true);

-- The watchlist table already allows anon insert/update (0003 / 0007). Symbols
-- are removed by soft-deactivation, but a list DELETE cascades its symbol rows;
-- allow anon delete on watchlist so removing a whole list is clean.
drop policy if exists watchlist_client_delete on public.watchlist;
create policy watchlist_client_delete
  on public.watchlist
  for delete
  to anon, authenticated
  using (true);
