-- Remove legacy timetable_student_numbers rows from pre-stream-schema sync.
-- 1) programme_stream = 'all' (old aggregate key)
-- 2) malformed study_term containing '/' (e.g. T2026/2027C from migration 003 backfill)

delete from public.timetable_student_numbers
where programme_stream = 'all'
   or study_term like '%/%';
