import { useEffect, useMemo, useState } from "react";

import { DataTable } from "../../components/tables/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAcademicYear } from "../../contexts/AcademicYearContext";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { PROGRAMME_YEAR_OPTIONS } from "../../lib/programmeYear";
import { teacherDisplayNameFromRow } from "../../lib/utils";
import {
  deleteProgrammeHourlyRate,
  deleteSpecialHourlyRate,
  deleteTeacherHourlyRate,
  listProgrammeHourlyRates,
  listSpecialHourlyRates,
  listTeacherHourlyRates,
  upsertProgrammeHourlyRate,
  upsertSpecialHourlyRate,
  upsertTeacherHourlyRate,
  type ProgrammeHourlyRateRow,
  type SpecialHourlyRateRow,
  type TeacherHourlyRateRow,
} from "../../services/hourlyRateService";
import { listProgrammes } from "../../services/programmeService";
import { listTeachers } from "../../services/teacherService";
import type { EmploymentType, ProgrammeRow, TeacherRow } from "../../types";

type TabKey = "programme" | "special" | "teacher";

function uniqueProgrammeCodes(programmes: ProgrammeRow[]) {
  return Array.from(
    new Set(
      programmes
        .map((row) => String(row.programme_code ?? "").trim().toUpperCase())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
}

export function HourlyRatesPage() {
  const { academicYear } = useAcademicYear();
  const { user } = useAuth();
  const { t } = useLanguage();

  const [tab, setTab] = useState<TabKey>("programme");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [programmes, setProgrammes] = useState<ProgrammeRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [programmeRates, setProgrammeRates] = useState<ProgrammeHourlyRateRow[]>(
    []
  );
  const [specialRates, setSpecialRates] = useState<SpecialHourlyRateRow[]>([]);
  const [teacherRates, setTeacherRates] = useState<TeacherHourlyRateRow[]>([]);

  const [programmeForm, setProgrammeForm] = useState({
    id: "" as string,
    programmeCode: "",
    programmeYear: "Y1",
    hourlyRate: "",
    notes: "",
  });
  const [specialForm, setSpecialForm] = useState({
    id: "" as string,
    rateName: "",
    programmeCode: "",
    hourlyRate: "",
    notes: "",
  });
  const [teacherForm, setTeacherForm] = useState({
    id: "" as string,
    teacherName: "",
    employmentType: "" as EmploymentType | "",
    employmentFilter: "ALL" as "ALL" | EmploymentType,
    hourlyRate: "",
    notes: "",
  });

  const programmeCodes = useMemo(
    () => uniqueProgrammeCodes(programmes),
    [programmes]
  );

  const filteredTeachers = useMemo(() => {
    return teachers
      .filter((row) => {
        if (teacherForm.employmentFilter === "ALL") return true;
        return (
          String(row.employment_type ?? "").toUpperCase() ===
          teacherForm.employmentFilter
        );
      })
      .slice()
      .sort((a, b) =>
        teacherDisplayNameFromRow(a).localeCompare(
          teacherDisplayNameFromRow(b)
        )
      );
  }, [teachers, teacherForm.employmentFilter]);

  async function loadAll() {
    setLoading(true);
    setMessage("");

    try {
      const [
        programmeRows,
        teacherRows,
        programmeRateRows,
        specialRateRows,
        teacherRateRows,
      ] = await Promise.all([
        listProgrammes(),
        listTeachers(academicYear),
        listProgrammeHourlyRates(academicYear),
        listSpecialHourlyRates(academicYear),
        listTeacherHourlyRates(academicYear),
      ]);

      setProgrammes(programmeRows);
      setTeachers(teacherRows);
      setProgrammeRates(programmeRateRows);
      setSpecialRates(specialRateRows);
      setTeacherRates(teacherRateRows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    setProgrammeForm({
      id: "",
      programmeCode: "",
      programmeYear: "Y1",
      hourlyRate: "",
      notes: "",
    });
    setSpecialForm({
      id: "",
      rateName: "",
      programmeCode: "",
      hourlyRate: "",
      notes: "",
    });
    setTeacherForm({
      id: "",
      teacherName: "",
      employmentType: "",
      employmentFilter: "ALL",
      hourlyRate: "",
      notes: "",
    });
  }, [academicYear]);

  async function saveProgrammeRate(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      await upsertProgrammeHourlyRate({
        id: programmeForm.id || undefined,
        academicYear,
        programmeCode: programmeForm.programmeCode,
        programmeYear: programmeForm.programmeYear,
        hourlyRate: programmeForm.hourlyRate,
        notes: programmeForm.notes,
        updatedBy: user?.id ?? null,
      });
      setProgrammeForm({
        id: "",
        programmeCode: "",
        programmeYear: "Y1",
        hourlyRate: "",
        notes: "",
      });
      await loadAll();
      setMessage(t.hourlyRateSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveSpecialRate(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      await upsertSpecialHourlyRate({
        id: specialForm.id || undefined,
        academicYear,
        rateName: specialForm.rateName,
        programmeCode: specialForm.programmeCode,
        hourlyRate: specialForm.hourlyRate,
        notes: specialForm.notes,
        updatedBy: user?.id ?? null,
      });
      setSpecialForm({
        id: "",
        rateName: "",
        programmeCode: "",
        hourlyRate: "",
        notes: "",
      });
      await loadAll();
      setMessage(t.hourlyRateSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveTeacherRate(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      await upsertTeacherHourlyRate({
        id: teacherForm.id || undefined,
        academicYear,
        teacherName: teacherForm.teacherName,
        employmentType: teacherForm.employmentType || null,
        hourlyRate: teacherForm.hourlyRate,
        notes: teacherForm.notes,
        updatedBy: user?.id ?? null,
      });
      setTeacherForm((prev) => ({
        ...prev,
        id: "",
        teacherName: "",
        employmentType: "",
        hourlyRate: "",
        notes: "",
      }));
      await loadAll();
      setMessage(t.hourlyRateSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function onTeacherPick(name: string) {
    const teacher = teachers.find(
      (row) =>
        teacherDisplayNameFromRow(row) === name || row.teacher_name === name
    );
    const employment = String(teacher?.employment_type ?? "")
      .trim()
      .toUpperCase();

    setTeacherForm((prev) => ({
      ...prev,
      teacherName: name,
      employmentType:
        employment === "FT" || employment === "PT"
          ? (employment as EmploymentType)
          : "",
    }));
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: "programme", label: t.programmeHourlyRates },
    { key: "special", label: t.specialHourlyRates },
    { key: "teacher", label: t.teacherHourlyRates },
  ];

  return (
    <div className="page-container">
      <PageHeader
        title={t.hourlyRatesTitle}
        description={t.hourlyRatesDescription}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
              tab === item.key
                ? "border-blue-600 bg-blue-50 text-blue-700"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
            onClick={() => {
              setTab(item.key);
              setMessage("");
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {message && (
        <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {message}
        </div>
      )}

      {loading ? (
        <LoadingState />
      ) : (
        <>
          {tab === "programme" && (
            <div className="space-y-4">
              <form className="card" onSubmit={saveProgrammeRate}>
                <div className="card-body grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <div>
                    <label className="form-label">{t.programmeCode}</label>
                    <select
                      className="form-select"
                      value={programmeForm.programmeCode}
                      onChange={(event) =>
                        setProgrammeForm((prev) => ({
                          ...prev,
                          programmeCode: event.target.value,
                        }))
                      }
                      required
                    >
                      <option value="">{t.selectProgramme}</option>
                      {programmeCodes.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">{t.programmeYear}</label>
                    <select
                      className="form-select"
                      value={programmeForm.programmeYear}
                      onChange={(event) =>
                        setProgrammeForm((prev) => ({
                          ...prev,
                          programmeYear: event.target.value,
                        }))
                      }
                    >
                      {PROGRAMME_YEAR_OPTIONS.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">{t.hourlyRate}</label>
                    <input
                      className="form-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={programmeForm.hourlyRate}
                      onChange={(event) =>
                        setProgrammeForm((prev) => ({
                          ...prev,
                          hourlyRate: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">{t.notes}</label>
                    <input
                      className="form-input"
                      value={programmeForm.notes}
                      onChange={(event) =>
                        setProgrammeForm((prev) => ({
                          ...prev,
                          notes: event.target.value,
                        }))
                      }
                      placeholder="e.g. HDC Y1 standard"
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <button
                      className="btn btn-primary"
                      type="submit"
                      disabled={saving}
                    >
                      {saving ? t.loading : t.save}
                    </button>
                    {programmeForm.id && (
                      <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={() =>
                          setProgrammeForm({
                            id: "",
                            programmeCode: "",
                            programmeYear: "Y1",
                            hourlyRate: "",
                            notes: "",
                          })
                        }
                      >
                        {t.cancel}
                      </button>
                    )}
                  </div>
                </div>
              </form>

              {programmeRates.length === 0 ? (
                <EmptyState message={t.noHourlyRatesYet} />
              ) : (
                <DataTable
                  rowKey={(row) => row.id}
                  rows={programmeRates}
                  columns={[
                    {
                      key: "programme",
                      header: t.programmeCode,
                      render: (row) => row.programme_code,
                    },
                    {
                      key: "year",
                      header: t.programmeYear,
                      render: (row) => row.programme_year,
                    },
                    {
                      key: "rate",
                      header: t.hourlyRate,
                      render: (row) => Number(row.hourly_rate).toFixed(2),
                    },
                    {
                      key: "notes",
                      header: t.notes,
                      render: (row) => row.notes ?? "-",
                    },
                    {
                      key: "actions",
                      header: t.actions,
                      render: (row) => (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() =>
                              setProgrammeForm({
                                id: row.id,
                                programmeCode: row.programme_code,
                                programmeYear: row.programme_year,
                                hourlyRate: String(row.hourly_rate),
                                notes: row.notes ?? "",
                              })
                            }
                          >
                            {t.edit}
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={async () => {
                              if (!window.confirm(t.confirmDeleteHourlyRate)) {
                                return;
                              }
                              try {
                                await deleteProgrammeHourlyRate(row.id);
                                await loadAll();
                              } catch (error) {
                                setMessage(
                                  error instanceof Error
                                    ? error.message
                                    : "Delete failed"
                                );
                              }
                            }}
                          >
                            {t.delete}
                          </button>
                        </div>
                      ),
                    },
                  ]}
                />
              )}
            </div>
          )}

          {tab === "special" && (
            <div className="space-y-4">
              <form className="card" onSubmit={saveSpecialRate}>
                <div className="card-body grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <div>
                    <label className="form-label">{t.specialRateName}</label>
                    <input
                      className="form-input"
                      value={specialForm.rateName}
                      onChange={(event) =>
                        setSpecialForm((prev) => ({
                          ...prev,
                          rateName: event.target.value,
                        }))
                      }
                      placeholder="e.g. Night class / Bridging"
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">{t.programmeCode}</label>
                    <select
                      className="form-select"
                      value={specialForm.programmeCode}
                      onChange={(event) =>
                        setSpecialForm((prev) => ({
                          ...prev,
                          programmeCode: event.target.value,
                        }))
                      }
                    >
                      <option value="">{t.optional}</option>
                      {programmeCodes.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">{t.hourlyRate}</label>
                    <input
                      className="form-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={specialForm.hourlyRate}
                      onChange={(event) =>
                        setSpecialForm((prev) => ({
                          ...prev,
                          hourlyRate: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">{t.notes}</label>
                    <input
                      className="form-input"
                      value={specialForm.notes}
                      onChange={(event) =>
                        setSpecialForm((prev) => ({
                          ...prev,
                          notes: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <button
                      className="btn btn-primary"
                      type="submit"
                      disabled={saving}
                    >
                      {saving ? t.loading : t.save}
                    </button>
                    {specialForm.id && (
                      <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={() =>
                          setSpecialForm({
                            id: "",
                            rateName: "",
                            programmeCode: "",
                            hourlyRate: "",
                            notes: "",
                          })
                        }
                      >
                        {t.cancel}
                      </button>
                    )}
                  </div>
                </div>
              </form>

              {specialRates.length === 0 ? (
                <EmptyState message={t.noHourlyRatesYet} />
              ) : (
                <DataTable
                  rowKey={(row) => row.id}
                  rows={specialRates}
                  columns={[
                    {
                      key: "name",
                      header: t.specialRateName,
                      render: (row) => row.rate_name,
                    },
                    {
                      key: "programme",
                      header: t.programmeCode,
                      render: (row) => row.programme_code ?? "-",
                    },
                    {
                      key: "rate",
                      header: t.hourlyRate,
                      render: (row) => Number(row.hourly_rate).toFixed(2),
                    },
                    {
                      key: "notes",
                      header: t.notes,
                      render: (row) => row.notes ?? "-",
                    },
                    {
                      key: "actions",
                      header: t.actions,
                      render: (row) => (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() =>
                              setSpecialForm({
                                id: row.id,
                                rateName: row.rate_name,
                                programmeCode: row.programme_code ?? "",
                                hourlyRate: String(row.hourly_rate),
                                notes: row.notes ?? "",
                              })
                            }
                          >
                            {t.edit}
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={async () => {
                              if (!window.confirm(t.confirmDeleteHourlyRate)) {
                                return;
                              }
                              try {
                                await deleteSpecialHourlyRate(row.id);
                                await loadAll();
                              } catch (error) {
                                setMessage(
                                  error instanceof Error
                                    ? error.message
                                    : "Delete failed"
                                );
                              }
                            }}
                          >
                            {t.delete}
                          </button>
                        </div>
                      ),
                    },
                  ]}
                />
              )}
            </div>
          )}

          {tab === "teacher" && (
            <div className="space-y-4">
              <form className="card" onSubmit={saveTeacherRate}>
                <div className="card-body grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                  <div>
                    <label className="form-label">{t.teacherEmploymentFilter}</label>
                    <select
                      className="form-select"
                      value={teacherForm.employmentFilter}
                      onChange={(event) =>
                        setTeacherForm((prev) => ({
                          ...prev,
                          employmentFilter: event.target.value as
                            | "ALL"
                            | EmploymentType,
                        }))
                      }
                    >
                      <option value="ALL">{t.allTeachers}</option>
                      <option value="FT">FT</option>
                      <option value="PT">PT</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">{t.teacherName}</label>
                    <select
                      className="form-select"
                      value={teacherForm.teacherName}
                      onChange={(event) => onTeacherPick(event.target.value)}
                      required
                    >
                      <option value="">{t.selectTeacher}</option>
                      {filteredTeachers.map((row) => {
                        const name = teacherDisplayNameFromRow(row);
                        return (
                          <option key={row.id} value={name}>
                            {name}
                            {row.employment_type
                              ? ` (${row.employment_type})`
                              : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">{t.teacherEmploymentStatus}</label>
                    <select
                      className="form-select"
                      value={teacherForm.employmentType}
                      onChange={(event) =>
                        setTeacherForm((prev) => ({
                          ...prev,
                          employmentType: event.target.value as
                            | EmploymentType
                            | "",
                        }))
                      }
                    >
                      <option value="">-</option>
                      <option value="FT">FT</option>
                      <option value="PT">PT</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">{t.hourlyRate}</label>
                    <input
                      className="form-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={teacherForm.hourlyRate}
                      onChange={(event) =>
                        setTeacherForm((prev) => ({
                          ...prev,
                          hourlyRate: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">{t.notes}</label>
                    <input
                      className="form-input"
                      value={teacherForm.notes}
                      onChange={(event) =>
                        setTeacherForm((prev) => ({
                          ...prev,
                          notes: event.target.value,
                        }))
                      }
                      placeholder={t.teacherRateOverrideHint}
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <button
                      className="btn btn-primary"
                      type="submit"
                      disabled={saving}
                    >
                      {saving ? t.loading : t.save}
                    </button>
                    {teacherForm.id && (
                      <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={() =>
                          setTeacherForm((prev) => ({
                            ...prev,
                            id: "",
                            teacherName: "",
                            employmentType: "",
                            hourlyRate: "",
                            notes: "",
                          }))
                        }
                      >
                        {t.cancel}
                      </button>
                    )}
                  </div>
                </div>
              </form>

              {teacherRates.length === 0 ? (
                <EmptyState message={t.noHourlyRatesYet} />
              ) : (
                <DataTable
                  rowKey={(row) => row.id}
                  rows={teacherRates}
                  columns={[
                    {
                      key: "teacher",
                      header: t.teacherName,
                      render: (row) => row.teacher_name,
                    },
                    {
                      key: "employment",
                      header: t.teacherEmploymentStatus,
                      render: (row) => row.employment_type ?? "-",
                    },
                    {
                      key: "rate",
                      header: t.hourlyRate,
                      render: (row) => Number(row.hourly_rate).toFixed(2),
                    },
                    {
                      key: "notes",
                      header: t.notes,
                      render: (row) => row.notes ?? "-",
                    },
                    {
                      key: "actions",
                      header: t.actions,
                      render: (row) => (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() =>
                              setTeacherForm((prev) => ({
                                ...prev,
                                id: row.id,
                                teacherName: row.teacher_name,
                                employmentType:
                                  row.employment_type === "FT" ||
                                  row.employment_type === "PT"
                                    ? row.employment_type
                                    : "",
                                hourlyRate: String(row.hourly_rate),
                                notes: row.notes ?? "",
                              }))
                            }
                          >
                            {t.edit}
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={async () => {
                              if (!window.confirm(t.confirmDeleteHourlyRate)) {
                                return;
                              }
                              try {
                                await deleteTeacherHourlyRate(row.id);
                                await loadAll();
                              } catch (error) {
                                setMessage(
                                  error instanceof Error
                                    ? error.message
                                    : "Delete failed"
                                );
                              }
                            }}
                          >
                            {t.delete}
                          </button>
                        </div>
                      ),
                    },
                  ]}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
