-- AccountHR: scholarship expenses for HKIT DAE → HD students.
-- Currently HDBA / HDHC / HDC: HK$10,000 per student per academic year.
-- Manual Y1 / Y2 headcounts; total = (y1 + y2) × rate.

create table if not exists public.programme_scholarship_expenses (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  programme_code text not null,
  y1_count integer not null default 0 check (y1_count >= 0),
  y2_count integer not null default 0 check (y2_count >= 0),
  amount_per_student numeric(12, 2) not null default 10000
    check (amount_per_student >= 0),
  total_amount numeric(14, 2) not null default 0 check (total_amount >= 0),
  notes text,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academic_year, programme_code)
);

create index if not exists programme_scholarship_expenses_year_idx
  on public.programme_scholarship_expenses (academic_year);

alter table public.programme_scholarship_expenses enable row level security;

drop policy if exists "Allow anon all programme_scholarship_expenses"
  on public.programme_scholarship_expenses;
create policy "Allow anon all programme_scholarship_expenses"
  on public.programme_scholarship_expenses for all to anon
  using (true) with check (true);

drop policy if exists "Allow authenticated all programme_scholarship_expenses"
  on public.programme_scholarship_expenses;
create policy "Allow authenticated all programme_scholarship_expenses"
  on public.programme_scholarship_expenses for all to authenticated
  using (true) with check (true);

grant select, insert, update, delete on public.programme_scholarship_expenses
  to anon, authenticated;
