import { formatCancelledRemark } from "../lib/dailyTimetableSessionLabels";
import { supabase } from "../lib/supabase";
import { normalizeAcademicYear } from "../lib/utils";
import {
  applyDailyLabelsToTimetableModule,
  loadModuleCatalogContext,
  loadTermCalendarContext,
  type DailyTimetableEntry,
  type DailyTimetableModulePlan,
} from "./dailyTimetableService";
import {
  isIsoDateInTermStudyWeek,
  normalizeSessionDate,
  normalizeSessionTime,
  type TimetableScheduleTerm,
  type TimetableSessionRow,
} from "./timetableScheduleService";
import type { TimetableSessionStatus } from "../lib/dailyTimetableSessionLabels";

export const TIMETABLE_NOTIFY_EMAIL = "timetable@hkit.edu.hk";

export interface DailySessionDraftInput {
  session_date: string;
  start_time: string;
  end_time: string;
  room_code: string;
  status: TimetableSessionStatus;
  remark: string;
}

export interface PendingDailySessionAdd extends DailySessionDraftInput {
  clientId: string;
  teacher_name?: string | null;
}

export function moduleEditorIsDirty(params: {
  plan: DailyTimetableModulePlan;
  drafts: Record<string, DailySessionDraftInput>;
  pendingAdds?: PendingDailySessionAdd[];
  pendingDeletes?: ReadonlySet<string>;
}) {
  if ((params.pendingAdds?.length ?? 0) > 0) {
    return true;
  }

  if ((params.pendingDeletes?.size ?? 0) > 0) {
    return true;
  }

  return moduleHasDraftChanges(params.plan, params.drafts);
}

interface SessionSnapshot {
  sessionId: string;
  label: string;
  session_date: string;
  start_time: string;
  end_time: string;
  room_code: string;
  status: TimetableSessionStatus;
  remark: string;
}

function snapshotFromRow(
  row: TimetableSessionRow,
  labelFallback = ""
): SessionSnapshot {
  return {
    sessionId: row.id,
    label: String(row.session_label ?? "").trim() || labelFallback || "—",
    session_date: normalizeSessionDate(row.session_date),
    start_time: normalizeSessionTime(row.start_time).slice(0, 5),
    end_time: normalizeSessionTime(row.end_time).slice(0, 5),
    room_code: String(row.room_code ?? "").trim(),
    status: row.status as TimetableSessionStatus,
    remark: String(row.remark ?? "").trim(),
  };
}

function snapshotFromDraft(
  sessionId: string,
  label: string,
  draft: DailySessionDraftInput
): SessionSnapshot {
  return {
    sessionId,
    label,
    session_date: normalizeSessionDate(draft.session_date),
    start_time: normalizeSessionTime(draft.start_time).slice(0, 5),
    end_time: normalizeSessionTime(draft.end_time).slice(0, 5),
    room_code: String(draft.room_code ?? "").trim(),
    status: draft.status,
    remark: String(draft.remark ?? "").trim(),
  };
}

export function hasDraftChanges(
  entry: DailyTimetableEntry,
  draft: DailySessionDraftInput
) {
  const before = snapshotFromDraft(entry.sessionId!, entry.sessionLabel, {
    session_date: entry.sessionDate,
    start_time: entry.startTime,
    end_time: entry.endTime,
    room_code: entry.roomCode,
    status: entry.status,
    remark: entry.remark ?? "",
  });

  const after = snapshotFromDraft(entry.sessionId!, entry.sessionLabel, draft);

  return JSON.stringify(before) !== JSON.stringify(after);
}

export function moduleHasDraftChanges(
  plan: DailyTimetableModulePlan,
  drafts: Record<string, DailySessionDraftInput>
) {
  return plan.entries.some((entry) => {
    if (!entry.sessionId) return false;
    const draft = drafts[entry.sessionId];
    if (!draft) return false;
    return hasDraftChanges(entry, draft);
  });
}

function formatFieldChange(
  label: string,
  field: string,
  before: string,
  after: string
) {
  if (before === after) return null;
  return `  ${label} — ${field}: ${before || "(empty)"} → ${after || "(empty)"}`;
}

function buildChangeLines(before: SessionSnapshot, after: SessionSnapshot) {
  const lines = [
    formatFieldChange(before.label, "date", before.session_date, after.session_date),
    formatFieldChange(
      before.label,
      "time",
      `${before.start_time}–${before.end_time}`,
      `${after.start_time}–${after.end_time}`
    ),
    formatFieldChange(before.label, "room", before.room_code, after.room_code),
    formatFieldChange(before.label, "status", before.status, after.status),
    formatFieldChange(before.label, "remark", before.remark, after.remark),
  ].filter((line): line is string => Boolean(line));

  if (lines.length === 0) return [];

  return [`• ${before.label}`, ...lines];
}

