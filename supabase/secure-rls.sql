-- Lock app_database: remove open anon policies.
-- /api/db uses SECURITY DEFINER RPCs (tt_app_db_get / tt_app_db_put) with the
-- server gate secret, OR direct access when SUPABASE_SERVICE_ROLE_KEY is set.
--
-- Prefer applying via: supabase/migrations or the MCP apply_migration path.
-- This file is the manual SQL Editor equivalent.

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create table if not exists private.app_gate (
  id text primary key default 'main',
  secret text not null,
  updated_at timestamptz not null default now()
);

revoke all on table private.app_gate from public;
revoke all on table private.app_gate from anon;
revoke all on table private.app_gate from authenticated;

-- If re-running manually, set secret to match server DB_API_KEY / gate secret.
-- insert into private.app_gate (id, secret) values ('main', 'YOUR_SECRET')
-- on conflict (id) do update set secret = excluded.secret;

drop policy if exists "Allow read app_database" on public.app_database;
drop policy if exists "Allow insert app_database" on public.app_database;
drop policy if exists "Allow update app_database" on public.app_database;
drop policy if exists "Allow delete app_database" on public.app_database;
drop policy if exists "anon_all_app_database" on public.app_database;

alter table public.app_database enable row level security;
-- No policies → only service_role (bypasses RLS) or SECURITY DEFINER RPCs.

alter table private.app_gate enable row level security;
-- No policies → deny anon/authenticated; only service_role / SECURITY DEFINER.

-- Critical: anon must not call gate RPCs with a secret that is also in the browser bundle.
revoke all on function public.tt_app_db_get(text) from public;
revoke all on function public.tt_app_db_get(text) from anon;
revoke all on function public.tt_app_db_get(text) from authenticated;
revoke all on function public.tt_app_db_put(text, jsonb, timestamp with time zone) from public;
revoke all on function public.tt_app_db_put(text, jsonb, timestamp with time zone) from anon;
revoke all on function public.tt_app_db_put(text, jsonb, timestamp with time zone) from authenticated;
grant execute on function public.tt_app_db_get(text) to service_role;
grant execute on function public.tt_app_db_put(text, jsonb, timestamp with time zone) to service_role;

-- Public media: keep object URLs reachable; do not allow directory listing.
drop policy if exists "Public read product-media" on storage.objects;
