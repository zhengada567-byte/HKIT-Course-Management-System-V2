import { useEffect, useMemo, useState } from "react";

import { TableViewport } from "../../components/tables/TableViewport";
import { FeatureUpdateLockBanner } from "../../components/admin/FeatureUpdateLockBanner";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAcademicYear } from "../../contexts/AcademicYearContext";
import { useAuth } from "../../contexts/AuthContext";
import { useFeatureUpdateLocks } from "../../contexts/FeatureUpdateLockContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { isTeacherExcludedFromScheduleDropdown } from "../../lib/timetableSchedulingRules";
import { cn, isTBC, formatAcademicYearShort, normalizeAcademicYear, normalizeStream, teacherDisplayNameFromRow } from "../../lib/utils";
import {
  buildModuleDefaultAssignmentInput,
  listProgrammeModuleTeacherRows,
  moduleDefaultAssignmentKey,
  normalizeTeachingStatus,
  teacherNameFromAssignment,
  upsertModuleDefaultAssignments,
  type ProgrammeModuleTeacherRow,
} from "../../services/moduleDefaultAssignmentService";
import {
  isModuleOfferingActive,
  loadPlanningOfferingByModuleId,
  syncModuleOfferingsFromTeacherAssignment,
} from "../../services/moduleTeacherOfferingService";
import { listProgrammes } from "../../services/programmeService";
import { listTeachers, upsertTeacher } from "../../services/teacherService";
import { listTeacherAvailabilitySaved } from "../../services/timetableTeacherAvailabilityService";
import { InstanceTeacherSelect } from "./make-timetable/components/InstanceTeacherSelect";
import { TeacherAvailabilityModal } from "./make-timetable/components/TeacherAvailabilityModal";
import type { EmploymentType, ModuleTerm, ProgrammeRow, TeacherRow, TeachingStatus } from "../../types";

const moduleTermOptions: ModuleTerm[] = ["Sep", "Feb", "Jun"];

type ModuleTeacherDraft = {
  teacherName: string;
  teachingStatus: TeachingStatus;
  offering: boolean;
};

function buildDraftFromRow(
  row: ProgrammeModuleTeacherRow,
  teachers: TeacherRow[],
  offeringActive: boolean
): ModuleTeacherDraft {
  return {
    teacherName: teacherNameFromAssignment(row.assignment, teachers),
    teachingStatus: row.assignment?.teaching_status ?? "PT",
    offering: offeringActive,
  };
}

function buildEmptyTeacherForm(academicYear: string) {
  return {
    title: "",
    family_name: "",
    other_name: "",
    employment_type: "PT" as EmploymentType,
    academic_year: academicYear,
  };
}

