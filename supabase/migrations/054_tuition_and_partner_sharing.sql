-- AccountHR: tuition income by term + partner sharing fee / calculation.

-- Tuition income: one amount per academic year + programme + offered term.
create table if not exists public.tuition_income (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  programme_code text not null,
  module_term text not null,
  amount numeric(14, 2) not null default 0 check (amount >= 0),
  notes text,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tuition_income_term_check
    check (module_term in ('Sep', 'Feb', 'Jun')),
  unique (academic_year, programme_code, module_term)
);

create index if not exists tuition_income_year_idx
  on public.tuition_income (academic_year, programme_code);

-- Reusable sharing fee per student (by year + programme).
create table if not exists public.partner_sharing_fees (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  programme_code text not null,
  fee_per_student numeric(12, 2) not null check (fee_per_student >= 0),
  notes text,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academic_year, programme_code)
);

create index if not exists partner_sharing_fees_year_idx
  on public.partner_sharing_fees (academic_year);

-- Saved partner-sharing calculations (year + programme + term).
create table if not exists public.partner_sharing_records (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  programme_code text not null,
  module_term text not null,
  study_term text,
  ft_student_count integer not null default 0 check (ft_student_count >= 0),
  fee_per_student numeric(12, 2) not null check (fee_per_student >= 0),
  total_sharing_fee numeric(14, 2) not null check (total_sharing_fee >= 0),
  notes text,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_sharing_records_term_check
    check (module_term in ('Sep', 'Feb', 'Jun')),
  unique (academic_year, programme_code, module_term)
);

create index if not exists partner_sharing_records_year_idx
  on public.partner_sharing_records (academic_year, programme_code);

alter table public.tuition_income enable row level security;
alter table public.partner_sharing_fees enable row level security;
alter table public.partner_sharing_records enable row level security;

drop policy if exists "Allow anon all tuition_income" on public.tuition_income;
create policy "Allow anon all tuition_income"
  on public.tuition_income for all to anon using (true) with check (true);

drop policy if exists "Allow authenticated all tuition_income" on public.tuition_income;
create policy "Allow authenticated all tuition_income"
  on public.tuition_income for all to authenticated using (true) with check (true);

drop policy if exists "Allow anon all partner_sharing_fees" on public.partner_sharing_fees;
create policy "Allow anon all partner_sharing_fees"
  on public.partner_sharing_fees for all to anon using (true) with check (true);

drop policy if exists "Allow authenticated all partner_sharing_fees"
  on public.partner_sharing_fees;
create policy "Allow authenticated all partner_sharing_fees"
  on public.partner_sharing_fees for all to authenticated using (true) with check (true);

drop policy if exists "Allow anon all partner_sharing_records"
  on public.partner_sharing_records;
create policy "Allow anon all partner_sharing_records"
  on public.partner_sharing_records for all to anon using (true) with check (true);

drop policy if exists "Allow authenticated all partner_sharing_records"
  on public.partner_sharing_records;
create policy "Allow authenticated all partner_sharing_records"
  on public.partner_sharing_records for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.tuition_income to anon, authenticated;
grant select, insert, update, delete on public.partner_sharing_fees to anon, authenticated;
grant select, insert, update, delete on public.partner_sharing_records to anon, authenticated;
