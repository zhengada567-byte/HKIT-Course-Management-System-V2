-- Module contact hours (catalog attribute; defaults vary by programme).

alter table public.modules
  add column if not exists module_contact_hours integer not null default 57
    check (module_contact_hours > 0);

comment on column public.modules.module_contact_hours is
  'Total contact hours for the module. Defaults: HD programmes 57; WUCS/WUBM/WUAFM 24; UWLBM/UWLCFI/UWLC/UWLCS 48.';

update public.modules
set module_contact_hours = 24
where upper(trim(programme_code)) in ('WUCS', 'WUBM', 'WUAFM');

update public.modules
set module_contact_hours = 48
where upper(trim(programme_code)) in ('UWLBM', 'UWLCFI', 'UWLC', 'UWLCS');

update public.modules m
set module_contact_hours = 57
from public.programmes p
where upper(trim(m.programme_code)) = upper(trim(p.programme_code))
  and upper(trim(coalesce(p.programme_type, ''))) in ('HD', 'HIGHER DIPLOMA')
  and upper(trim(m.programme_code)) not in (
    'WUCS', 'WUBM', 'WUAFM', 'UWLBM', 'UWLCFI', 'UWLC', 'UWLCS'
  );

update public.modules m
set module_contact_hours = 48
from public.programmes p
where upper(trim(m.programme_code)) = upper(trim(p.programme_code))
  and upper(trim(coalesce(p.programme_type, ''))) = 'DEGREE'
  and upper(trim(m.programme_code)) not in (
    'WUCS', 'WUBM', 'WUAFM', 'UWLBM', 'UWLCFI', 'UWLC', 'UWLCS'
  )
  and m.module_contact_hours = 57;
