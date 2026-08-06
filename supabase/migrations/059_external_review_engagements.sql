-- AccountHR: External Examiner / External Advisor / Class Visit.
-- Default per-module rates + per term/programme engagement records with modules.

create table if not exists public.external_review_default_rates (
  id uuid primary key default gen_random_uuid(),
  role_type text not null,
  amount_per_module numeric(12, 2) not null default 0 check (amount_per_module >= 0),
  notes text,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_review_default_rates_role_check
    check (
      role_type in (
        'external_examiner',
        'external_advisor',
        'class_visit'
      )
    ),
  unique (role_type)
);

insert into public.external_review_default_rates (role_type, amount_per_module)
values
  ('external_examiner', 0),
  ('external_advisor', 0),
  ('class_visit', 0)
on conflict (role_type) do nothing;

create table if not exists public.external_review_engagements (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  module_term text not null,
  programme_code text not null,
  role_type text not null,
  person_name text not null,
  notes text,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_review_engagements_term_check
    check (module_term in ('Sep', 'Feb', 'Jun')),
  constraint external_review_engagements_role_check
    check (
      role_type in (
        'external_examiner',
        'external_advisor',
        'class_visit'
      )
    )
);

create index if not exists external_review_engagements_lookup_idx
  on public.external_review_engagements (
    academic_year,
    module_term,
    programme_code,
    role_type
  );

create table if not exists public.external_review_modules (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null
    references public.external_review_engagements (id) on delete cascade,
  module_name text not null,
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists external_review_modules_engagement_idx
  on public.external_review_modules (engagement_id, sort_order);

alter table public.external_review_default_rates enable row level security;
alter table public.external_review_engagements enable row level security;
alter table public.external_review_modules enable row level security;

drop policy if exists "Allow anon all external_review_default_rates"
  on public.external_review_default_rates;
create policy "Allow anon all external_review_default_rates"
  on public.external_review_default_rates for all to anon
  using (true) with check (true);

drop policy if exists "Allow authenticated all external_review_default_rates"
  on public.external_review_default_rates;
create policy "Allow authenticated all external_review_default_rates"
  on public.external_review_default_rates for all to authenticated
  using (true) with check (true);

drop policy if exists "Allow anon all external_review_engagements"
  on public.external_review_engagements;
create policy "Allow anon all external_review_engagements"
  on public.external_review_engagements for all to anon
  using (true) with check (true);

drop policy if exists "Allow authenticated all external_review_engagements"
  on public.external_review_engagements;
create policy "Allow authenticated all external_review_engagements"
  on public.external_review_engagements for all to authenticated
  using (true) with check (true);

drop policy if exists "Allow anon all external_review_modules"
  on public.external_review_modules;
create policy "Allow anon all external_review_modules"
  on public.external_review_modules for all to anon
  using (true) with check (true);

drop policy if exists "Allow authenticated all external_review_modules"
  on public.external_review_modules;
create policy "Allow authenticated all external_review_modules"
  on public.external_review_modules for all to authenticated
  using (true) with check (true);

grant select, insert, update, delete on public.external_review_default_rates
  to anon, authenticated;
grant select, insert, update, delete on public.external_review_engagements
  to anon, authenticated;
grant select, insert, update, delete on public.external_review_modules
  to anon, authenticated;
