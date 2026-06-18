import {
  isTBC,
  resolveTeacherNameToCatalog,
} from "../../../../lib/utils";
import type { TeacherRow } from "../../../../types";

/** Resolve <select> value to a canonical teachers-catalog name when possible. */
export function resolveInstanceTeacherSelectValue(
  instanceTeacherName: string | null | undefined,
  teachers: TeacherRow[]
) {
  const raw = String(instanceTeacherName ?? "").trim();

  if (!raw || isTBC(raw)) {
    return "TBC";
  }

  const catalogName = resolveTeacherNameToCatalog(raw, teachers);
  if (catalogName) {
    return catalogName;
  }

  return "TBC";
}

export function InstanceTeacherSelect({
  value,
  teachers,
  onChange,
  disabled = false,
}: {
  value: string | null | undefined;
  teachers: TeacherRow[];
  onChange: (teacherName: string) => void;
  disabled?: boolean;
}) {
  const selectedValue = resolveInstanceTeacherSelectValue(value, teachers);

  return (
    <select
      className="form-select min-w-48"
      value={selectedValue}
      disabled={disabled}
      title="Teacher"
      onChange={(event) => {
        onChange(event.target.value === "TBC" ? "TBC" : event.target.value);
      }}
    >
      <option value="TBC">TBC</option>

      {teachers.map((teacher) => (
        <option key={teacher.id} value={teacher.teacher_name}>
          {teacher.teacher_name}
        </option>
      ))}
    </select>
  );
}
