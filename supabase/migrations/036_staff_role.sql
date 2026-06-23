-- Replace president role with read-only staff (passwordless login).

alter table public.app_users
  drop constraint if exists app_users_role_check;

-- Migrate existing rows before adding the new role check.
update public.app_users
set
  username = 'staff',
  role = 'staff',
  password_hash = null
where username = 'president'
   or role = 'president';

insert into public.app_users (username, role, password_hash)
values ('staff', 'staff', null)
on conflict (username) do update
set
  role = 'staff',
  password_hash = null;

alter table public.app_users
  add constraint app_users_role_check
  check (role in ('programme_leader', 'admin', 'staff'));

create or replace function public.login_staff_user()
returns table (
  id uuid,
  username text,
  role text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    u.id,
    u.username,
    u.role,
    u.created_at,
    u.updated_at
  from public.app_users u
  where u.role = 'staff'
  order by u.username
  limit 1;
$$;

grant execute on function public.login_staff_user() to anon;

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
begin
  select role
  into actor_role
  from public.app_users
  where id = actor_user_id;

  if actor_role is null then
    raise exception 'Invalid actor user';
  end if;

  if length(coalesce(new_password, '')) < 2 then
    raise exception 'Password is too short';
  end if;

  if actor_role = 'admin' then
    if target_username not in ('pl', 'admin') then
      raise exception 'Admin can only change PL/Admin password';
    end if;

    update public.app_users
    set password_hash = extensions.crypt(new_password, extensions.gen_salt('bf'))
    where username = target_username;

    return;
  end if;

  raise exception 'Unauthorized password change';
end;
$$;
