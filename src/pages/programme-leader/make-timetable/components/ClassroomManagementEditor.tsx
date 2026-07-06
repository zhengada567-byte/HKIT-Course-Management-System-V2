import { useEffect, useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";

import { useLanguage } from "../../../../contexts/LanguageContext";
import {
  buildTimetableRoomCode,
  deleteTimetableClassroom,
  listClassroomNotAvailableForRooms,
  saveClassroomNotAvailableDraft,
  upsertTimetableClassroom,
  type ClassroomAvailabilityPeriod,
} from "../../../../services/timetableClassroomService";
import {
  listTimetableClassrooms,
  type TimetableClassroomRow,
  type TimetableRoomType,
} from "../../../../services/timetableScheduleService";

const periods: ClassroomAvailabilityPeriod[] = ["AM", "PM", "EVENING"];
const weekdays: Array<{ id: 1 | 2 | 3 | 4 | 5 | 6; label: string }> = [
  { id: 1, label: "Mon" },
  { id: 2, label: "Tue" },
  { id: 3, label: "Wed" },
  { id: 4, label: "Thu" },
  { id: 5, label: "Fri" },
  { id: 6, label: "Sat" },
];

const roomTypeOptions: TimetableRoomType[] = ["normal", "computer"];

function naKey(weekday: number, period: string) {
  return `${weekday}|${period}`;
}

function emptyForm() {
  return {
    location: "",
    roomNumber: "",
    roomSize: "",
    roomType: "normal" as TimetableRoomType,
  };
}

export function ClassroomManagementEditor({
  academicYear,
  onChanged,
}: {
  academicYear: string;
  onChanged?: () => void;
}) {
  const { t } = useLanguage();
  const [classrooms, setClassrooms] = useState<TimetableClassroomRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [selectedRoomCode, setSelectedRoomCode] = useState<string>("");
  const [isAdding, setIsAdding] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [savingDetails, setSavingDetails] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [naDraft, setNaDraft] = useState<Set<string>>(() => new Set());
  const [naOriginal, setNaOriginal] = useState<Set<string>>(() => new Set());
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [savingAvailability, setSavingAvailability] = useState(false);

  const selectedClassroom = useMemo(
    () => classrooms.find((room) => room.room_code === selectedRoomCode) ?? null,
    [classrooms, selectedRoomCode]
  );

  const previewRoomCode = useMemo(() => {
    try {
      if (!form.location.trim() || !form.roomNumber.trim()) return "";
      return buildTimetableRoomCode(form.location, form.roomNumber);
    } catch {
      return "";
    }
  }, [form.location, form.roomNumber]);

  const availabilityDirty = useMemo(() => {
    if (naDraft.size !== naOriginal.size) return true;
    for (const key of naDraft) {
      if (!naOriginal.has(key)) return true;
    }
    return false;
  }, [naDraft, naOriginal]);

  async function loadClassrooms(preferredRoomCode?: string) {
    setLoading(true);
    setError(null);
    try {
      const rows = await listTimetableClassrooms();
      setClassrooms(rows);
      const nextCode =
        preferredRoomCode && rows.some((row) => row.room_code === preferredRoomCode)
          ? preferredRoomCode
          : rows[0]?.room_code ?? "";
      setSelectedRoomCode(nextCode);
      setIsAdding(!nextCode);
      if (!nextCode) {
        setForm(emptyForm());
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load classrooms."
      );
      setClassrooms([]);
      setSelectedRoomCode("");
      setIsAdding(true);
      setForm(emptyForm());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadClassrooms();
  }, []);

  useEffect(() => {
    if (isAdding) {
      setNaDraft(new Set());
      setNaOriginal(new Set());
      return;
    }

    if (!selectedClassroom) {
      setNaDraft(new Set());
      setNaOriginal(new Set());
      return;
    }

    setForm({
      location: selectedClassroom.location,
      roomNumber: selectedClassroom.room_number,
      roomSize: String(selectedClassroom.room_size),
      roomType: selectedClassroom.room_type,
    });

    let cancelled = false;
    setAvailabilityLoading(true);
    setError(null);

    void (async () => {
      try {
        const rows = await listClassroomNotAvailableForRooms({
          academicYear,
          roomCodes: [selectedClassroom.room_code],
        });
        if (cancelled) return;

        const blocked = new Set<string>();
        for (const row of rows) {
          blocked.add(naKey(row.weekday, row.period));
        }
        setNaDraft(new Set(blocked));
        setNaOriginal(new Set(blocked));
      } catch (loadError) {
        if (cancelled) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load classroom availability."
        );
        setNaDraft(new Set());
        setNaOriginal(new Set());
      } finally {
        if (!cancelled) setAvailabilityLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [academicYear, isAdding, selectedClassroom?.room_code]);

  function startAddClassroom() {
    setIsAdding(true);
    setSelectedRoomCode("");
    setForm(emptyForm());
    setMessage(null);
    setError(null);
  }

  function selectClassroom(roomCode: string) {
    setIsAdding(false);
    setSelectedRoomCode(roomCode);
    setMessage(null);
    setError(null);
  }

  function toggleNotAvailable(params: {
    weekday: 1 | 2 | 3 | 4 | 5 | 6;
    period: ClassroomAvailabilityPeriod;
  }) {
    if (isAdding || !selectedClassroom || availabilityLoading || savingAvailability) {
      return;
    }

    const key = naKey(params.weekday, params.period);
    setNaDraft((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSaveDetails() {
    setSavingDetails(true);
    setError(null);
    setMessage(null);

    try {
      const saved = await upsertTimetableClassroom({
        originalRoomCode: isAdding ? undefined : selectedClassroom?.room_code,
        location: form.location,
        roomNumber: form.roomNumber,
        roomSize: Number(form.roomSize),
        roomType: form.roomType,
      });

      await loadClassrooms(saved.room_code);
      setIsAdding(false);
      setMessage(t.classroomManagementSaved);
      onChanged?.();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save classroom."
      );
    } finally {
      setSavingDetails(false);
    }
  }

  async function handleDeleteClassroom() {
    if (!selectedClassroom) return;
    if (
      !window.confirm(
        `${t.classroomManagementDeleteConfirm} (${selectedClassroom.room_code})`
      )
    ) {
      return;
    }

    setDeleting(true);
    setError(null);
    setMessage(null);

    try {
      await deleteTimetableClassroom(selectedClassroom.room_code);
      await loadClassrooms();
      setMessage(t.classroomManagementDeleted);
      onChanged?.();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete classroom."
      );
    } finally {
      setDeleting(false);
    }
  }

  async function handleSaveAvailability() {
    if (!selectedClassroom) return;

    setSavingAvailability(true);
    setError(null);
    setMessage(null);

    try {
      await saveClassroomNotAvailableDraft({
        academicYear,
        roomCode: selectedClassroom.room_code,
        draftKeys: naDraft,
        originalKeys: naOriginal,
      });
      setNaOriginal(new Set(naDraft));
      setMessage(t.classroomManagementAvailabilitySaved);
      onChanged?.();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save classroom availability."
      );
    } finally {
      setSavingAvailability(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t.classroomManagementHint}</p>

      {message && (
        <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-800">
              {t.classroomManagementRooms}
            </h3>
            <button
              type="button"
              className="btn btn-secondary px-2 py-1 text-xs"
              onClick={startAddClassroom}
              disabled={loading || savingDetails || deleting}
            >
              <Plus className="mr-1 inline h-3.5 w-3.5" />
              {t.classroomManagementAdd}
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-slate-600">{t.loading}</p>
          ) : classrooms.length === 0 ? (
            <p className="text-sm text-slate-600">{t.classroomManagementNoRooms}</p>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto rounded border border-slate-200 p-2">
              {classrooms.map((room) => (
                <button
                  key={room.room_code}
                  type="button"
                  className={`w-full rounded px-2 py-2 text-left text-sm ${
                    !isAdding && selectedRoomCode === room.room_code
                      ? "bg-blue-50 font-medium text-blue-800"
                      : "hover:bg-slate-50"
                  }`}
                  onClick={() => selectClassroom(room.room_code)}
                >
                  <div>{room.room_code}</div>
                  <div className="text-xs text-slate-500">
                    {room.location} · {room.room_size} · {room.room_type}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4 rounded border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-800">
            {isAdding ? t.classroomManagementAdd : t.classroomManagementEdit}
          </h3>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="form-label">{t.classroomManagementLocation}</label>
              <input
                className="form-input"
                value={form.location}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, location: event.target.value }))
                }
                placeholder="SSP"
              />
            </div>
            <div>
              <label className="form-label">{t.classroomManagementRoomNumber}</label>
              <input
                className="form-input"
                value={form.roomNumber}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, roomNumber: event.target.value }))
                }
                placeholder="101"
              />
            </div>
            <div>
              <label className="form-label">{t.classroomManagementRoomCode}</label>
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                {previewRoomCode || "—"}
              </div>
            </div>
            <div>
              <label className="form-label">{t.classroomManagementRoomSize}</label>
              <input
                className="form-input"
                type="number"
                min={1}
                value={form.roomSize}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, roomSize: event.target.value }))
                }
              />
            </div>
            <div>
              <label className="form-label">{t.classroomManagementRoomType}</label>
              <select
                className="form-select"
                value={form.roomType}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    roomType: event.target.value as TimetableRoomType,
                  }))
                }
              >
                {roomTypeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option === "computer"
                      ? t.classroomManagementTypeComputer
                      : t.classroomManagementTypeNormal}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={savingDetails || deleting}
              onClick={() => void handleSaveDetails()}
            >
              {savingDetails ? t.loading : t.classroomManagementSaveRoom}
            </button>
            {!isAdding && selectedClassroom && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={savingDetails || deleting}
                onClick={() => void handleDeleteClassroom()}
              >
                <Minus className="mr-1 inline h-3.5 w-3.5" />
                {deleting ? t.loading : t.classroomManagementDelete}
              </button>
            )}
          </div>

          {!isAdding && selectedClassroom && (
            <div className="space-y-3 border-t border-slate-200 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-slate-800">
                    {t.classroomManagementWeeklyAvailability}
                  </h4>
                  <p className="text-xs text-slate-500">
                    {t.classroomManagementWeeklyAvailabilityHint}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={
                    availabilityLoading ||
                    savingAvailability ||
                    !availabilityDirty
                  }
                  onClick={() => void handleSaveAvailability()}
                >
                  {savingAvailability
                    ? t.loading
                    : t.classroomManagementSaveAvailability}
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-[520px] border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left">
                        Period
                      </th>
                      {weekdays.map((day) => (
                        <th
                          key={day.id}
                          className="border border-slate-200 bg-slate-50 px-2 py-2 text-center"
                        >
                          {day.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {periods.map((period) => (
                      <tr key={period}>
                        <td className="border border-slate-200 px-2 py-2 font-medium">
                          {period}
                        </td>
                        {weekdays.map((day) => {
                          const key = naKey(day.id, period);
                          const checked = naDraft.has(key);
                          return (
                            <td
                              key={day.id}
                              className="border border-slate-200 px-2 py-2 text-center"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                title={`${selectedClassroom.room_code} not available: ${day.label} ${period}`}
                                disabled={
                                  availabilityLoading || savingAvailability
                                }
                                onChange={() =>
                                  toggleNotAvailable({
                                    weekday: day.id,
                                    period,
                                  })
                                }
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
