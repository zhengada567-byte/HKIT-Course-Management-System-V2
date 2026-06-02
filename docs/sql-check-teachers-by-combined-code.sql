-- Check teachers for a combined group by combined_code (not original module_code).
-- Replace academic_year / combined_code as needed.

-- 1) Combined group + split classes + assignment + instance teachers
SELECT
  cg.academic_year,
  cg.combined_code,
  cg.id AS combine_group_id,
  tm.id AS timetable_module_id,
  tm.module_instance_code,
  tm.base_module_code,
  tm.programme_code,
  tm.stream_code,
  ta.teacher_name AS assignment_teacher,
  ti.instance_teacher_name AS instance_teacher
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
  AND cg.combined_code = 'HD401_HDBA_HDC_HDCI_HDEE_HDHC_SEP'
ORDER BY tm.module_instance_code;

-- 2) Upload proposed teachers for each original member module in this combine group
SELECT
  cg.combined_code,
  tpm.module_code AS original_module_code,
  tpm.programme_code,
  tpm.stream_code,
  mda.teacher_name AS upload_proposed_teacher
FROM combine_groups cg
JOIN combine_group_modules cgm ON cgm.combine_group_id = cg.id
JOIN timetable_planning_modules tpm ON tpm.id = cgm.planning_module_id
LEFT JOIN module_default_assignments mda
  ON mda.academic_year = cg.academic_year
 AND mda.module_code = tpm.module_code
 AND mda.programme_code = tpm.programme_code
 AND mda.stream_code = tpm.stream_code
WHERE cg.academic_year = '2026/2027'
  AND cg.combined_code = 'HD401_HDBA_HDC_HDCI_HDEE_HDHC_SEP'
ORDER BY tpm.programme_code, tpm.module_code;
