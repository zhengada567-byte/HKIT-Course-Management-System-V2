-- Allow zero tutorial contact hours; UWLCS / UWLBS / WUBM have no tutorial component.

alter table public.modules
  drop constraint if exists modules_module_tutorial_contact_hours_check;

alter table public.modules
  add constraint modules_module_tutorial_contact_hours_check
  check (module_tutorial_contact_hours >= 0);

comment on column public.modules.module_tutorial_contact_hours is
  'Tutorial contact hours. Defaults: HD 21; UWLCS/UWLBS/WUBM 0; other 48h degree 27; 24h degree (WUCS/WUAFM) 51.';

update public.modules
set module_tutorial_contact_hours = 0
where upper(trim(programme_code)) in ('UWLCS', 'UWLBS', 'WUBM');
