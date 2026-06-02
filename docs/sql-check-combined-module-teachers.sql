-- Combined module teachers check (replace academic_year as needed)
-- Run in Supabase SQL Editor

SELECT
  cg.combined_code,
  cg.module_term,
  tm.module_instance_code,
  ta.teacher_name AS assignment_teacher,
  ti.instance_teacher_name AS instance_teacher,
  (
    SELECT string_agg(member_line, ' | ' ORDER BY module_code)
    FROM (
      SELECT DISTINCT
        tpm.module_code AS module_code,
        tpm.module_code || ':' || COALESCE(mda.teacher_name, '(no default)') AS member_line
      FROM combine_group_modules cgm2
      JOIN timetable_planning_modules tpm ON tpm.id = cgm2.planning_module_id
      LEFT JOIN module_default_assignments mda
        ON mda.academic_year = cg.academic_year
       AND mda.module_code = tpm.module_code
       AND mda.programme_code = tpm.programme_code
       AND mda.stream_code = tpm.stream_code
      WHERE cgm2.combine_group_id = cg.id
    ) members
  ) AS members_upload_teacher,
  CASE
    WHEN ta.teacher_name IS NULL OR btrim(ta.teacher_name) = '' THEN 'MISSING assignment'
    WHEN upper(btrim(ta.teacher_name)) = 'TBC' THEN 'TBC in assignment'
    WHEN ti.instance_teacher_name IS NULL OR btrim(ti.instance_teacher_name) = '' THEN 'MISSING instance'
    WHEN upper(btrim(ti.instance_teacher_name)) = 'TBC' THEN 'TBC in instance'
    ELSE 'OK'
  END AS teacher_status
FROM combine_groups cg
JOIN timetable_modules tm
  ON tm.combine_group_id = cg.id
 AND tm.academic_year = cg.academic_year
LEFT JOIN teaching_assignments ta
  ON ta.timetable_module_id = tm.id
LEFT JOIN timetable_module_instances ti
  ON ti.academic_year = tm.academic_year
 AND ti.module_instance_code = tm.module_instance_code
WHERE cg.academic_year = '2026/2027'
ORDER BY cg.combined_code, tm.module_instance_code;
