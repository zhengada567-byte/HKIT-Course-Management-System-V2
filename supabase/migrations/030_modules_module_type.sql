-- Core vs optional classification for catalog modules (default: core).

alter table public.modules
  add column if not exists module_type text not null default 'core'
    check (module_type in ('core', 'optional'));

comment on column public.modules.module_type is
  'core = required module; optional = elective. Default core.';