export function buildModuleChangeSummary(params: {
  beforeById: Map<string, SessionSnapshot>;
  plan: DailyTimetableModulePlan;
  drafts: Record<string, DailySessionDraftInput>;
  pendingAdds?: PendingDailySessionAdd[];
  pendingDeletes?: ReadonlySet<string>;
}) {
  const blocks: string[] = [];

  for (const sessionId of params.pendingDeletes ?? []) {
    const before = params.beforeById.get(sessionId);
    if (!before) continue;
    blocks.push(`• ${before.label} — deleted`);
  }

  for (const pending of params.pendingAdds ?? []) {
    blocks.push(
      `• New session — date: ${normalizeSessionDate(pending.session_date)}, time: ${normalizeSessionTime(pending.start_time).slice(0, 5)}–${normalizeSessionTime(pending.end_time).slice(0, 5)}, room: ${pending.room_code || "(empty)"}, status: ${pending.status}`
    );
  }

  for (const entry of params.plan.entries) {
    if (!entry.sessionId) continue;
    if (params.pendingDeletes?.has(entry.sessionId)) continue;

    const draft = params.drafts[entry.sessionId];
    if (!draft || !hasDraftChanges(entry, draft)) continue;

    const before =
      params.beforeById.get(entry.sessionId) ??
      snapshotFromDraft(entry.sessionId, entry.sessionLabel, {
        session_date: entry.sessionDate,
        start_time: entry.startTime,
        end_time: entry.endTime,
        room_code: entry.roomCode,
        status: entry.status,
        remark: entry.remark ?? "",
      });

    const after = snapshotFromDraft(entry.sessionId, entry.sessionLabel, draft);

    blocks.push(...buildChangeLines(before, after));
  }

  return blocks.join("\n");
}

async function listModuleSessions(timetableModuleId: string) {
  const { data, error } = await supabase
    .from("timetable_sessions")
    .select("*")
    .eq("timetable_module_id", timetableModuleId)
    .order("session_date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) throw error;

  return (data ?? []) as TimetableSessionRow[];
}

async function applySessionDraftUpdate(params: {
  sessionId: string;
  label: string;
  draft: DailySessionDraftInput;
  existingRow?: TimetableSessionRow;
}) {
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    session_date: normalizeSessionDate(params.draft.session_date),
    start_time: normalizeSessionTime(params.draft.start_time),
    end_time: normalizeSessionTime(params.draft.end_time),
    room_code: String(params.draft.room_code).trim(),
    status: params.draft.status,
  };

  if (params.draft.status === "cancel") {
    const label = String(params.existingRow?.session_label ?? params.label).trim();

    if (label) {
      patch.remark = formatCancelledRemark(label, params.draft.remark);
    } else {
      patch.remark = params.draft.remark.trim() || null;
    }
  } else {
    patch.remark = params.draft.remark.trim() || null;
  }

  const { error } = await supabase
    .from("timetable_sessions")
    .update(patch)
    .eq("id", params.sessionId);

  if (error) throw error;
}

