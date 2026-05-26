-- Programme quota confirmations (per academic year + programme).
-- Stream breakdown remains in programme_stream_quotas.

create table if not exists public.programme_quota_confirmations (
  id uuid primary key default gen_random_uuid(),

  academic_year text not null,
  programme_code text not null,
  programme_quota integer not null default 0 check (programme_quota >= 0),

  confirmed_at timestamptz,
  confirmed_by text,

  admin_unlocked_until timestamptz,
  admin_unlocked_by text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint programme_quota_confirmations_unique
    unique (academic_year, programme_code)
);

create index if not exists programme_quota_confirmations_year_idx
  on public.programme_quota_confirmations (academic_year);

alter table public.programme_quota_confirmations enable row level security;

drop policy if exists "Authenticated full access programme_quota_confirmations"
  on public.programme_quota_confirmations;

create policy "Authenticated full access programme_quota_confirmations"
  on public.programme_quota_confirmations
  for all
  to authenticated
  using (true)
  with check (true);

grant select, insert, update, delete
  on public.programme_quota_confirmations
  to authenticated;

grant select, insert, update, delete
  on public.programme_quota_confirmations
  to anon;

drop policy if exists "Allow anon all programme_quota_confirmations"
  on public.programme_quota_confirmations;

create policy "Allow anon all programme_quota_confirmations"
  on public.programme_quota_confirmations
  for all
  to anon
  using (true)
  with check (true);
