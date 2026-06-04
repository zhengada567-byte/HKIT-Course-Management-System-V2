-- Audit log + email dispatch for PL daily timetable module saves.

create table if not exists public.timetable_daily_change_notifications (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  term text not null,
  timetable_module_id uuid not null references public.timetable_modules(id) on delete cascade,
  module_instance_code text not null,
  programme_code text not null,
  changed_by text,
  change_summary text not null,
  email_to text not null default 'timetable@hkit.edu.hk',
  email_status text not null default 'pending',
  email_error text,
  created_at timestamptz not null default now(),
  constraint timetable_daily_change_notifications_email_status_check
    check (email_status in ('pending', 'sent', 'failed', 'skipped'))
);

create index if not exists timetable_daily_change_notifications_module_idx
  on public.timetable_daily_change_notifications (timetable_module_id, created_at desc);

alter table public.timetable_daily_change_notifications enable row level security;

drop policy if exists "Allow anon all timetable_daily_change_notifications"
  on public.timetable_daily_change_notifications;

create policy "Allow anon all timetable_daily_change_notifications"
  on public.timetable_daily_change_notifications
  for all
  to anon
  using (true)
  with check (true);

comment on table public.timetable_daily_change_notifications is
  'PL daily timetable edits per module; used for email to timetable@hkit.edu.hk.';
