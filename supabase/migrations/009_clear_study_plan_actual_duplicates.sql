-- Optional one-time cleanup (faster than waiting for app orphan-delete on 6000+ rows).
-- Safe anytime: Study Plan Sync / recalculateActualStudentNumbers repopulates from study_plan_modules.
--
-- Alternative: skip this file and run Sync once; upsert + orphan delete trims the table automatically.

truncate table public.study_plan_actual_student_numbers;
