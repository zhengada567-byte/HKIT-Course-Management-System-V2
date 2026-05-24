create or replace view public.app_user_profiles as
select
  id,
  username,
  role,
  created_at,
  updated_at
from public.app_users;

grant select on public.app_user_profiles to anon;
