-- Replace module_contact_hours with teaching + tutorial contact hours.

alter table public.modules
  add column if not exists module_teaching_contact_hours integer not null default 36
    check (module_teaching_contact_hours > 0),
  add column if not exists module_tutorial_contact_hours integer not null default 21
    check (module_tutorial_contact_hours > 0);

comment on column public.modules.module_teaching_contact_hours is
  'Teaching contact hours. Defaults: HD 36; UWLBS/UWLCS/UWLC/UWLCFI 48; WUBM/WUCS/WUAFM 24.';
comment on column public.modules.module_tutorial_contact_hours is
  'Tutorial contact hours. Defaults: HD 21; degree 48h programmes 27 (75-48); degree 24h programmes 51 (75-24).';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'modules'
      and column_name = 'module_contact_hours'
  ) then
    update public.modules
    set
      module_teaching_contact_hours = case module_contact_hours
        when 24 then 24
        when 48 then 48
        when 57 then 36
        else module_teaching_contact_hours
      end,
      module_tutorial_contact_hours = case module_contact_hours
        when 24 then 51
        when 48 then 27
        when 57 then 21
        else module_tutorial_contact_hours
      end;
  end if;
end $$;

update public.modules
set
  module_teaching_contact_hours = 24,
  module_tutorial_contact_hours = 51
where upper(trim(programme_code)) in ('WUCS', 'WUBM', 'WUAFM');

update public.modules
set
  module_teaching_contact_hours = 48,
  module_tutorial_contact_hours = 27
where upper(trim(programme_code)) in (
  'UWLBS', 'UWLBM', 'UWLCFI', 'UWLC', 'UWLCS'
);

update public.modules m
set
  module_teaching_contact_hours = 36,
  module_tutorial_contact_hours = 21
from public.programmes p
where upper(trim(m.programme_code)) = upper(trim(p.programme_code))
  and upper(trim(coalesce(p.programme_type, ''))) in ('HD', 'HIGHER DIPLOMA')
  and upper(trim(m.programme_code)) not in (
    'WUCS', 'WUBM', 'WUAFM',
    'UWLBS', 'UWLBM', 'UWLCFI', 'UWLC', 'UWLCS'
  );

update public.modules m
set
  module_teaching_contact_hours = 48,
  module_tutorial_contact_hours = 27
from public.programmes p
where upper(trim(m.programme_code)) = upper(trim(p.programme_code))
  and upper(trim(coalesce(p.programme_type, ''))) = 'DEGREE'
  and upper(trim(m.programme_code)) not in (
    'WUCS', 'WUBM', 'WUAFM',
    'UWLBS', 'UWLBM', 'UWLCFI', 'UWLC', 'UWLCS'
  )
  and m.module_teaching_contact_hours = 36
  and m.module_tutorial_contact_hours = 21;

alter table public.modules
  drop column if exists module_contact_hours;
