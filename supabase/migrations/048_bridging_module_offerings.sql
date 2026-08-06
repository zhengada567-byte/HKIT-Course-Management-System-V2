-- Term-scoped bridging (short) offerings derived from HD catalogue modules.
-- Example: GS401 → GS401B for academic_year + module_term (Sep/Feb/Jun).
-- Same term shares one GS401B per parent module identity.

create table if not exists public.bridging_module_offerings (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  module_term text not null,
  parent_module_id uuid not null references public.modules(id) on delete restrict,
  bridging_module_id uuid not null references public.modules(id) on delete restrict,
  parent_module_code text not null,
  bridging_module_code text not null,
  programme_code text not null,
  stream_code text not null default 'nil',
  status text not null default 'active',
  created_by uuid references public.app_users(id) on delete set null,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bridging_module_offerings_term_check
    check (module_term in ('Sep', 'Feb', 'Jun')),
  constraint bridging_module_offerings_status_check
    check (status in ('active', 'inactive'))
);

create unique index if not exists bridging_module_offerings_unique_parent_term
  on public.bridging_module_offerings (
    academic_year,
    module_term,
    parent_module_id
  );

create unique index if not exists bridging_module_offerings_unique_bridging_term
  on public.bridging_module_offerings (
    academic_year,
    module_term,
    bridging_module_id
  );

create index if not exists bridging_module_offerings_year_term_idx
  on public.bridging_module_offerings (academic_year, module_term);

create index if not exists bridging_module_offerings_bridging_code_idx
  on public.bridging_module_offerings (bridging_module_code);

comment on table public.bridging_module_offerings is
  'Per academic-year/term activation of HD short bridging modules (e.g. GS401B from GS401).';

alter table public.bridging_module_offerings enable row level security;

drop policy if exists "Allow anon all bridging_module_offerings"
  on public.bridging_module_offerings;

create policy "Allow anon all bridging_module_offerings"
  on public.bridging_module_offerings
  for all
  to anon
  using (true)
  with check (true);

drop policy if exists "Allow authenticated all bridging_module_offerings"
  on public.bridging_module_offerings;

create policy "Allow authenticated all bridging_module_offerings"
  on public.bridging_module_offerings
  for all
  to authenticated
  using (true)
  with check (true);

grant select, insert, update, delete
  on public.bridging_module_offerings
  to anon;

grant select, insert, update, delete
  on public.bridging_module_offerings
  to authenticated;
