import { useEffect, useMemo, useState } from "react";

import { DataTable } from "../../components/tables/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useAcademicYear } from "../../contexts/AcademicYearContext";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { listProgrammes } from "../../services/programmeService";
import {
  deletePromotionOccurrenceCost,
  deleteWorkshopCost,
  listPromotionOccurrenceCosts,
  listSocialMediaCosts,
  listWorkshopCosts,
  SOCIAL_MEDIA_MONTH_KEYS,
  upsertPromotionOccurrenceCost,
  upsertSocialMediaCost,
  upsertWorkshopCost,
  type PromotionOccurrenceCostRow,
  type PromotionOccurrenceType,
  type SocialMediaCostRow,
  type SocialMediaMonthKey,
  type WorkshopCostRow,
} from "../../services/promotionExpenseService";
import type { ProgrammeRow } from "../../types";

type TabKey =
  | "social_media"
  | "workshop"
  | "brochure"
  | "exhibition"
  | "other";

function uniqueProgrammeCodes(programmes: ProgrammeRow[]) {
  return Array.from(
    new Set(
      programmes
        .map((row) => String(row.programme_code ?? "").trim().toUpperCase())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
}

function money(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

export function PromotionExpensesPage() {
  const { academicYear } = useAcademicYear();
  const { user } = useAuth();
  const { t } = useLanguage();

  const [tab, setTab] = useState<TabKey>("social_media");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [programmeCode, setProgrammeCode] = useState("");
  const [programmes, setProgrammes] = useState<ProgrammeRow[]>([]);

  const [socialRows, setSocialRows] = useState<SocialMediaCostRow[]>([]);
  const [workshopRows, setWorkshopRows] = useState<WorkshopCostRow[]>([]);
  const [occurrenceRows, setOccurrenceRows] = useState<
    PromotionOccurrenceCostRow[]
  >([]);

  const [monthDrafts, setMonthDrafts] = useState<
    Record<SocialMediaMonthKey, string>
  >(() =>
    Object.fromEntries(SOCIAL_MEDIA_MONTH_KEYS.map((m) => [m, ""])) as Record<
      SocialMediaMonthKey,
      string
    >
  );

  const [workshopForm, setWorkshopForm] = useState({
    id: "",
    workshopTitle: "",
    speakerFee: "",
    promotionFee: "",
    expenseDate: "",
    notes: "",
  });

  const [occurrenceForm, setOccurrenceForm] = useState({
    id: "",
    title: "",
    amount: "",
    expenseDate: "",
    notes: "",
  });

  const programmeCodes = useMemo(
    () => uniqueProgrammeCodes(programmes),
    [programmes]
  );

  const filteredWorkshops = useMemo(
    () =>
      programmeCode
        ? workshopRows.filter((row) => row.programme_code === programmeCode)
        : workshopRows,
    [workshopRows, programmeCode]
  );

  const filteredOccurrences = useMemo(() => {
    const typeMap: Partial<Record<TabKey, PromotionOccurrenceType>> = {
      brochure: "brochure",
      exhibition: "exhibition",
      other: "other",
    };
    const costType = typeMap[tab];
    return occurrenceRows.filter((row) => {
      if (costType && row.cost_type !== costType) return false;
      if (programmeCode && row.programme_code !== programmeCode) return false;
      return true;
    });
  }, [occurrenceRows, programmeCode, tab]);

  async function loadAll() {
    setLoading(true);
    setMessage("");

    try {
      const [programmeRows, social, workshops, occurrences] = await Promise.all([
        listProgrammes(),
        listSocialMediaCosts({ academicYear }),
        listWorkshopCosts({ academicYear }),
        listPromotionOccurrenceCosts({ academicYear }),
      ]);

      setProgrammes(programmeRows);
      setSocialRows(social);
      setWorkshopRows(workshops);
      setOccurrenceRows(occurrences);

      if (!programmeCode && programmeRows.length > 0) {
        const first = uniqueProgrammeCodes(programmeRows)[0] ?? "";
        setProgrammeCode(first);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    setWorkshopForm({
      id: "",
      workshopTitle: "",
      speakerFee: "",
      promotionFee: "",
      expenseDate: "",
      notes: "",
    });
    setOccurrenceForm({
      id: "",
      title: "",
      amount: "",
      expenseDate: "",
      notes: "",
    });
  }, [academicYear]);

  useEffect(() => {
    const next = Object.fromEntries(
      SOCIAL_MEDIA_MONTH_KEYS.map((month) => {
        const row = socialRows.find(
          (item) =>
            item.programme_code === programmeCode && item.month_key === month
        );
        return [month, row ? String(row.amount) : ""];
      })
    ) as Record<SocialMediaMonthKey, string>;
    setMonthDrafts(next);
  }, [socialRows, programmeCode]);

  async function saveSocialMonth(monthKey: SocialMediaMonthKey) {
    if (!programmeCode) {
      setMessage(t.selectProgrammeRequiredShort);
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const existing = socialRows.find(
        (row) =>
          row.programme_code === programmeCode && row.month_key === monthKey
      );
      await upsertSocialMediaCost({
        id: existing?.id,
        academicYear,
        programmeCode,
        monthKey,
        amount: monthDrafts[monthKey] || "0",
        updatedBy: user?.id ?? null,
      });
      await loadAll();
      setMessage(t.promotionExpenseSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveAllSocialMonths() {
    if (!programmeCode) {
      setMessage(t.selectProgrammeRequiredShort);
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      for (const monthKey of SOCIAL_MEDIA_MONTH_KEYS) {
        const raw = monthDrafts[monthKey];
        if (raw === "" || raw == null) continue;
        const existing = socialRows.find(
          (row) =>
            row.programme_code === programmeCode && row.month_key === monthKey
        );
        await upsertSocialMediaCost({
          id: existing?.id,
          academicYear,
          programmeCode,
          monthKey,
          amount: raw,
          updatedBy: user?.id ?? null,
        });
      }
      await loadAll();
      setMessage(t.promotionExpenseSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveWorkshop(event: React.FormEvent) {
    event.preventDefault();
    if (!programmeCode) {
      setMessage(t.selectProgrammeRequiredShort);
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      await upsertWorkshopCost({
        id: workshopForm.id || undefined,
        academicYear,
        programmeCode,
        workshopTitle: workshopForm.workshopTitle,
        speakerFee: workshopForm.speakerFee || "0",
        promotionFee: workshopForm.promotionFee || "0",
        expenseDate: workshopForm.expenseDate,
        notes: workshopForm.notes,
        updatedBy: user?.id ?? null,
      });
      setWorkshopForm({
        id: "",
        workshopTitle: "",
        speakerFee: "",
        promotionFee: "",
        expenseDate: "",
        notes: "",
      });
      await loadAll();
      setMessage(t.promotionExpenseSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveOccurrence(event: React.FormEvent) {
    event.preventDefault();
    if (!programmeCode) {
      setMessage(t.selectProgrammeRequiredShort);
      return;
    }

    const costType =
      tab === "brochure" || tab === "exhibition" || tab === "other"
        ? tab
        : null;
    if (!costType) return;

    setSaving(true);
    setMessage("");

    try {
      await upsertPromotionOccurrenceCost({
        id: occurrenceForm.id || undefined,
        academicYear,
        programmeCode,
        costType,
        title: occurrenceForm.title,
        amount: occurrenceForm.amount,
        expenseDate: occurrenceForm.expenseDate,
        notes: occurrenceForm.notes,
        updatedBy: user?.id ?? null,
      });
      setOccurrenceForm({
        id: "",
        title: "",
        amount: "",
        expenseDate: "",
        notes: "",
      });
      await loadAll();
      setMessage(t.promotionExpenseSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: "social_media", label: t.promotionSocialMedia },
    { key: "workshop", label: t.promotionWorkshop },
    { key: "brochure", label: t.promotionBrochure },
    { key: "exhibition", label: t.promotionExhibition },
    { key: "other", label: t.promotionOther },
  ];

  const socialTotal = SOCIAL_MEDIA_MONTH_KEYS.reduce((sum, month) => {
    const n = Number(monthDrafts[month] || 0);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  return (
    <div className="page-container">
      <PageHeader
        title={t.promotionExpensesTitle}
        description={t.promotionExpensesDescription}
      />

      <div className="mb-4 card">
        <div className="card-body max-w-md">
          <label className="form-label">{t.programmeCode}</label>
          <select
            className="form-select"
            value={programmeCode}
            onChange={(event) => {
              setProgrammeCode(event.target.value);
              setMessage("");
              setWorkshopForm({
                id: "",
                workshopTitle: "",
                speakerFee: "",
                promotionFee: "",
                expenseDate: "",
                notes: "",
              });
              setOccurrenceForm({
                id: "",
                title: "",
                amount: "",
                expenseDate: "",
                notes: "",
              });
            }}
          >
            <option value="">{t.selectProgramme}</option>
            {programmeCodes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
      </div>

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
              setWorkshopForm({
                id: "",
                workshopTitle: "",
                speakerFee: "",
                promotionFee: "",
                expenseDate: "",
                notes: "",
              });
              setOccurrenceForm({
                id: "",
                title: "",
                amount: "",
                expenseDate: "",
                notes: "",
              });
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
          {tab === "social_media" && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">{t.promotionSocialMediaHint}</p>
              <div className="card">
                <div className="card-body space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {SOCIAL_MEDIA_MONTH_KEYS.map((month) => (
                      <div key={month} className="space-y-1">
                        <label className="form-label">{month}</label>
                        <div className="flex gap-2">
                          <input
                            className="form-input"
                            type="number"
                            min="0"
                            step="0.01"
                            value={monthDrafts[month]}
                            onChange={(event) =>
                              setMonthDrafts((prev) => ({
                                ...prev,
                                [month]: event.target.value,
                              }))
                            }
                            placeholder="0.00"
                          />
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={saving || !programmeCode}
                            onClick={() => void saveSocialMonth(month)}
                          >
                            {t.save}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                    <div className="text-sm text-slate-700">
                      {t.total}: <strong>{money(socialTotal)}</strong>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={saving || !programmeCode}
                      onClick={() => void saveAllSocialMonths()}
                    >
                      {saving ? t.loading : t.saveAllMonths}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "workshop" && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">{t.promotionWorkshopHint}</p>
              <form className="card" onSubmit={saveWorkshop}>
                <div className="card-body grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <div className="xl:col-span-2">
                    <label className="form-label">{t.workshopTitle}</label>
                    <input
                      className="form-input"
                      value={workshopForm.workshopTitle}
                      onChange={(event) =>
                        setWorkshopForm((prev) => ({
                          ...prev,
                          workshopTitle: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">{t.expenseDate}</label>
                    <input
                      className="form-input"
                      type="date"
                      value={workshopForm.expenseDate}
                      onChange={(event) =>
                        setWorkshopForm((prev) => ({
                          ...prev,
                          expenseDate: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="form-label">{t.speakerFee}</label>
                    <input
                      className="form-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={workshopForm.speakerFee}
                      onChange={(event) =>
                        setWorkshopForm((prev) => ({
                          ...prev,
                          speakerFee: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">{t.workshopPromotionFee}</label>
                    <input
                      className="form-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={workshopForm.promotionFee}
                      onChange={(event) =>
                        setWorkshopForm((prev) => ({
                          ...prev,
                          promotionFee: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">{t.notes}</label>
                    <input
                      className="form-input"
                      value={workshopForm.notes}
                      onChange={(event) =>
                        setWorkshopForm((prev) => ({
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
                      disabled={saving || !programmeCode}
                    >
                      {saving ? t.loading : t.save}
                    </button>
                    {workshopForm.id && (
                      <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={() =>
                          setWorkshopForm({
                            id: "",
                            workshopTitle: "",
                            speakerFee: "",
                            promotionFee: "",
                            expenseDate: "",
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

              {filteredWorkshops.length === 0 ? (
                <EmptyState message={t.noPromotionExpensesYet} />
              ) : (
                <DataTable
                  rowKey={(row) => row.id}
                  rows={filteredWorkshops}
                  columns={[
                    {
                      key: "title",
                      header: t.workshopTitle,
                      render: (row) => row.workshop_title,
                    },
                    {
                      key: "date",
                      header: t.expenseDate,
                      render: (row) => row.expense_date ?? "-",
                    },
                    {
                      key: "speaker",
                      header: t.speakerFee,
                      render: (row) => money(row.speaker_fee),
                    },
                    {
                      key: "promo",
                      header: t.workshopPromotionFee,
                      render: (row) => money(row.promotion_fee),
                    },
                    {
                      key: "total",
                      header: t.total,
                      render: (row) =>
                        money(
                          Number(row.speaker_fee) + Number(row.promotion_fee)
                        ),
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
                              setWorkshopForm({
                                id: row.id,
                                workshopTitle: row.workshop_title,
                                speakerFee: String(row.speaker_fee),
                                promotionFee: String(row.promotion_fee),
                                expenseDate: row.expense_date ?? "",
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
                              if (
                                !window.confirm(t.confirmDeletePromotionExpense)
                              ) {
                                return;
                              }
                              try {
                                await deleteWorkshopCost(row.id);
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

          {(tab === "brochure" ||
            tab === "exhibition" ||
            tab === "other") && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                {t.promotionOccurrenceHint}
              </p>
              <form className="card" onSubmit={saveOccurrence}>
                <div className="card-body grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <div>
                    <label className="form-label">{t.occurrenceTitle}</label>
                    <input
                      className="form-input"
                      value={occurrenceForm.title}
                      onChange={(event) =>
                        setOccurrenceForm((prev) => ({
                          ...prev,
                          title: event.target.value,
                        }))
                      }
                      placeholder={t.occurrenceTitlePlaceholder}
                    />
                  </div>
                  <div>
                    <label className="form-label">{t.amount}</label>
                    <input
                      className="form-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={occurrenceForm.amount}
                      onChange={(event) =>
                        setOccurrenceForm((prev) => ({
                          ...prev,
                          amount: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">{t.expenseDate}</label>
                    <input
                      className="form-input"
                      type="date"
                      value={occurrenceForm.expenseDate}
                      onChange={(event) =>
                        setOccurrenceForm((prev) => ({
                          ...prev,
                          expenseDate: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="form-label">{t.notes}</label>
                    <input
                      className="form-input"
                      value={occurrenceForm.notes}
                      onChange={(event) =>
                        setOccurrenceForm((prev) => ({
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
                      disabled={saving || !programmeCode}
                    >
                      {saving ? t.loading : t.save}
                    </button>
                    {occurrenceForm.id && (
                      <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={() =>
                          setOccurrenceForm({
                            id: "",
                            title: "",
                            amount: "",
                            expenseDate: "",
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

              {filteredOccurrences.length === 0 ? (
                <EmptyState message={t.noPromotionExpensesYet} />
              ) : (
                <DataTable
                  rowKey={(row) => row.id}
                  rows={filteredOccurrences}
                  columns={[
                    {
                      key: "title",
                      header: t.occurrenceTitle,
                      render: (row) => row.title ?? "-",
                    },
                    {
                      key: "amount",
                      header: t.amount,
                      render: (row) => money(row.amount),
                    },
                    {
                      key: "date",
                      header: t.expenseDate,
                      render: (row) => row.expense_date ?? "-",
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
                              setOccurrenceForm({
                                id: row.id,
                                title: row.title ?? "",
                                amount: String(row.amount),
                                expenseDate: row.expense_date ?? "",
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
                              if (
                                !window.confirm(t.confirmDeletePromotionExpense)
                              ) {
                                return;
                              }
                              try {
                                await deletePromotionOccurrenceCost(row.id);
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
