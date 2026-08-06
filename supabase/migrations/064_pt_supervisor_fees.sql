-- AccountHR: PT supervisor fees by programme and term.
-- Manual student headcount × $2,500 per student per academic year.

create table if not exists public.pt_supervisor_fees (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  programme_code text not null,
  module_term text not null,
  supervisor_name text not null,
  student_count integer not null default 0 check (student_count >= 0),
  amount_per_student numeric(12, 2) not null default 2500
    check (amount_per_student >= 0),
  total_amount numeric(14, 2) not null default 0 check (total_amount >= 0),
  notes text,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pt_supervisor_fees_term_check
    check (module_term in ('Sep', 'Feb', 'Jun')),
  unique (academic_year, programme_code, module_term, supervisor_name)
);

create index if not exists pt_supervisor_fees_lookup_idx
  on public.pt_supervisor_fees (academic_year, module_term, programme_code);

alter table public.pt_supervisor_fees enable row level security;

drop policy if exists "Allow anon all pt_supervisor_fees"
  on public.pt_supervisor_fees;
create policy "Allow anon all pt_supervisor_fees"
  on public.pt_supervisor_fees for all to anon
  using (true) with check (true);

drop policy if exists "Allow authenticated all pt_supervisor_fees"
  on public.pt_supervisor_fees;
create policy "Allow authenticated all pt_supervisor_fees"
  on public.pt_supervisor_fees for all to authenticated
  using (true) with check (true);

grant select, insert, update, delete on public.pt_supervisor_fees
  to anon, authenticated;
