import { supabase } from "../lib/supabase";
import { normalizeAcademicYear } from "../lib/utils";
import type {
  TimetableClassroomRow,
  TimetableRoomType,
} from "./timetableScheduleService";

export type ClassroomAvailabilityPeriod = "AM" | "PM" | "EVENING";

export interface TimetableClassroomNotAvailableRow {
  id: string;
  academic_year: string;
  room_code: string;
  weekday: number;
  period: ClassroomAvailabilityPeriod;
  created_at: string;
  updated_at: string;
}

export function buildTimetableRoomCode(location: string, roomNumber: string) {
  const loc = String(location ?? "").trim().toUpperCase();
  const num = String(roomNumber ?? "").trim();
  if (!loc || !num) {
    throw new Error("Location and room number are required.");
  }
  return `${loc}-${num}`;
}

function isMissingClassroomTableError(error: { status?: number; code?: string }) {
  return error?.status === 404 || error?.code === "PGRST205";
}

function normalizeClassroomRow(row: Partial<TimetableClassroomRow>): TimetableClassroomRow {
  const roomCode = String(row.room_code ?? "").trim();
  const location =
    String(row.location ?? "").trim() ||
    (roomCode.includes("-") ? roomCode.split("-")[0]! : roomCode);
  const roomNumber =
    String(row.room_number ?? "").trim() ||
    (roomCode.includes("-") ? roomCode.split("-").slice(1).join("-") : roomCode);

  return {
    room_code: roomCode,
    location,
    room_number: roomNumber,
    room_size: Number(row.room_size ?? 0),
    room_type: (row.room_type ?? "normal") as TimetableRoomType,
  };
}

export async function upsertTimetableClassroom(params: {
  originalRoomCode?: string;
  location: string;
  roomNumber: string;
  roomSize: number;
  roomType: TimetableRoomType;
}): Promise<TimetableClassroomRow> {
  const location = String(params.location ?? "").trim();
  const roomNumber = String(params.roomNumber ?? "").trim();
  const roomSize = Number(params.roomSize);
  const roomType = params.roomType;

  if (!location || !roomNumber) {
    throw new Error("Location and room number are required.");
  }
  if (!Number.isFinite(roomSize) || roomSize <= 0) {
    throw new Error("Room size must be greater than 0.");
  }

  const roomCode = buildTimetableRoomCode(location, roomNumber);
  const originalRoomCode = String(params.originalRoomCode ?? "").trim();
  const now = new Date().toISOString();
  const payload = {
    room_code: roomCode,
    location,
    room_number: roomNumber,
    room_size: roomSize,
    room_type: roomType,
    updated_at: now,
  };

  if (originalRoomCode && originalRoomCode !== roomCode) {
    const { error: insertError } = await supabase
      .from("timetable_classrooms")
      .upsert(payload, { onConflict: "room_code" });

    if (insertError) throw insertError;

    const { error: sessionError } = await supabase
      .from("timetable_sessions")
      .update({ room_code: roomCode, updated_at: now })
      .eq("room_code", originalRoomCode);

    if (sessionError) throw sessionError;

    const { error: availabilityError } = await supabase
      .from("timetable_classroom_not_available")
      .update({ room_code: roomCode, updated_at: now })
      .eq("room_code", originalRoomCode);

    if (
      availabilityError &&
      !isMissingClassroomTableError(
        availabilityError as { status?: number; code?: string }
      )
    ) {
      throw availabilityError;
    }

    const { error: deleteError } = await supabase
      .from("timetable_classrooms")
      .delete()
      .eq("room_code", originalRoomCode);

    if (deleteError) throw deleteError;
  } else {
    const { error } = await supabase
      .from("timetable_classrooms")
      .upsert(payload, { onConflict: "room_code" });

    if (error) throw error;
  }

  const { data, error: readError } = await supabase
    .from("timetable_classrooms")
    .select("room_code, location, room_number, room_size, room_type")
    .eq("room_code", roomCode)
    .single();

  if (readError) throw readError;
  return normalizeClassroomRow(data as TimetableClassroomRow);
}

export async function deleteTimetableClassroom(roomCode: string) {
  const code = String(roomCode ?? "").trim();
  if (!code) {
    throw new Error("Room code is required.");
  }

  const { count, error: countError } = await supabase
    .from("timetable_sessions")
    .select("id", { count: "exact", head: true })
    .eq("room_code", code);

  if (countError) throw countError;
  if ((count ?? 0) > 0) {
    throw new Error(
      "Cannot delete this classroom because scheduled sessions still reference it."
    );
  }

  const { error } = await supabase
    .from("timetable_classrooms")
    .delete()
    .eq("room_code", code);

  if (error) throw error;
}

export async function listClassroomNotAvailableForRooms(params: {
  academicYear: string;
  roomCodes: string[];
}): Promise<TimetableClassroomNotAvailableRow[]> {
  const roomCodes = params.roomCodes.map((code) => String(code ?? "").trim()).filter(Boolean);
  if (roomCodes.length === 0) return [];

  const { data, error } = await supabase
    .from("timetable_classroom_not_available")
    .select("*")
    .eq("academic_year", normalizeAcademicYear(params.academicYear))
    .in("room_code", roomCodes);

  if (error) {
    if (isMissingClassroomTableError(error as { status?: number; code?: string })) {
      return [];
    }
    throw error;
  }

  return (data ?? []) as TimetableClassroomNotAvailableRow[];
}

export async function setClassroomNotAvailable(params: {
  academicYear: string;
  roomCode: string;
  weekday: 1 | 2 | 3 | 4 | 5 | 6;
  period: ClassroomAvailabilityPeriod;
  notAvailable: boolean;
}) {
  const academicYear = normalizeAcademicYear(params.academicYear);
  const roomCode = String(params.roomCode ?? "").trim();
  if (!roomCode) return;

  if (params.notAvailable) {
    const { error } = await supabase.from("timetable_classroom_not_available").upsert(
      {
        academic_year: academicYear,
        room_code: roomCode,
        weekday: params.weekday,
        period: params.period,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "academic_year,room_code,weekday,period" }
    );
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from("timetable_classroom_not_available")
    .delete()
    .eq("academic_year", academicYear)
    .eq("room_code", roomCode)
    .eq("weekday", params.weekday)
    .eq("period", params.period);

  if (error) throw error;
}

export async function saveClassroomNotAvailableDraft(params: {
  academicYear: string;
  roomCode: string;
  draftKeys: Set<string>;
  originalKeys: Set<string>;
}) {
  const academicYear = normalizeAcademicYear(params.academicYear);
  const roomCode = String(params.roomCode ?? "").trim();
  if (!roomCode) return;

  const changedKeys = new Set<string>();
  for (const key of params.draftKeys) {
    if (!params.originalKeys.has(key)) changedKeys.add(key);
  }
  for (const key of params.originalKeys) {
    if (!params.draftKeys.has(key)) changedKeys.add(key);
  }

  for (const key of changedKeys) {
    const [weekdayRaw, period] = key.split("|");
    const weekday = Number(weekdayRaw) as 1 | 2 | 3 | 4 | 5 | 6;
    if (!weekday || !period) continue;

    await setClassroomNotAvailable({
      academicYear,
      roomCode,
      weekday,
      period: period as ClassroomAvailabilityPeriod,
      notAvailable: params.draftKeys.has(key),
    });
  }
}

export { normalizeClassroomRow };
