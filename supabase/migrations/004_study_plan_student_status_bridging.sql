-- Allow bridging as a study_plan_students.student_status value (Degree students).

alter table public.study_plan_students
  drop constraint if exists study_plan_students_student_status_check;

alter table public.study_plan_students
  add constraint study_plan_students_student_status_check
  check (
    student_status in (
      'potential',
      'bridging',
      'in_progress',
      'graduated'
    )
  );
