-- Rename study plan delivery_mode to enrolled_module_instance_code (student class enrollment).

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'study_plan_modules'
      and column_name = 'delivery_mode'
  )
  and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'study_plan_modules'
      and column_name = 'enrolled_module_instance_code'
  ) then
    alter table public.study_plan_modules
      rename column delivery_mode to enrolled_module_instance_code;
  end if;
end $$;

alter table public.study_plan_modules
  add column if not exists enrolled_module_instance_code text;
