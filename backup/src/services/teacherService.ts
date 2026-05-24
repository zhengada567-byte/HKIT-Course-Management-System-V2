import { supabase } from "../lib/supabase";
import { buildTeacherName, isTBC } from "../lib/utils";
import type { EmploymentType, TeacherRow } from "../types";

export interface TeacherInput {
  title?: string | null;
  family_name: string;
  other_name?: string | null;
  employment_type?: EmploymentType | null;
  academic_year: string;
}

export async function listTeachers(academicYear: string) {
  const { data, error } = await supabase
    .from("teachers")
    .select("*")
    .eq("academic_year", academicYear)
    .order("teacher_name");

  if (error) throw error;

  return (data ?? []) as TeacherRow[];
}

export async function upsertTeacher(input: TeacherInput) {
  const teacherName = buildTeacherName(
    input.title,
    input.family_name,
    input.other_name
  );

  if (!teacherName) {
    throw new Error("Teacher name is required");
  }

  if (isTBC(teacherName)) {
    throw new Error("TBC must not be stored in teachers table");
  }

  const payload = {
    title: input.title?.trim() || null,
    family_name: input.family_name.trim(),
    other_name: input.other_name?.trim() || null,
    teacher_name: teacherName,
    employment_type: input.employment_type || null,
    academic_year: input.academic_year,
  };

  const { data, error } = await supabase
    .from("teachers")
    .upsert(payload, {
      onConflict: "teacher_name,academic_year",
    })
    .select()
    .single();

  if (error) throw error;

  return data as TeacherRow;
}

export async function deleteTeacher(id: string) {
  const { error } = await supabase.from("teachers").delete().eq("id", id);

  if (error) throw error;
}
