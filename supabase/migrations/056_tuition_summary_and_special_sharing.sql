-- Programme tuition fee (per student) for AccountHR summary,
-- and special partner-sharing calculations (UWLCFI 个人 / HDEE FLU).

create table if not exists public.programme_tuition_fees (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  programme_code text not null,
  tuition_fee_per_student numeric(12, 2) not null default 0
    check (tuition_fee_per_student >= 0),
  notes text,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academic_year, programme_code)
);

create index if not exists programme_tuition_fees_year_idx
  on public.programme_tuition_fees (academic_year);

-- Special sharing results: partner_individual (UWLCFI) / flu (HDEE/HDEEI).
create table if not exists public.partner_sharing_special_records (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  programme_code text not null,
  sharing_type text not null,
  student_count integer not null default 0 check (student_count >= 0),
  tuition_fee_per_student numeric(12, 2) not null default 0
    check (tuition_fee_per_student >= 0),
  partner_u_fee_per_student numeric(12, 2) not null default 0
    check (partner_u_fee_per_student >= 0),
  teacher_cost numeric(12, 2) not null default 0 check (teacher_cost >= 0),
  lab_technician_cost numeric(12, 2) not null default 0
    check (lab_technician_cost >= 0),
  other_cost numeric(12, 2) not null default 0 check (other_cost >= 0),
  calculated_total numeric(14, 2) not null default 0,
  notes text,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_sharing_special_type_check
    check (sharing_type in ('partner_individual', 'flu')),
  unique (academic_year, programme_code, sharing_type)
);

create index if not exists partner_sharing_special_records_year_idx
  on public.partner_sharing_special_records (academic_year, programme_code);

alter table public.programme_tuition_fees enable row level security;
alter table public.partner_sharing_special_records enable row level security;

drop policy if exists "Allow anon all programme_tuition_fees"
  on public.programme_tuition_fees;
create policy "Allow anon all programme_tuition_fees"
  on public.programme_tuition_fees for all to anon using (true) with check (true);

drop policy if exists "Allow authenticated all programme_tuition_fees"
  on public.programme_tuition_fees;
create policy "Allow authenticated all programme_tuition_fees"
  on public.programme_tuition_fees for all to authenticated
  using (true) with check (true);

drop policy if exists "Allow anon all partner_sharing_special_records"
  on public.partner_sharing_special_records;
create policy "Allow anon all partner_sharing_special_records"
  on public.partner_sharing_special_records for all to anon
  using (true) with check (true);

drop policy if exists "Allow authenticated all partner_sharing_special_records"
  on public.partner_sharing_special_records;
create policy "Allow authenticated all partner_sharing_special_records"
  on public.partner_sharing_special_records for all to authenticated
  using (true) with check (true);

grant select, insert, update, delete on public.programme_tuition_fees
  to anon, authenticated;
grant select, insert, update, delete on public.partner_sharing_special_records
  to anon, authenticated;
