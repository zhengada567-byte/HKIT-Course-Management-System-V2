import { parseCancelledLabelFromRemark } from "./dailyTimetableSessionLabels";

/** Sort key for L/T labels (L before T; HD interleaving uses session_number from DB). */
export function dailySessionLabelSortKey(label: string): number {
  const trimmed = String(label ?? "").trim();
  if (
    !trimmed ||
    trimmed === "Backup" ||
    trimmed === "—" ||
    trimmed === "Cancelled"
  ) {
    return 99997;
  }

  const match = trimmed.match(/^(L|T)(\d+)$/i);
  if (!match) return 99996;

  const num = parseInt(match[2]!, 10);
  return (match[1]!.toUpperCase() === "T" ? 1000 : 0) + num;
}

export interface DailyEntryLabelSortFields {
  sessionNumber: number | null;
  sessionLabel: string;
  isBackup: boolean;
  status: string;
  remark: string | null;
  sessionDate?: string;
  startTime?: string;
}

export function dailyEntryLabelSortKey(entry: DailyEntryLabelSortFields): number {
  if (entry.isBackup) return 20000;

  if (entry.sessionNumber != null && entry.sessionNumber > 0) {
    return entry.sessionNumber;
  }

  if (entry.status === "cancel") {
    const fromRemark = parseCancelledLabelFromRemark(entry.remark);
    if (fromRemark) return dailySessionLabelSortKey(fromRemark);
  }

  const parsed = dailySessionLabelSortKey(entry.sessionLabel);
  return parsed < 99996 ? parsed : 19999;
}

export function compareDailyTimetableEntriesByLabelOrder(
  a: DailyEntryLabelSortFields & { sessionDate?: string; startTime?: string },
  b: DailyEntryLabelSortFields & { sessionDate?: string; startTime?: string }
): number {
  const keyDiff = dailyEntryLabelSortKey(a) - dailyEntryLabelSortKey(b);
  if (keyDiff !== 0) return keyDiff;

  const dateCompare = String(a.sessionDate ?? "").localeCompare(
    String(b.sessionDate ?? "")
  );
  if (dateCompare !== 0) return dateCompare;

  return String(a.startTime ?? "").localeCompare(String(b.startTime ?? ""));
}

export function sortDailyTimetableEntries<T extends DailyEntryLabelSortFields>(
  entries: T[]
): T[] {
  return [...entries].sort(compareDailyTimetableEntriesByLabelOrder);
}