function proposedTeachersFromRows(
  rows: ProgrammeModuleTeacherRow[],
  drafts: Record<string, ModuleTeacherDraft>,
  teachers: TeacherRow[]
) {
  const names = new Set<string>();

  for (const row of rows) {
    const key = moduleDefaultAssignmentKey(
      row.module.module_code,
      row.module.stream_code
    );
    const draft = drafts[key] ?? buildDraftFromRow(row, teachers, true);
    const teacherName = String(draft.teacherName ?? "").trim();

    if (
      !teacherName ||
      isTBC(teacherName) ||
      isTeacherExcludedFromScheduleDropdown(teacherName)
    ) {
      continue;
    }

    names.add(teacherName);
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

export function ModuleTeacherAssignmentPage() {
  const { user } = useAuth();
  const {
    academicYear: currentAcademicYear,
    previousAcademicYear,
    currentOfferedTerm,
  } = useAcademicYear();
  const { t } = useLanguage();
  const { locks } = useFeatureUpdateLocks();
  const updatesLocked = locks.moduleTeacherLocked;
  const canUpdateTeachers = !updatesLocked;

  const [selectedAcademicYear, setSelectedAcademicYear] = useState(currentAcademicYear);
  const [programmes, setProgrammes] = useState<ProgrammeRow[]>([]);
  const [programmeCode, setProgrammeCode] = useState("");
  const [moduleTerm, setModuleTerm] = useState<ModuleTerm>(currentOfferedTerm);
  const [rows, setRows] = useState<ProgrammeModuleTeacherRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ModuleTeacherDraft>>({});
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [savedAvailabilityTeachers, setSavedAvailabilityTeachers] = useState<
    Set<string>
  >(() => new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creatingTeacher, setCreatingTeacher] = useState(false);
  const [showNewTeacherForm, setShowNewTeacherForm] = useState(false);
  const [teacherAvailabilityOpen, setTeacherAvailabilityOpen] = useState(false);
  const [newTeacherForm, setNewTeacherForm] = useState(
    buildEmptyTeacherForm(currentAcademicYear)
  );
  const [message, setMessage] = useState("");

  const normalizedCurrentYear = normalizeAcademicYear(currentAcademicYear);

  const academicYearOptions = useMemo(
    () => Array.from(new Set([currentAcademicYear, previousAcademicYear])),
    [currentAcademicYear, previousAcademicYear]
  );

  const isReadOnlyYear =
    normalizeAcademicYear(selectedAcademicYear) ===
    normalizeAcademicYear(previousAcademicYear);
  const canEditAssignments = !isReadOnlyYear && canUpdateTeachers;

  const programmeCodes = useMemo(() => {
    return Array.from(
      new Set(
        programmes
          .map((programme) => programme.programme_code?.trim())
          .filter(Boolean)
      )
    ).sort();
  }, [programmes]);

  const sortedTeachers = useMemo(
    () =>
      [...teachers].sort((left, right) =>
        left.teacher_name.localeCompare(right.teacher_name, undefined, {
          sensitivity: "base",
        })
      ),
    [teachers]
  );

  const teachersOnPage = useMemo(
    () => proposedTeachersFromRows(rows, drafts, teachers),
    [rows, drafts, teachers]
  );

  const canOpenTeacherAvailability =
    Boolean(programmeCode && moduleTerm) && rows.length > 0 && !loading;

  async function loadTeachers(year = selectedAcademicYear) {
    const data = await listTeachers(year);
    setTeachers(data);
  }

  async function loadProgrammes() {
    const data = await listProgrammes();
    setProgrammes(data);
  }

  async function refreshAvailabilityStatus(
    teacherNames: string[],
    year = selectedAcademicYear
  ) {
    if (teacherNames.length === 0) {
      setSavedAvailabilityTeachers(new Set());
      return;
    }

    const savedRows = await listTeacherAvailabilitySaved({
      academicYear: year,
      teacherNames,
    });

    const saved = new Set<string>();
    for (const row of savedRows) {
      const teacher = String(row.teacher_name ?? "").trim();
      if (teacher) saved.add(teacher);
    }
    setSavedAvailabilityTeachers(saved);
  }

  async function loadRows() {
    if (!programmeCode) {
      setMessage("Please select a programme code first.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const teacherRows = await listTeachers(selectedAcademicYear);

      const data = await listProgrammeModuleTeacherRows({
        academicYear: selectedAcademicYear,
        programmeCode,
        moduleTerm,
      });

      const offeringMap = await loadPlanningOfferingByModuleId({
        academicYear: selectedAcademicYear,
        programmeCode,
        moduleTerm,
      });

      const nextDrafts = Object.fromEntries(
        data.map((row) => [
          moduleDefaultAssignmentKey(row.module.module_code, row.module.stream_code),
          buildDraftFromRow(
            row,
            teacherRows,
            isModuleOfferingActive(offeringMap, row.module.id)
          ),
        ])
      );

      setTeachers(teacherRows);
      setRows(data);
      setDrafts(nextDrafts);

      const teacherNames = proposedTeachersFromRows(data, nextDrafts, teacherRows);
      await refreshAvailabilityStatus(teacherNames);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Load failed.");
      setRows([]);
      setDrafts({});
      setSavedAvailabilityTeachers(new Set());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProgrammes();
    void loadTeachers(currentAcademicYear);
  }, []);

  useEffect(() => {
    setModuleTerm(currentOfferedTerm);
  }, [currentOfferedTerm]);

  useEffect(() => {
    setNewTeacherForm(buildEmptyTeacherForm(selectedAcademicYear));
    setRows([]);
    setDrafts({});
    setSavedAvailabilityTeachers(new Set());
    void loadTeachers(selectedAcademicYear);
  }, [selectedAcademicYear]);

  function updateDraft(key: string, patch: Partial<ModuleTeacherDraft>) {
    setDrafts((prev) => ({
      ...prev,
      [key]: {
        teacherName: prev[key]?.teacherName ?? "TBC",
        teachingStatus: prev[key]?.teachingStatus ?? "PT",
        offering: prev[key]?.offering ?? true,
        ...patch,
      },
    }));
  }

  function handleTeacherChange(key: string, teacherName: string) {
    const catalogTeacher = teachers.find(
      (teacher) =>
        teacherDisplayNameFromRow(teacher) === teacherName ||
        teacher.teacher_name === teacherName
    );
    const employment = normalizeTeachingStatus(
      catalogTeacher?.employment_type ?? undefined
    );

    updateDraft(key, {
      teacherName,
      ...(employment ? { teachingStatus: employment } : {}),
    });
  }

  async function handleCreateTeacher(event: React.FormEvent) {
    event.preventDefault();

    if (!canEditAssignments) {
      setMessage(
        isReadOnlyYear
          ? t.moduleTeacherReadOnlyYear
          : t.featureUpdateLocksModuleTeacherBanner
      );
      return;
    }

    if (!newTeacherForm.family_name.trim()) {
      setMessage("Family name is required.");
      return;
    }

    setCreatingTeacher(true);
    setMessage("");

    try {
      const created = await upsertTeacher({
        title: newTeacherForm.title || null,
        family_name: newTeacherForm.family_name.trim(),
        other_name: newTeacherForm.other_name || null,
        employment_type: newTeacherForm.employment_type || "PT",
        academic_year: selectedAcademicYear,
      });

      setTeachers((previous) => {
        const withoutDuplicate = previous.filter(
          (teacher) => teacher.id !== created.id
        );

        return [...withoutDuplicate, created].sort((left, right) =>
          left.teacher_name.localeCompare(right.teacher_name, undefined, {
            sensitivity: "base",
          })
        );
      });

      await loadTeachers();
      setShowNewTeacherForm(false);
      setNewTeacherForm(buildEmptyTeacherForm(selectedAcademicYear));
      setMessage(
        `${created.teacher_name} 已加入教師名冊，可於下方「建議教師」下拉選單選用。`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Create teacher failed.");
    } finally {
      setCreatingTeacher(false);
    }
  }

  async function handleSaveAll() {
    if (!programmeCode || rows.length === 0) return;

    if (!canEditAssignments) {
      setMessage(
        isReadOnlyYear
          ? t.moduleTeacherReadOnlyYear
          : t.featureUpdateLocksModuleTeacherBanner
      );
      return;
    }

    if (!user?.id) {
      setMessage("Please login before saving.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const payload = rows.map((row) => {
        const key = moduleDefaultAssignmentKey(
          row.module.module_code,
          row.module.stream_code
        );
        const draft = drafts[key] ?? buildDraftFromRow(row, teachers, true);

        return buildModuleDefaultAssignmentInput({
          academicYear: selectedAcademicYear,
          module: row.module,
          teacherName: draft.teacherName,
          teachingStatus: draft.teachingStatus,
          teachers,
          mode: row.assignment?.mode,
        });
      });

      await upsertModuleDefaultAssignments(payload);
      await syncModuleOfferingsFromTeacherAssignment({
        academicYear: selectedAcademicYear,
        programmeCode,
        moduleTerm,
        createdBy: user.id,
        modules: rows.map((row) => row.module),
        offerings: rows.map((row) => {
          const key = moduleDefaultAssignmentKey(
            row.module.module_code,
            row.module.stream_code
          );
          const draft = drafts[key] ?? buildDraftFromRow(row, teachers, true);

          return {
            moduleId: row.module.id,
            offering: draft.offering,
          };
        }),
      });
      await loadRows();
      setMessage(`Saved proposed teachers and offering for ${payload.length} module(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTeacherAvailabilityClose() {
    setTeacherAvailabilityOpen(false);
    if (rows.length > 0) {
      await refreshAvailabilityStatus(teachersOnPage);
    }
  }

  const isBusy = loading || saving || creatingTeacher;
  const controlsDisabled = isBusy || !canEditAssignments;

  return (
    <div className="page-container">
      <PageHeader
        title={t.moduleTeacherAssignment}
        description={t.moduleTeacherAssignmentDescription}
      />

      {message && (
        <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {message}
        </div>
      )}

      {isReadOnlyYear && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t.moduleTeacherReadOnlyYear}
        </div>
      )}

      <FeatureUpdateLockBanner feature="moduleTeacher" locked={updatesLocked} />

      <div className="card mb-2">
        <div className="card-body flex flex-wrap items-end gap-3">
          <div className="w-full min-w-[5.5rem] flex-1 sm:max-w-[7rem]">
            <label className="form-label">{t.academicYear}</label>
            <select
              className={cn(
                "form-select",
                normalizeAcademicYear(selectedAcademicYear) === normalizedCurrentYear &&
                  "border-blue-500 font-semibold text-blue-900 ring-2 ring-blue-200"
              )}
              value={selectedAcademicYear}
              title={selectedAcademicYear}
              onChange={(event) => {
                setSelectedAcademicYear(event.target.value);
                setProgrammeCode("");
                setRows([]);
                setDrafts({});
              }}
              disabled={isBusy}
            >
              {academicYearOptions.map((year) => {
                const isCurrent =
                  normalizeAcademicYear(year) === normalizedCurrentYear;

                return (
                  <option
                    key={year}
                    value={year}
                    style={isCurrent ? { fontWeight: 700 } : undefined}
                  >
                    {formatAcademicYearShort(year)}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="w-full min-w-[9rem] flex-1 sm:max-w-[14rem]">
            <label className="form-label">{t.programmeCode}</label>
            <select
              className="form-select"
              value={programmeCode}
              title={t.programmeCode}
              onChange={(event) => {
                setProgrammeCode(event.target.value);
                setRows([]);
                setDrafts({});
              }}
              disabled={isBusy}
            >
              <option value="">{t.selectProgrammePlaceholder}</option>
              {programmeCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>

          <div className="w-full min-w-[9rem] flex-1 sm:max-w-[14rem]">
            <label className="form-label">{t.moduleTerm}</label>
            <select
              className="form-select"
              value={moduleTerm}
              title={t.moduleTerm}
              onChange={(event) => {
                setModuleTerm(event.target.value as ModuleTerm);
                setRows([]);
                setDrafts({});
              }}
              disabled={isBusy}
            >
              {moduleTermOptions.map((term) => (
                <option key={term} value={term}>
                  {term}
                </option>
              ))}
            </select>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-primary whitespace-nowrap"
              disabled={isBusy || !programmeCode}
              onClick={() => void loadRows()}
            >
              {loading ? t.loading : t.loadModuleTeachers}
            </button>

            <button
              type="button"
              className="btn btn-secondary whitespace-nowrap"
              disabled={!canOpenTeacherAvailability}
              title={
                canOpenTeacherAvailability
                  ? t.teacherAvailability
                  : t.teacherAvailabilitySelectFilters
              }
              onClick={() => setTeacherAvailabilityOpen(true)}
            >
              {t.teacherAvailability}
            </button>

            <button
              type="button"
              className="btn btn-secondary whitespace-nowrap"
              disabled={controlsDisabled}
              onClick={() => {
                setShowNewTeacherForm((open) => !open);
                setMessage("");
              }}
            >
              {t.newTeacher}
            </button>

            <button
              type="button"
              className="btn btn-secondary whitespace-nowrap"
              disabled={controlsDisabled || rows.length === 0}
              onClick={() => void handleSaveAll()}
            >
              {saving ? t.loading : t.saveAll}
            </button>
          </div>
        </div>
      </div>

      {showNewTeacherForm && canEditAssignments && (
        <form className="card mb-2" onSubmit={(event) => void handleCreateTeacher(event)}>
          <div className="card-body space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">{t.newTeacher}</h2>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowNewTeacherForm(false)}
                disabled={creatingTeacher}
              >
                {t.cancel}
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <label className="form-label">{t.teacherTitle}</label>
                <input
                  className="form-input"
                  value={newTeacherForm.title}
                  placeholder="Dr / Mr / Ms"
                  onChange={(event) =>
                    setNewTeacherForm((prev) => ({
                      ...prev,
                      title: event.target.value,
                    }))
                  }
                />
              </div>

              <div>
                <label className="form-label">{t.teacherFamilyName}</label>
                <input
                  className="form-input"
                  required
                  value={newTeacherForm.family_name}
                  onChange={(event) =>
                    setNewTeacherForm((prev) => ({
                      ...prev,
                      family_name: event.target.value,
                    }))
                  }
                />
              </div>

              <div>
                <label className="form-label">{t.teacherOtherName}</label>
                <input
                  className="form-input"
                  value={newTeacherForm.other_name}
                  onChange={(event) =>
                    setNewTeacherForm((prev) => ({
                      ...prev,
                      other_name: event.target.value,
                    }))
                  }
                />
              </div>

              <div>
                <label className="form-label">{t.teacherEmploymentStatus}</label>
                <select
                  className="form-select"
                  value={newTeacherForm.employment_type ?? "PT"}
                  title={t.teacherEmploymentStatus}
                  onChange={(event) =>
                    setNewTeacherForm((prev) => ({
                      ...prev,
                      employment_type: event.target.value as EmploymentType,
                    }))
                  }
                >
                  <option value="PT">PT</option>
                  <option value="FT">FT</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={creatingTeacher}
            >
              {creatingTeacher ? t.loading : t.create}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          {programmeCode
            ? t.moduleTeacherAssignmentEmpty
            : t.moduleTeacherAssignmentSelectProgramme}
        </p>
      ) : (
        <TableViewport size="courseSearch" className="min-h-[24rem] w-full">
          <table className="data-table min-w-max text-sm">
            <thead>
              <tr>
                <th>{t.moduleCode}</th>
                <th>{t.moduleName}</th>
                <th>{t.moduleTerm}</th>
                <th>{t.programmeStream}</th>
                <th>{t.proposedTeacher}</th>
                <th>{t.teachingStatusForThisModule}</th>
                <th>{t.moduleYear}</th>
                <th>{t.moduleOfferingThisYear}</th>
                <th>{t.teacherAvailability}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const key = moduleDefaultAssignmentKey(
                  row.module.module_code,
                  row.module.stream_code
                );
                const draft = drafts[key] ?? buildDraftFromRow(row, teachers, true);
                const teacherName = String(draft.teacherName ?? "").trim();
                const showAvailabilityStatus =
                  teacherName &&
                  !isTBC(teacherName) &&
                  !isTeacherExcludedFromScheduleDropdown(teacherName);
                const availabilitySaved =
                  showAvailabilityStatus &&
                  savedAvailabilityTeachers.has(teacherName);

                return (
                  <tr key={key}>
                    <td className="font-mono whitespace-nowrap">
                      {row.module.module_code}
                    </td>
                    <td className="whitespace-nowrap">
                      {row.module.module_name ?? "-"}
                    </td>
                    <td className="whitespace-nowrap">{row.module.module_term}</td>
                    <td className="whitespace-nowrap">
                      {normalizeStream(row.module.stream_code)}
                    </td>
                    <td>
                      <InstanceTeacherSelect
                        value={draft.teacherName}
                        teachers={sortedTeachers}
                        disabled={!canEditAssignments}
                        onChange={(nextTeacherName) =>
                          handleTeacherChange(key, nextTeacherName)
                        }
                      />
                    </td>
                    <td>
                      <select
                        className="form-select min-w-20"
                        value={draft.teachingStatus}
                        title={t.teachingStatusForThisModule}
                        disabled={!canEditAssignments}
                        onChange={(event) =>
                          updateDraft(key, {
                            teachingStatus: event.target.value as TeachingStatus,
                          })
                        }
                      >
                        <option value="PT">PT</option>
                        <option value="FT">FT</option>
                      </select>
                    </td>
                    <td className="whitespace-nowrap">
                      {String(row.module.module_year ?? "").trim() || "—"}
                    </td>
                    <td>
                      <select
                        className="form-select min-w-28"
                        value={draft.offering ? "yes" : "no"}
                        title={t.moduleOfferingThisYear}
                        disabled={!canEditAssignments}
                        onChange={(event) =>
                          updateDraft(key, {
                            offering: event.target.value === "yes",
                          })
                        }
                      >
                        <option value="yes">{t.moduleOfferingYes}</option>
                        <option value="no">{t.moduleOfferingNo}</option>
                      </select>
                    </td>
                    <td className="whitespace-nowrap">
                      {!showAvailabilityStatus ? (
                        <span className="text-slate-400">—</span>
                      ) : availabilitySaved ? (
                        <span className="text-emerald-700">{t.teacherAvailabilitySaved}</span>
                      ) : (
                        <span className="text-amber-700">{t.teacherAvailabilityMissing}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableViewport>
      )}

      <TeacherAvailabilityModal
        academicYear={selectedAcademicYear}
        open={teacherAvailabilityOpen}
        onClose={() => void handleTeacherAvailabilityClose()}
        teacherNames={teachersOnPage}
        readOnly={isReadOnlyYear}
      />
    </div>
  );
}
