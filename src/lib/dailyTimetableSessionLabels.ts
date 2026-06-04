import type { DailySessionKind, DailySessionLabelSlot } from "./dailyTimetable";

export type TimetableSessionStatus = "normal" | "cancel" | "make_up";

export interface SessionLabelAssignmentTarget {
  id: string;
  status: TimetableSessionStatus;
  session_date: string;
  start_time: string;
}

export interface SessionLabelAssignmentResult {
  id: string;
  session_label: string | null;
  session_kind: DailySessionKind | null;
  session_number: number | null;
}

function compareSessionsBySchedule(
  a: SessionLabelAssignmentTarget,
  b: SessionLabelAssignmentTarget
) {
  const dateCompare = String(a.session_date).localeCompare(String(b.session_date));

  if (dateCompare !== 0) return dateCompare;

  return String(a.start_time).localeCompare(String(b.start_time));
}

/** True when the row is an unlabelled spare weekly slot (not cancelled). */
export function isBackupTimetableSession(params: {
  status: TimetableSessionStatus;
  session_label?: string | null;
}) {
  if (params.status === "cancel") return false;

  return !String(params.session_label ?? "").trim();
}

const CANCELLED_LABEL_RE = /Cancelled\s+(L\d+|T\d+)/i;
const MAKEUP_FOR_LABEL_RE = /Make-up for\s+(L\d+|T\d+)/i;

export function parseCancelledLabelFromRemark(remark?: string | null) {
  const text = String(remark ?? "").trim();
  const match = text.match(CANCELLED_LABEL_RE) ?? text.match(MAKEUP_FOR_LABEL_RE);

  return match?.[1]?.toUpperCase() ?? null;
}

export function formatCancelledRemark(label: string, existingRemark?: string | null) {
  const trimmedLabel = String(label ?? "").trim();
  const extra = String(existingRemark ?? "").trim();

  if (!trimmedLabel) return extra || null;

  if (CANCELLED_LABEL_RE.test(extra)) return extra || `Cancelled ${trimmedLabel}`;

  return extra ? `Cancelled ${trimmedLabel} — ${extra}` : `Cancelled ${trimmedLabel}`;
}

/**
 * Assign L/T labels:
 * - Cancelled slots become vacant (label read from existingLabelsById before clear).
 * - make_up sessions fill vacant slots first (e.g. backup replacing cancelled L9).
 * - normal sessions fill remaining slots by date order.
 * - Extra active sessions stay unlabelled (backup).
 * - Cancelled rows lose session_label / session_number in DB (shown via remark).
 */
export function buildSessionLabelAssignments(params: {
  labelSequence: DailySessionLabelSlot[];
  sessions: SessionLabelAssignmentTarget[];
  existingLabelsById?: Map<string, string | null>;
}): SessionLabelAssignmentResult[] {
  const results: SessionLabelAssignmentResult[] = [];
  const assignedIds = new Set<string>();

  const cancelled = params.sessions.filter((row) => row.status === "cancel");
  const active = params.sessions
    .filter((row) => row.status !== "cancel")
    .sort(compareSessionsBySchedule);

  const vacantIndices: number[] = [];

  for (const session of cancelled) {
    const label = String(params.existingLabelsById?.get(session.id) ?? "").trim();
    const index = params.labelSequence.findIndex((slot) => slot.label === label);

    if (index >= 0 && !vacantIndices.includes(index)) {
      vacantIndices.push(index);
    }
  }

  vacantIndices.sort((a, b) => a - b);

  const makeUpSessions = active.filter((row) => row.status === "make_up");
  const normalSessions = active.filter((row) => row.status === "normal");
  const sortedMakeUp = [...makeUpSessions].sort(compareSessionsBySchedule);

  const usedIndices = new Set<number>();

  for (let index = 0; index < sortedMakeUp.length && index < vacantIndices.length; index += 1) {
    const session = sortedMakeUp[index]!;
    const slotIndex = vacantIndices[index]!;
    const slot = params.labelSequence[slotIndex];

    if (!slot) continue;

    results.push({
      id: session.id,
      session_label: slot.label,
      session_kind: slot.kind,
      session_number: slotIndex + 1,
    });
    assignedIds.add(session.id);
    usedIndices.add(slotIndex);
  }

  const remainingSlotIndices = params.labelSequence
    .map((_, index) => index)
    .filter((index) => !usedIndices.has(index));

  const sortedNormal = [...normalSessions].sort(compareSessionsBySchedule);

  for (let index = 0; index < sortedNormal.length && index < remainingSlotIndices.length; index += 1) {
    const session = sortedNormal[index]!;
    const slotIndex = remainingSlotIndices[index]!;
    const slot = params.labelSequence[slotIndex];

    if (!slot) continue;

    results.push({
      id: session.id,
      session_label: slot.label,
      session_kind: slot.kind,
      session_number: slotIndex + 1,
    });
    assignedIds.add(session.id);
    usedIndices.add(slotIndex);
  }

  for (const session of active) {
    if (assignedIds.has(session.id)) continue;

    results.push({
      id: session.id,
      session_label: null,
      session_kind: null,
      session_number: null,
    });
  }

  for (const session of cancelled) {
    results.push({
      id: session.id,
      session_label: null,
      session_kind: null,
      session_number: null,
    });
  }

  return results;
}
