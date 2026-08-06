-- AccountHR role + hourly rate tables for programme / special / teacher rates.

alter table public.app_users
  drop constraint if exists app_users_role_check;

alter table public.app_users
  add constraint app_users_role_check
  check (role in ('programme_leader', 'admin', 'staff', 'account_hr'));

insert into public.app_users (username, role, password_hash)
values (
  'AccountHR',
  'account_hr',
  extensions.crypt('accounthr', extensions.gen_salt('bf'))
)
on conflict (username) do update
set
  role = 'account_hr',
  password_hash = extensions.crypt('accounthr', extensions.gen_salt('bf')),
  updated_at = now();

create or replace function public.change_app_user_password(
  actor_user_id uuid,
  target_username text,
  new_password text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  actor_role text;
  actor_username text;
begin
  select role, username
  into actor_role, actor_username
  from public.app_users
  where id = actor_user_id;

  if actor_role is null then
    raise exception 'Invalid actor user';
  end if;

  if length(coalesce(new_password, '')) < 2 then
    raise exception 'Password is too short';
  end if;

  if actor_role = 'admin' then
    if target_username not in ('pl', 'admin', 'AccountHR') then
      raise exception 'Admin can only change PL/Admin/AccountHR password';
    end if;

    update public.app_users
    set
      password_hash = extensions.crypt(new_password, extensions.gen_salt('bf')),
      updated_at = now()
    where username = target_username;

    return;
  end if;

  if actor_username = target_username
     and actor_role in ('programme_leader', 'admin', 'account_hr') then
    update public.app_users
    set
      password_hash = extensions.crypt(new_password, extensions.gen_salt('bf')),
      updated_at = now()
    where username = target_username;

    return;
  end if;

  raise exception 'Not allowed to change this password';
end;
$$;

-- Programme-level standard hourly rate by year level (e.g. HDC Y1, WUC Y3).
create table if not exists public.programme_hourly_rates (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  programme_code text not null,
  programme_year text not null,
  hourly_rate numeric(12, 2) not null check (hourly_rate >= 0),
  notes text,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint programme_hourly_rates_year_check
    check (programme_year in ('Y1', 'Y2', 'Y3', 'Y4')),
  unique (academic_year, programme_code, programme_year)
);

create index if not exists programme_hourly_rates_year_idx
  on public.programme_hourly_rates (academic_year);

-- Named special-case rates (exceptions not covered by programme year).
create table if not exists public.special_hourly_rates (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  rate_name text not null,
  programme_code text,
  hourly_rate numeric(12, 2) not null check (hourly_rate >= 0),
  notes text,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academic_year, rate_name)
);

create index if not exists special_hourly_rates_year_idx
  on public.special_hourly_rates (academic_year);

-- Individual teacher overrides vs programme standard rate.
create table if not exists public.teacher_hourly_rates (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  teacher_name text not null,
  employment_type text,
  hourly_rate numeric(12, 2) not null check (hourly_rate >= 0),
  notes text,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teacher_hourly_rates_employment_check
    check (
      employment_type is null
      or employment_type in ('FT', 'PT', '')
    ),
  unique (academic_year, teacher_name)
);

create index if not exists teacher_hourly_rates_year_idx
  on public.teacher_hourly_rates (academic_year);

alter table public.programme_hourly_rates enable row level security;
alter table public.special_hourly_rates enable row level security;
alter table public.teacher_hourly_rates enable row level security;

drop policy if exists "Allow anon all programme_hourly_rates"
  on public.programme_hourly_rates;
create policy "Allow anon all programme_hourly_rates"
  on public.programme_hourly_rates for all to anon using (true) with check (true);

drop policy if exists "Allow authenticated all programme_hourly_rates"
  on public.programme_hourly_rates;
create policy "Allow authenticated all programme_hourly_rates"
  on public.programme_hourly_rates for all to authenticated using (true) with check (true);

drop policy if exists "Allow anon all special_hourly_rates"
  on public.special_hourly_rates;
create policy "Allow anon all special_hourly_rates"
  on public.special_hourly_rates for all to anon using (true) with check (true);

drop policy if exists "Allow authenticated all special_hourly_rates"
  on public.special_hourly_rates;
create policy "Allow authenticated all special_hourly_rates"
  on public.special_hourly_rates for all to authenticated using (true) with check (true);

drop policy if exists "Allow anon all teacher_hourly_rates"
  on public.teacher_hourly_rates;
create policy "Allow anon all teacher_hourly_rates"
  on public.teacher_hourly_rates for all to anon using (true) with check (true);

drop policy if exists "Allow authenticated all teacher_hourly_rates"
  on public.teacher_hourly_rates;
create policy "Allow authenticated all teacher_hourly_rates"
  on public.teacher_hourly_rates for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.programme_hourly_rates to anon, authenticated;
grant select, insert, update, delete on public.special_hourly_rates to anon, authenticated;
grant select, insert, update, delete on public.teacher_hourly_rates to anon, authenticated;
