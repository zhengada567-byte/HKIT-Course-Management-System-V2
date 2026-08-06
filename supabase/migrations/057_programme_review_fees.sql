-- AccountHR: review / registration / annual-audit fees by programme and academic year.
-- Manual entry — one amount per academic year + programme + fee type.

create table if not exists public.programme_review_fees (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  programme_code text not null,
  fee_type text not null default 'review',
  amount numeric(14, 2) not null default 0 check (amount >= 0),
  notes text,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint programme_review_fees_fee_type_check
    check (fee_type in ('review', 'registration', 'annual_audit', 'periodic')),
  unique (academic_year, programme_code, fee_type)
);

create index if not exists programme_review_fees_year_idx
  on public.programme_review_fees (academic_year);

create index if not exists programme_review_fees_year_type_idx
  on public.programme_review_fees (academic_year, fee_type);

alter table public.programme_review_fees enable row level security;

drop policy if exists "Allow anon all programme_review_fees"
  on public.programme_review_fees;
create policy "Allow anon all programme_review_fees"
  on public.programme_review_fees for all to anon using (true) with check (true);

drop policy if exists "Allow authenticated all programme_review_fees"
  on public.programme_review_fees;
create policy "Allow authenticated all programme_review_fees"
  on public.programme_review_fees for all to authenticated
  using (true) with check (true);

grant select, insert, update, delete on public.programme_review_fees
  to anon, authenticated;