export async function saveDailyTimetableModule(params: {
  academicYear: string;
  term: TimetableScheduleTerm;
  plan: DailyTimetableModulePlan;
  drafts: Record<string, DailySessionDraftInput>;
  pendingAdds?: PendingDailySessionAdd[];
  pendingDeletes?: string[];
  changedBy?: string | null;
}) {
  const pendingDeletes = new Set(params.pendingDeletes ?? []);
  const pendingAdds = params.pendingAdds ?? [];

  const beforeRows = await listModuleSessions(params.plan.timetableModuleId);
  const beforeById = new Map<string, SessionSnapshot>();

  for (const row of beforeRows) {
    beforeById.set(row.id, snapshotFromRow(row));
  }

  const changeSummary = buildModuleChangeSummary({
    beforeById,
    plan: params.plan,
    drafts: params.drafts,
    pendingAdds,
    pendingDeletes,
  });

  if (!changeSummary.trim()) {
    return {
      updatedCount: 0,
      changeSummary: "",
      emailSent: false,
      emailStatus: "skipped" as const,
      message: "No changes to save.",
    };
  }

  const { module } = await loadModuleCatalogContext(params.plan.timetableModuleId);
  const { termWeeks, excluded, termSummary } = await loadTermCalendarContext({
    academicYear: params.academicYear,
    term: params.term,
  });

  if (pendingDeletes.size > 0) {
    const { error } = await supabase
      .from("timetable_sessions")
      .delete()
      .in("id", Array.from(pendingDeletes));

    if (error) throw error;
  }

  const rowById = new Map(beforeRows.map((row) => [row.id, row]));

  const cancelUpdates = params.plan.entries.filter((entry) => {
    if (!entry.sessionId || pendingDeletes.has(entry.sessionId)) return false;
    const draft = params.drafts[entry.sessionId];
    return draft?.status === "cancel" && hasDraftChanges(entry, draft);
  });

  const otherUpdates = params.plan.entries.filter((entry) => {
    if (!entry.sessionId || pendingDeletes.has(entry.sessionId)) return false;
    const draft = params.drafts[entry.sessionId];
    if (!draft || draft.status === "cancel") return false;
    return hasDraftChanges(entry, draft);
  });

  for (const entry of cancelUpdates) {
    const draft = params.drafts[entry.sessionId!]!;
    await applySessionDraftUpdate({
      sessionId: entry.sessionId!,
      label: entry.sessionLabel,
      draft,
      existingRow: rowById.get(entry.sessionId!),
    });
  }

  for (const entry of otherUpdates) {
    const draft = params.drafts[entry.sessionId!]!;
    await applySessionDraftUpdate({
      sessionId: entry.sessionId!,
      label: entry.sessionLabel,
      draft,
      existingRow: rowById.get(entry.sessionId!),
    });
  }

  for (const pending of pendingAdds) {
    const sessionDate = normalizeSessionDate(pending.session_date);

    if (!isIsoDateInTermStudyWeek(sessionDate, termWeeks)) {
      throw new Error("Session date must fall within a study week.");
    }

    const { error } = await supabase.from("timetable_sessions").insert({
      academic_year: normalizeAcademicYear(params.academicYear),
      timetable_module_id: params.plan.timetableModuleId,
      module_instance_code: module.module_instance_code,
      module_code:
        String(module.base_module_code ?? "").trim() || module.module_instance_code,
      module_name: module.module_name,
      session_date: sessionDate,
      start_time: normalizeSessionTime(pending.start_time),
      end_time: normalizeSessionTime(pending.end_time),
      room_code: String(pending.room_code).trim(),
      teacher_name: pending.teacher_name ?? null,
      status: pending.status ?? "normal",
      remark: pending.remark.trim() || null,
      created_by: params.changedBy ?? null,
      updated_at: new Date().toISOString(),
    });

    if (error) throw error;
  }

  await applyDailyLabelsToTimetableModule(
    params.plan.timetableModuleId,
    termWeeks,
    termSummary,
    excluded
  );

  const emailResult = await recordAndSendDailyTimetableNotification({
    academicYear: params.academicYear,
    term: params.term,
    timetableModuleId: params.plan.timetableModuleId,
    moduleInstanceCode: params.plan.moduleInstanceCode,
    programmeCode: params.plan.programmeCode,
    changedBy: params.changedBy ?? null,
    changeSummary,
  });

  return {
    updatedCount:
      cancelUpdates.length + otherUpdates.length + pendingAdds.length + pendingDeletes.size,
    changeSummary,
    emailSent: emailResult.sent,
    emailStatus: emailResult.status,
    message: emailResult.message,
  };
}

async function recordAndSendDailyTimetableNotification(params: {
  academicYear: string;
  term: string;
  timetableModuleId: string;
  moduleInstanceCode: string;
  programmeCode: string;
  changedBy: string | null;
  changeSummary: string;
}) {
  const { data: inserted, error: insertError } = await supabase
    .from("timetable_daily_change_notifications")
    .insert({
      academic_year: params.academicYear,
      term: params.term,
      timetable_module_id: params.timetableModuleId,
      module_instance_code: params.moduleInstanceCode,
      programme_code: params.programmeCode,
      changed_by: params.changedBy,
      change_summary: params.changeSummary,
      email_to: TIMETABLE_NOTIFY_EMAIL,
      email_status: "pending",
    })
    .select("id")
    .single();

  if (insertError) {
    console.warn("[dailyTimetable] notification log insert failed:", insertError);
  }

  const { data: invokeData, error: invokeError } = await supabase.functions.invoke(
    "send-daily-timetable-notification",
    {
      body: {
        academicYear: params.academicYear,
        term: params.term,
        moduleInstanceCode: params.moduleInstanceCode,
        programmeCode: params.programmeCode,
        changedBy: params.changedBy,
        changeSummary: params.changeSummary,
      },
    }
  );

  let status: "sent" | "failed" | "skipped" = "failed";
  let message = "";
  let sent = false;

  if (invokeError) {
    message = `Changes saved. Email could not be sent (${invokeError.message}). Deploy the send-daily-timetable-notification edge function and set RESEND_API_KEY.`;
  } else if (invokeData?.sent) {
    status = "sent";
    sent = true;
    message = `Changes saved and email sent to ${TIMETABLE_NOTIFY_EMAIL}.`;
  } else if (invokeData?.skipped) {
    status = "skipped";
    message = `Changes saved. Email not sent: ${invokeData.reason ?? "mail not configured"}.`;
  } else {
    message = `Changes saved. Email failed: ${invokeData?.error ?? "unknown error"}.`;
  }

  if (inserted?.id) {
    await supabase
      .from("timetable_daily_change_notifications")
      .update({
        email_status: status,
        email_error: sent ? null : message,
      })
      .eq("id", inserted.id);
  }

  return { sent, status, message };
}
