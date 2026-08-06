-- AccountHR full-time staff costs by programme and month.
-- Single monthly total (Academic + Admin combined) for privacy.

create table if not exists public.programme_ft_staff_costs (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  programme_code text not null,
  month_key text not null,
  total_cost numeric(12, 2) not null default 0 check (total_cost >= 0),
  notes text,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint programme_ft_staff_costs_month_check
    check (
      month_key in (
        'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'
      )
    ),
  unique (academic_year, programme_code, month_key)
);

create index if not exists programme_ft_staff_costs_year_idx
  on public.programme_ft_staff_costs (academic_year, programme_code);

alter table public.programme_ft_staff_costs enable row level security;

drop policy if exists "Allow anon all programme_ft_staff_costs"
  on public.programme_ft_staff_costs;
create policy "Allow anon all programme_ft_staff_costs"
  on public.programme_ft_staff_costs for all to anon using (true) with check (true);

drop policy if exists "Allow authenticated all programme_ft_staff_costs"
  on public.programme_ft_staff_costs;
create policy "Allow authenticated all programme_ft_staff_costs"
  on public.programme_ft_staff_costs for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.programme_ft_staff_costs to anon, authenticated;
