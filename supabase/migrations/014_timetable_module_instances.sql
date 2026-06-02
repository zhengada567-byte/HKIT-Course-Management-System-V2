-- Timetable module instances (post-split, editable size/teacher with conservation).

create table if not exists public.timetable_module_instances (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,

  -- Source (either single planning module or combined group)
  source_type text not null,
  source_planning_module_id uuid,
  source_combine_group_id uuid,

  -- Display / identification
  module_term text not null,
  module_instance_code text not null,
  module_code text not null,
  module_name text,

  -- Editable per-instance fields (testing + operations)
  instance_expected_size integer not null default 0,
  instance_actual_size integer,
  instance_teacher_name text,

  -- Split structure
  split_group_size integer not null default 1,
  instance_index integer not null default 1,

  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint timetable_module_instances_source_type_check check (source_type in ('planning_module', 'combine_group')),
  constraint timetable_module_instances_term_check check (module_term in ('Sep', 'Feb', 'Jun')),
  constraint timetable_module_instances_expected_check check (instance_expected_size >= 0),
  constraint timetable_module_instances_actual_check check (instance_actual_size is null or instance_actual_size >= 0),
  constraint timetable_module_instances_split_group_size_check check (split_group_size > 0),
  constraint timetable_module_instances_instance_index_check check (instance_index > 0),

  constraint timetable_module_instances_source_planning_fk foreign key (source_planning_module_id)
    references public.timetable_planning_modules(id) on delete cascade,
  constraint timetable_module_instances_source_combine_fk foreign key (source_combine_group_id)
    references public.combine_groups(id) on delete cascade,

  constraint timetable_module_instances_created_by_fk foreign key (created_by)
    references public.app_users(id) on delete set null,

  constraint timetable_module_instances_source_presence check (
    (source_type = 'planning_module' and source_planning_module_id is not null and source_combine_group_id is null)
    or
    (source_type = 'combine_group' and source_combine_group_id is not null and source_planning_module_id is null)
  )
);

create index if not exists timetable_module_instances_year_idx
  on public.timetable_module_instances (academic_year);

create index if not exists timetable_module_instances_source_planning_idx
  on public.timetable_module_instances (source_planning_module_id);

create index if not exists timetable_module_instances_source_combine_idx
  on public.timetable_module_instances (source_combine_group_id);

create unique index if not exists timetable_module_instances_unique_code
  on public.timetable_module_instances (academic_year, module_instance_code);

alter table public.timetable_module_instances enable row level security;

drop policy if exists "Allow anon all timetable_module_instances"
  on public.timetable_module_instances;

create policy "Allow anon all timetable_module_instances"
  on public.timetable_module_instances
  for all
  to anon
  using (true)
  with check (true);

drop policy if exists "Allow authenticated all timetable_module_instances"
  on public.timetable_module_instances;

create policy "Allow authenticated all timetable_module_instances"
  on public.timetable_module_instances
  for all
  to authenticated
  using (true)
  with check (true);

grant select, insert, update, delete
  on public.timetable_module_instances
  to anon;

grant select, insert, update, delete
  on public.timetable_module_instances
  to authenticated;

