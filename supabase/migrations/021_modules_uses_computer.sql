-- Whether a catalog module needs a computer room for timetable scheduling (admin-set).

alter table public.modules
  add column if not exists uses_computer text not null default 'N'
    check (uses_computer in ('Y', 'N'));

comment on column public.modules.uses_computer is
  'Y = assign computer room when auto-scheduling; N = not required. Default N.';

-- Preserve prior HDC auto-schedule behaviour: computer room unless listed exceptions.
update public.modules
set uses_computer = 'Y'
where upper(trim(programme_code)) = 'HDC'
  and upper(trim(module_code)) not in (
    'GS407',
    'CS401',
    'CS416',
    'CS407',
    'CS424',
    'HD401',
    'HD402',
    'HD403',
    'HD404',
    'HD405',
    'HD408'
  );
