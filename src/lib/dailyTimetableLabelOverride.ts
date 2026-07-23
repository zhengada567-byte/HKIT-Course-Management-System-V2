import type { DailySessionKind } from "./dailyTimetable";
import type {
  SessionLabelAssignmentResult,
  SessionLabelAssignmentTarget,
  TimetableSessionStatus,
} from "./dailyTimetableSessionLabels";

export type DailyLabelPlanOverride = {
  locked: true;
  strategy: "preserve_kinds";
};

export type SessionKindForRelabel = SessionLabelAssignmentTarget & {
  session_kind?: string | null;
  session_label?: string | null;
};

function compareSessionsBySchedule(
  a: SessionLabelAssignmentTarget,
  b: SessionLabelAssignmentTarget
) {
  const dateCompare = String(a.session_date).localeCompare(String(b.session_date));
  if (dateCompare !== 0) return dateCompare;
  return String(a.start_time).localeCompare(String(b.start_time));
}

export function parseDailyLabelPlanOverride(
  value: unknown
): DailyLabelPlanOverride | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Record<string, unknown>;

  if (row.locked !== true) {
    return null;
  }

  if (String(row.strategy ?? "").trim() !== "preserve_kinds") {
    return null;
  }

  return { locked: true, strategy: "preserve_kinds" };
}

export function resolveSessionKindForRelabel(params: {
  session_kind?: string | null;
  session_label?: string | null;
}): DailySessionKind {
  if (String(params.session_kind ?? "").trim() === "tutorial") {
    return "tutorial";
  }

  if (String(params.session_kind ?? "").trim() === "teaching") {
    return "teaching";
  }

  const label = String(params.session_label ?? "").trim().toUpperCase();
  if (/^T\d+/.test(label)) {
    return "tutorial";
  }

  return "teaching";
}

/**
 * Keep each session's teaching/tutorial kind; renumber L1..Ln and T1..Tm by date.
 * Cancelled rows clear labels. Extra active rows stay labelled within their kind.
 */
export function buildPreserveKindLabelAssignments(params: {
  sessions: SessionKindForRelabel[];
}): SessionLabelAssignmentResult[] {
  const results: SessionLabelAssignmentResult[] = [];
  const cancelled = params.sessions.filter((row) => row.status === "cancel");
  const active = params.sessions
    .filter((row) => row.status !== "cancel")
    .sort(compareSessionsBySchedule);

  let lectureNumber = 0;
  let tutorialNumber = 0;
  let sessionNumber = 0;

  for (const session of active) {
    sessionNumber += 1;
    const kind = resolveSessionKindForRelabel(session);

    if (kind === "tutorial") {
      tutorialNumber += 1;
      results.push({
        id: session.id,
        session_label: `T${tutorialNumber}`,
        session_kind: "tutorial",
        session_number: sessionNumber,
      });
      continue;
    }

    lectureNumber += 1;
    results.push({
      id: session.id,
      session_label: `L${lectureNumber}`,
      session_kind: "teaching",
      session_number: sessionNumber,
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

export function isDailyLabelPlanLocked(value: unknown) {
  return parseDailyLabelPlanOverride(value) !== null;
}
