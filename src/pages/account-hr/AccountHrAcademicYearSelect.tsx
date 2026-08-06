import { academicYearToStartYear, normalizeAcademicYear } from "../../lib/utils";
import {
  ACCOUNT_HR_DEFAULT_ACADEMIC_YEAR,
  accountHrAcademicYearOptions,
} from "./accountHrAcademicYear";

type Props = {
  value: string;
  onChange: (academicYear: string) => void;
  label: string;
};

function formatYearOption(academicYear: string) {
  const normalized = normalizeAcademicYear(academicYear);
  const start = academicYearToStartYear(normalized);
  if (!Number.isFinite(start)) return academicYear;
  return `${start}/${String(start + 1).slice(-2)}`;
}

export function AccountHrAcademicYearSelect({
  value,
  onChange,
  label,
}: Props) {
  const options = accountHrAcademicYearOptions();
  const selected = value || ACCOUNT_HR_DEFAULT_ACADEMIC_YEAR;

  return (
    <div className="max-w-xs">
      <label className="form-label">{label}</label>
      <select
        className="form-select"
        value={selected}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((year) => (
          <option key={year} value={year}>
            {formatYearOption(year)}
          </option>
        ))}
      </select>
    </div>
  );
}
