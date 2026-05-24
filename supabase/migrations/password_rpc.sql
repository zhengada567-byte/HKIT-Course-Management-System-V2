create extension if not exists pgcrypto with schema extensions;

update public.app_users
set password_hash = extensions.crypt('pl', extensions.gen_salt('bf'))
where username = 'pl';

update public.app_users
set password_hash = extensions.crypt('admin', extensions.gen_salt('bf'))
where username = 'admin';

update public.app_users
set password_hash = extensions.crypt('president', extensions.gen_salt('bf'))
where username = 'president';

create or replace function public.verify_app_user_password(
  input_username text,
  input_password text
)
returns table (
  id uuid,
  username text,
  role text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public, extensions
as $$
  select
    u.id,
    u.username,
    u.role,
    u.created_at,
    u.updated_at
  from public.app_users u
  where u.username = input_username
    and u.password_hash is not null
    and u.password_hash = extensions.crypt(input_password, u.password_hash);
$$;

grant execute on function public.verify_app_user_password(text, text) to anon;

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
    if target_username not in ('pl', 'admin') then
      raise exception 'Admin can only change PL/Admin password';
    end if;

    update public.app_users
    set password_hash = extensions.crypt(new_password, extensions.gen_salt('bf'))
    where username = target_username;

    return;
  end if;

  if actor_role = 'president' then
    if target_username <> actor_username then
      raise exception 'President can only change own password';
    end if;

    update public.app_users
    set password_hash = extensions.crypt(new_password, extensions.gen_salt('bf'))
    where username = target_username;

    return;
  end if;

  raise exception 'Unauthorized password change';
end;
$$;

grant execute on function public.change_app_user_password(uuid, text, text) to anon;
