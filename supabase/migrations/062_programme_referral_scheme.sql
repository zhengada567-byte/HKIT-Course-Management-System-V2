-- AccountHR: Referral Scheme amounts by programme and offered term.
-- Manual entry — one amount per academic year + programme + term.

create table if not exists public.programme_referral_scheme (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  programme_code text not null,
  module_term text not null,
  amount numeric(14, 2) not null default 0 check (amount >= 0),
  notes text,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint programme_referral_scheme_term_check
    check (module_term in ('Sep', 'Feb', 'Jun')),
  unique (academic_year, programme_code, module_term)
);

create index if not exists programme_referral_scheme_year_idx
  on public.programme_referral_scheme (academic_year, module_term);

alter table public.programme_referral_scheme enable row level security;

drop policy if exists "Allow anon all programme_referral_scheme"
  on public.programme_referral_scheme;
create policy "Allow anon all programme_referral_scheme"
  on public.programme_referral_scheme for all to anon
  using (true) with check (true);

drop policy if exists "Allow authenticated all programme_referral_scheme"
  on public.programme_referral_scheme;
create policy "Allow authenticated all programme_referral_scheme"
  on public.programme_referral_scheme for all to authenticated
  using (true) with check (true);

grant select, insert, update, delete on public.programme_referral_scheme
  to anon, authenticated;
