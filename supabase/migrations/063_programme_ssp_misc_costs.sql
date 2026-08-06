-- AccountHR: SSP miscellaneous charges by programme, term, and category.

create table if not exists public.programme_ssp_misc_costs (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  programme_code text not null,
  module_term text not null,
  category_key text not null,
  amount numeric(14, 2) not null default 0 check (amount >= 0),
  notes text,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint programme_ssp_misc_costs_term_check
    check (module_term in ('Sep', 'Feb', 'Jun')),
  constraint programme_ssp_misc_costs_category_check
    check (
      category_key in (
        'govt_rent_rate',
        'waste_disposal',
        'repair_maintenance',
        'lift_maintenance',
        'fire_alarm_transmission',
        'electricity_charges',
        'water'
      )
    ),
  unique (academic_year, programme_code, module_term, category_key)
);

create index if not exists programme_ssp_misc_costs_lookup_idx
  on public.programme_ssp_misc_costs (
    academic_year,
    module_term,
    programme_code
  );

alter table public.programme_ssp_misc_costs enable row level security;

drop policy if exists "Allow anon all programme_ssp_misc_costs"
  on public.programme_ssp_misc_costs;
create policy "Allow anon all programme_ssp_misc_costs"
  on public.programme_ssp_misc_costs for all to anon
  using (true) with check (true);

drop policy if exists "Allow authenticated all programme_ssp_misc_costs"
  on public.programme_ssp_misc_costs;
create policy "Allow authenticated all programme_ssp_misc_costs"
  on public.programme_ssp_misc_costs for all to authenticated
  using (true) with check (true);

grant select, insert, update, delete on public.programme_ssp_misc_costs
  to anon, authenticated;
