-- Seed default HKIT classrooms (required for timetable_sessions.room_code FK).
insert into public.timetable_classrooms (room_code, room_size, room_type, updated_at)
values
  ('SSP-101', 29, 'normal', now()),
  ('SSP-104', 29, 'normal', now()),
  ('SSP-201', 29, 'normal', now()),
  ('SSP-204', 29, 'computer', now()),
  ('SSP-203', 80, 'normal', now()),
  ('SSP-303', 110, 'normal', now()),
  ('SSP-103', 65, 'computer', now())
on conflict (room_code) do update
set
  room_size = excluded.room_size,
  room_type = excluded.room_type,
  updated_at = excluded.updated_at;
