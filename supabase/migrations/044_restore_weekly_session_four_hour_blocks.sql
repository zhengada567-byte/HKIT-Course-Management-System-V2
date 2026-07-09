-- Restore weekly timetable session blocks to standard 4-hour bands.
-- Daily L/T label logic had shortened some end_time values (2h/3h remainders).

UPDATE public.timetable_sessions
SET
  end_time = CASE
    WHEN start_time >= TIME '18:30' THEN TIME '22:30'
    WHEN start_time >= TIME '12:00' THEN TIME '18:00'
    ELSE (start_time + INTERVAL '4 hours')::time
  END,
  updated_at = NOW()
WHERE status IS DISTINCT FROM 'cancel'
  AND end_time IS NOT NULL
  AND end_time < (start_time + INTERVAL '4 hours');
