-- AccountHR programme promotion / marketing expenses.
-- Social media: monthly per programme.
-- Workshop / brochure / exhibition / other: per occurrence.

-- Social media spend by academic-year month (Sep..Aug).
create table if not exists public.programme_social_media_costs (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  programme_code text not null,
  month_key text not null,
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  notes text,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint programme_social_media_costs_month_check
    check (
      month_key in (
        'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'
      )
    ),
  unique (academic_year, programme_code, month_key)
);

create index if not exists programme_social_media_costs_year_idx
  on public.programme_social_media_costs (academic_year);

-- Workshops: title + speaker fee + promotion fee per occurrence.
create table if not exists public.programme_workshop_costs (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  programme_code text not null,
  workshop_title text not null,
  speaker_fee numeric(12, 2) not null default 0 check (speaker_fee >= 0),
  promotion_fee numeric(12, 2) not null default 0 check (promotion_fee >= 0),
  expense_date date,
  notes text,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists programme_workshop_costs_year_idx
  on public.programme_workshop_costs (academic_year, programme_code);

-- Brochure / exhibition / other: amount per occurrence.
create table if not exists public.programme_promotion_occurrence_costs (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  programme_code text not null,
  cost_type text not null,
  title text,
  amount numeric(12, 2) not null check (amount >= 0),
  expense_date date,
  notes text,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint programme_promotion_occurrence_costs_type_check
    check (cost_type in ('brochure', 'exhibition', 'other'))
);

create index if not exists programme_promotion_occurrence_costs_year_idx
  on public.programme_promotion_occurrence_costs (academic_year, programme_code, cost_type);

alter table public.programme_social_media_costs enable row level security;
alter table public.programme_workshop_costs enable row level security;
alter table public.programme_promotion_occurrence_costs enable row level security;

drop policy if exists "Allow anon all programme_social_media_costs"
  on public.programme_social_media_costs;
create policy "Allow anon all programme_social_media_costs"
  on public.programme_social_media_costs for all to anon using (true) with check (true);

drop policy if exists "Allow authenticated all programme_social_media_costs"
  on public.programme_social_media_costs;
create policy "Allow authenticated all programme_social_media_costs"
  on public.programme_social_media_costs for all to authenticated using (true) with check (true);

drop policy if exists "Allow anon all programme_workshop_costs"
  on public.programme_workshop_costs;
create policy "Allow anon all programme_workshop_costs"
  on public.programme_workshop_costs for all to anon using (true) with check (true);

drop policy if exists "Allow authenticated all programme_workshop_costs"
  on public.programme_workshop_costs;
create policy "Allow authenticated all programme_workshop_costs"
  on public.programme_workshop_costs for all to authenticated using (true) with check (true);

drop policy if exists "Allow anon all programme_promotion_occurrence_costs"
  on public.programme_promotion_occurrence_costs;
create policy "Allow anon all programme_promotion_occurrence_costs"
  on public.programme_promotion_occurrence_costs for all to anon using (true) with check (true);

drop policy if exists "Allow authenticated all programme_promotion_occurrence_costs"
  on public.programme_promotion_occurrence_costs;
create policy "Allow authenticated all programme_promotion_occurrence_costs"
  on public.programme_promotion_occurrence_costs for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.programme_social_media_costs to anon, authenticated;
grant select, insert, update, delete on public.programme_workshop_costs to anon, authenticated;
grant select, insert, update, delete on public.programme_promotion_occurrence_costs to anon, authenticated;
