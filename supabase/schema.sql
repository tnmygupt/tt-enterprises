-- TT Enterprises shared app database
--
-- Recommended production setup:
-- 1) Set SUPABASE_SERVICE_ROLE_KEY on Hostinger (server only).
-- 2) Run the "LOCKED" section below (or secure-rls.sql).
-- 3) Optionally set DB_API_KEY + NEXT_PUBLIC_DB_API_KEY for /api/db.
--
-- Until the service role is configured, keep the OPEN policies so the
-- Hostinger SUPABASE_API_KEY (often the anon key) can still write via /api/db.

create table if not exists public.app_database (
  id text primary key default 'main',
  updated_at timestamptz not null default now(),
  db jsonb not null default '{}'::jsonb
);

alter table public.app_database enable row level security;

drop policy if exists "Allow read app_database" on public.app_database;
drop policy if exists "Allow insert app_database" on public.app_database;
drop policy if exists "Allow update app_database" on public.app_database;
drop policy if exists "Allow delete app_database" on public.app_database;

-- ——— OPEN (default until service role is on Hostinger) ———
create policy "Allow read app_database"
  on public.app_database for select
  using (true);

create policy "Allow insert app_database"
  on public.app_database for insert
  with check (true);

create policy "Allow update app_database"
  on public.app_database for update
  using (true)
  with check (true);

insert into public.app_database (id, db)
values ('main', '{}'::jsonb)
on conflict (id) do nothing;

do $$
begin
  alter publication supabase_realtime add table public.app_database;
exception
  when duplicate_object then null;
end $$;

-- ——— LOCKED (run after SUPABASE_SERVICE_ROLE_KEY is set on Hostinger) ———
-- drop policy if exists "Allow read app_database" on public.app_database;
-- drop policy if exists "Allow insert app_database" on public.app_database;
-- drop policy if exists "Allow update app_database" on public.app_database;
-- -- No policies → only service_role (bypasses RLS) can access.
