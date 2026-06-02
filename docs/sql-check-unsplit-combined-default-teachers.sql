-- Unsplit combined groups: do they carry Proposed Teacher from module upload?
-- Replace academic_year if needed. Run with "No limit".

-- A) One row per combine group (not yet split)
SELECT
  cg.academic_year,
  cg.combined_code,
  cg.module_term,
  cg.status AS combine_status,
  COUNT(DISTINCT cgm.planning_module_id) AS member_modules,
  COUNT(DISTINCT mda.id) AS rows_with_default_assignment,
  COUNT(DISTINCT CASE
    WHEN mda.teacher_name IS NOT NULL AND btrim(mda.teacher_name) <> '' AND upper(btrim(mda.teacher_name)) <> 'TBC'
    THEN mda.id
  END) AS members_with_real_teacher,
  string_agg(
    DISTINCT NULLIF(btrim(mda.teacher_name), ''),
    '; ' ORDER BY NULLIF(btrim(mda.teacher_name), '')
  ) FILTER (WHERE mda.teacher_name IS NOT NULL AND btrim(mda.teacher_name) <> '') AS distinct_upload_teachers,
  CASE
    WHEN COUNT(DISTINCT cgm.planning_module_id) = 0 THEN 'no members'
    WHEN COUNT(DISTINCT mda.id) = 0 THEN 'no module_default_assignments match'
    WHEN COUNT(DISTINCT CASE
      WHEN mda.teacher_name IS NULL OR btrim(mda.teacher_name) = '' OR upper(btrim(mda.teacher_name)) = 'TBC'
      THEN cgm.planning_module_id
    END) = COUNT(DISTINCT cgm.planning_module_id) THEN 'all TBC or empty'
    ELSE 'has proposed teacher(s)'
  END AS default_teacher_summary
FROM combine_groups cg
JOIN combine_group_modules cgm ON cgm.combine_group_id = cg.id
JOIN timetable_planning_modules tpm ON tpm.id = cgm.planning_module_id
LEFT JOIN module_default_assignments mda
  ON mda.academic_year = cg.academic_year
 AND mda.module_code = tpm.module_code
 AND mda.programme_code = tpm.programme_code
 AND mda.stream_code = tpm.stream_code
WHERE cg.academic_year = '2026/2027'
  AND NOT EXISTS (
    SELECT 1
    FROM timetable_modules tm
    WHERE tm.academic_year = cg.academic_year
      AND tm.combine_group_id = cg.id
  )
GROUP BY cg.id, cg.academic_year, cg.combined_code, cg.module_term, cg.status
ORDER BY cg.combined_code;

-- B) Detail: each member module in unsplit combine groups
SELECT
  cg.combined_code,
  tpm.module_code,
  tpm.programme_code,
  tpm.stream_code,
  tpm.module_term,
  mda.teacher_name AS upload_proposed_teacher,
  mda.teaching_status,
  mda.mode
FROM combine_groups cg
JOIN combine_group_modules cgm ON cgm.combine_group_id = cg.id
JOIN timetable_planning_modules tpm ON tpm.id = cgm.planning_module_id
LEFT JOIN module_default_assignments mda
  ON mda.academic_year = cg.academic_year
 AND mda.module_code = tpm.module_code
 AND mda.programme_code = tpm.programme_code
 AND mda.stream_code = tpm.stream_code
WHERE cg.academic_year = '2026/2027'
  AND NOT EXISTS (
    SELECT 1
    FROM timetable_modules tm
    WHERE tm.academic_year = cg.academic_year
      AND tm.combine_group_id = cg.id
  )
ORDER BY cg.combined_code, tpm.module_code;
