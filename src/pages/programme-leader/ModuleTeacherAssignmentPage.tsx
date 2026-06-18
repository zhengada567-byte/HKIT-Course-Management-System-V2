import { useEffect, useMemo, useState } from "react";

import { TableViewport } from "../../components/tables/TableViewport";
import { FeatureUpdateLockBanner } from "../../components/admin/FeatureUpdateLockBanner";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAcademicYear } from "../../contexts/AcademicYearContext";
import { useFeatureUpdateLocks } from "../../contexts/FeatureUpdateLockContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { normalizeStream } from "../../lib/utils";
import {
  buildModuleDefaultAssignmentInput,
  listProgrammeModuleTeacherRows,
  moduleDefaultAssignmentKey,
  normalizeTeachingStatus,
  teacherNameFromAssignment,
  upsertModuleDefaultAssignments,
  type ProgrammeModuleTeacherRow,
} from "../../services/moduleDefaultAssignmentService";
import { listProgrammes } from "../../services/programmeService";
import { listTeachers, upsertTeacher } from "../../services/teacherService";
import { InstanceTeacherSelect } from "./make-timetable/components/InstanceTeacherSelect";
import type { EmploymentType, ModuleTerm, ProgrammeRow, TeacherRow, TeachingStatus } from "../../types";

const moduleTermOptions: ModuleTerm[] = ["Sep", "Feb", "Jun"];

type ModuleTeacherDraft = {
  teacherName: string;
  teachingStatus: TeachingStatus;
};

function buildDraftFromRow(row: ProgrammeModuleTeacherRow): ModuleTeacherDraft {
  return {
    teacherName: teacherNameFromAssignment(row.assignment),
    teachingStatus: row.assignment?.teaching_status ?? "PT",
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

export function ModuleTeacherAssignmentPage() {
  const { academicYear, currentOfferedTerm } = useAcademicYear();
  const { t } = useLanguage();
  const { locks } = useFeatureUpdateLocks();
  const updatesLocked = locks.moduleTeacherLocked;
  const canUpdateTeachers = !updatesLocked;

  const [programmes, setProgrammes] = useState<ProgrammeRow[]>([]);
  const [programmeCode, setProgrammeCode] = useState("");
  const [streamCode, setStreamCode] = useState("");
  const [moduleTerm, setModuleTerm] = useState<ModuleTerm>(currentOfferedTerm);
  const [rows, setRows] = useState<ProgrammeModuleTeacherRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ModuleTeacherDraft>>({});
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creatingTeacher, setCreatingTeacher] = useState(false);
  const [showNewTeacherForm, setShowNewTeacherForm] = useState(false);
  const [newTeacherForm, setNewTeacherForm] = useState(buildEmptyTeacherForm(academicYear));
  const [message, setMessage] = useState("");

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

  const streamOptions = useMemo(() => {
    if (!programmeCode) return [];

    return Array.from(
      new Set(
        programmes
          .filter((programme) => programme.programme_code === programmeCode)
          .map((programme) => normalizeStream(programme.programme_stream))
      )
    ).sort();
  }, [programmes, programmeCode]);

  async function loadTeachers() {
    const data = await listTeachers(academicYear);
    setTeachers(data);
  }

  async function loadProgrammes() {
    const data = await listProgrammes();
    setProgrammes(data);
  }

  async function loadRows() {
    if (!programmeCode) {
      setMessage("Please select a programme code first.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const data = await listProgrammeModuleTeacherRows({
        academicYear,
        programmeCode,
        streamCode: streamCode || undefined,
        moduleTerm,
      });

      setRows(data);
      setDrafts(
        Object.fromEntries(
          data.map((row) => [
            moduleDefaultAssignmentKey(row.module.module_code, row.module.stream_code),
            buildDraftFromRow(row),
          ])
        )
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Load failed.");
      setRows([]);
      setDrafts({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProgrammes();
    void loadTeachers();
  }, []);

  useEffect(() => {
    setNewTeacherForm(buildEmptyTeacherForm(academicYear));
    setModuleTerm(currentOfferedTerm);
    void loadTeachers();
  }, [academicYear, currentOfferedTerm]);

  function updateDraft(
    key: string,
    patch: Partial<ModuleTeacherDraft>
  ) {
    setDrafts((prev) => ({
      ...prev,
      [key]: {
        teacherName: prev[key]?.teacherName ?? "TBC",
        teachingStatus: prev[key]?.teachingStatus ?? "PT",
        ...patch,
      },
    }));
  }

  function handleTeacherChange(key: string, teacherName: string) {
    const catalogTeacher = teachers.find(
      (teacher) => teacher.teacher_name === teacherName
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

    if (!canUpdateTeachers) {
      setMessage(t.featureUpdateLocksModuleTeacherBanner);
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
        academic_year: academicYear,
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
      setNewTeacherForm(buildEmptyTeacherForm(academicYear));
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

    if (!canUpdateTeachers) {
      setMessage(t.featureUpdateLocksModuleTeacherBanner);
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
        const draft = drafts[key] ?? buildDraftFromRow(row);

        return buildModuleDefaultAssignmentInput({
          academicYear,
          module: row.module,
          teacherName: draft.teacherName,
          teachingStatus: draft.teachingStatus,
          teachers,
          mode: row.assignment?.mode,
        });
      });

      await upsertModuleDefaultAssignments(payload);
      await loadRows();
      setMessage(`Saved proposed teachers for ${payload.length} module(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  const isBusy = loading || saving || creatingTeacher;
  const controlsDisabled = isBusy || !canUpdateTeachers;

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

      <FeatureUpdateLockBanner feature="moduleTeacher" locked={updatesLocked} />

      <div className="card mb-2">
        <div className="card-body flex flex-wrap items-end gap-3">
          <div className="w-full min-w-[9rem] flex-1 sm:max-w-[14rem]">
            <label className="form-label">{t.programmeCode}</label>
            <select
              className="form-select"
              value={programmeCode}
              onChange={(event) => {
                setProgrammeCode(event.target.value);
                setStreamCode("");
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

          <div className="w-full min-w-[9rem] flex-1 sm:max-w-[14rem]">
            <label className="form-label">{t.programmeStream}</label>
            <select
              className="form-select"
              value={streamCode}
              onChange={(event) => setStreamCode(event.target.value)}
              disabled={isBusy || !programmeCode}
            >
              <option value="">{t.allStreams}</option>
              {streamOptions.map((stream) => (
                <option key={stream} value={stream}>
                  {stream}
                </option>
              ))}
            </select>
          </div>

          <div className="flex shrink-0 flex-nowrap items-center gap-2">
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

      {showNewTeacherForm && canUpdateTeachers && (
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
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const key = moduleDefaultAssignmentKey(
                  row.module.module_code,
                  row.module.stream_code
                );
                const draft = drafts[key] ?? buildDraftFromRow(row);

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
                        disabled={!canUpdateTeachers}
                        onChange={(teacherName) =>
                          handleTeacherChange(key, teacherName)
                        }
                      />
                    </td>
                    <td>
                      <select
                        className="form-select min-w-20"
                        value={draft.teachingStatus}
                        disabled={!canUpdateTeachers}
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableViewport>
      )}
    </div>
  );
}
