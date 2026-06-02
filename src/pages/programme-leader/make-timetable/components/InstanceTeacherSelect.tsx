import { isTBC } from "../../../../lib/utils";
import type { TeacherRow } from "../../../../types";

function stripTeacherTitle(value: string) {
  return value
    .trim()
    .replace(/^(mr|mrs|ms|dr|prof)\.?\s+/i, "")
    .trim();
}

function teacherNamesMatch(left: string, right: string) {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();

  if (a === b) return true;

  return stripTeacherTitle(a) === stripTeacherTitle(b);
}

/** Resolve <select> value when DB/upload name may differ from teachers catalog (e.g. Mr Ray Leung). */
export function resolveInstanceTeacherSelectValue(
  instanceTeacherName: string | null | undefined,
  teachers: TeacherRow[]
) {
  const raw = String(instanceTeacherName ?? "").trim();

  if (!raw || isTBC(raw)) {
    return "TBC";
  }

  const exact = teachers.find((teacher) => teacher.teacher_name === raw);
  if (exact) {
    return exact.teacher_name;
  }

  const fuzzy = teachers.find((teacher) =>
    teacherNamesMatch(teacher.teacher_name, raw)
  );
  if (fuzzy) {
    return fuzzy.teacher_name;
  }

  return raw;
}

export function InstanceTeacherSelect({
  value,
  teachers,
  onChange,
}: {
  value: string | null | undefined;
  teachers: TeacherRow[];
  onChange: (teacherName: string) => void;
}) {
  const selectedValue = resolveInstanceTeacherSelectValue(value, teachers);

  const hasCatalogMatch = teachers.some(
    (teacher) => teacher.teacher_name === selectedValue
  );

  const showUploadOption =
    selectedValue !== "TBC" && !hasCatalogMatch && !isTBC(selectedValue);

  return (
    <select
      className="form-select min-w-48"
      value={selectedValue}
      title={showUploadOption ? `From upload: ${selectedValue}` : "Teacher"}
      onChange={(event) => {
        onChange(event.target.value === "TBC" ? "TBC" : event.target.value);
      }}
    >
      <option value="TBC">TBC</option>

      {showUploadOption ? (
        <option value={selectedValue}>{selectedValue}</option>
      ) : null}

      {teachers.map((teacher) => (
        <option key={teacher.id} value={teacher.teacher_name}>
          {teacher.teacher_name} - {teacher.employment_type ?? "-"}
        </option>
      ))}
    </select>
  );
}
