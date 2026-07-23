import type { TimetableSessionStatus } from "./dailyTimetableSessionLabels";
import type { DailyTimetableEntry } from "../services/dailyTimetableService";
import { isTBC } from "./utils";

export function resolveModuleDefaultTeacher(
  entries: Array<Pick<DailyTimetableEntry, "teacherName">>
): string | null {
  const counts = new Map<string, number>();

  for (const entry of entries) {
    const name = String(entry.teacherName ?? "").trim();
    if (!name || isTBC(name)) {
      continue;
    }

    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  let best: string | null = null;
  let bestCount = 0;

  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }

  return best;
}

export type DailySessionSlotTemplate = {
  startTime: string;
  endTime: string;
  roomCode: string;
  teacherName: string | null;
};

type SessionDraftLike = {
  session_date: string;
  start_time: string;
  end_time: string;
  room_code: string;
  status: TimetableSessionStatus;
};

function normalizeTime(value: string) {
  return String(value ?? "").trim().slice(0, 5);
}

function slotKey(startTime: string, endTime: string, roomCode: string) {
  return `${normalizeTime(startTime)}|${normalizeTime(endTime)}|${String(roomCode ?? "").trim()}`;
}

function isActiveNonCancelledEntry(
  entry: DailyTimetableEntry,
  drafts: Record<string, SessionDraftLike>,
  pendingDeletes: ReadonlySet<string>
) {
  if (!entry.sessionId || pendingDeletes.has(entry.sessionId)) {
    return false;
  }

  const status = drafts[entry.sessionId]?.status ?? entry.status;
  return status !== "cancel";
}

/** Active labelled sessions only (excludes backups) — used for majority time/room template. */
function isActiveScheduledEntry(
  entry: DailyTimetableEntry,
  drafts: Record<string, SessionDraftLike>,
  pendingDeletes: ReadonlySet<string>
) {
  if (!isActiveNonCancelledEntry(entry, drafts, pendingDeletes)) {
    return false;
  }

  return !entry.isBackup;
}

/**
 * Pick the most common time + room among active scheduled sessions for a module.
 */
export function pickMajoritySessionTemplate(params: {
  entries: DailyTimetableEntry[];
  drafts?: Record<string, SessionDraftLike>;
  pendingDeletes?: ReadonlySet<string>;
}): DailySessionSlotTemplate | null {
  const drafts = params.drafts ?? {};
  const pendingDeletes = params.pendingDeletes ?? new Set<string>();

  const counts = new Map<
    string,
    { count: number; template: DailySessionSlotTemplate }
  >();

  for (const entry of params.entries) {
    if (!isActiveScheduledEntry(entry, drafts, pendingDeletes) || !entry.sessionId) {
      continue;
    }

    const draft = drafts[entry.sessionId];
    const startTime = normalizeTime(draft?.start_time ?? entry.startTime);
    const endTime = normalizeTime(draft?.end_time ?? entry.endTime);
    const roomCode = String(draft?.room_code ?? entry.roomCode ?? "").trim();

    if (!startTime || !endTime || !roomCode) {
      continue;
    }

    const key = slotKey(startTime, endTime, roomCode);
    const existing = counts.get(key);

    if (existing) {
      existing.count += 1;
      continue;
    }

    counts.set(key, {
      count: 1,
      template: {
        startTime,
        endTime,
        roomCode,
        teacherName: entry.teacherName ?? null,
      },
    });
  }

  let best: { count: number; template: DailySessionSlotTemplate } | null = null;

  for (const row of counts.values()) {
    if (!best || row.count > best.count) {
      best = row;
    }
  }

  return best?.template ?? null;
}

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function suggestNextSessionDate(params: {
  entries: DailyTimetableEntry[];
  drafts?: Record<string, SessionDraftLike>;
  pendingDeletes?: ReadonlySet<string>;
}) {
  const drafts = params.drafts ?? {};
  const pendingDeletes = params.pendingDeletes ?? new Set<string>();

  const dates = params.entries
    .filter((entry) => isActiveNonCancelledEntry(entry, drafts, pendingDeletes))
    .map((entry) => {
      if (!entry.sessionId) {
        return entry.sessionDate;
      }

      return drafts[entry.sessionId]?.session_date ?? entry.sessionDate;
    })
    .filter(Boolean)
    .sort();

  if (dates.length === 0) {
    return "";
  }

  return addDays(dates[dates.length - 1]!, 7);
}

export function buildDefaultNewSessionDraft(params: {
  entries: DailyTimetableEntry[];
  drafts?: Record<string, SessionDraftLike>;
  pendingDeletes?: ReadonlySet<string>;
  fallbackRoomCode?: string;
}) {
  const template = pickMajoritySessionTemplate(params);

  return {
    session_date: suggestNextSessionDate(params),
    start_time: template?.startTime ?? "09:00",
    end_time: template?.endTime ?? "13:00",
    room_code: template?.roomCode ?? params.fallbackRoomCode ?? "",
    status: "normal" as TimetableSessionStatus,
    remark: "",
    teacherName: template?.teacherName ?? null,
  };
}
