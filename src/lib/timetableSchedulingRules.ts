/** Wednesday (JS getDay: Mon=1 .. Sat=6 in scheduler). */
export const FT_STAFF_MEETING_WEEKDAY = 3;

export const FT_STAFF_MEETING_PERIOD = "AM" as const;

/** Auto-schedule: Monday–Friday only (Saturday not used). */
export const SCHEDULING_WEEKDAYS = [1, 2, 3, 4, 5] as const;

export type SchedulingWeekday = (typeof SCHEDULING_WEEKDAYS)[number];

export function isFtEmploymentType(value: unknown): boolean {
  return String(value ?? "").trim().toUpperCase() === "FT";
}

export function normalizeTeacherNameKey(name: string): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ");
}

const MIKE_WONG_TEACHER_KEY = "mr mike wong";

/**
 * Hide combined instance teacher strings like "Mr Mike Wong; Mr. Mike Wong"
 * from the Schedule step dropdown. A single "Mr Mike Wong" is kept.
 */
export function isTeacherExcludedFromScheduleDropdown(name: string): boolean {
  const raw = String(name ?? "").trim();

  if (!raw.includes(",") && !raw.includes(";")) {
    return false;
  }

  const segments = raw
    .split(/[;,]/)
    .map((part) => normalizeTeacherNameKey(part))
    .filter(Boolean);

  if (segments.length < 2) {
    return false;
  }

  const mikeWongSegmentCount = segments.filter(
    (segment) => segment === MIKE_WONG_TEACHER_KEY
  ).length;

  return mikeWongSegmentCount >= 2;
}

export function buildFtTeacherNameSet(
  teachers: Array<{ teacher_name: string; employment_type?: string | null }>
): Set<string> {
  const set = new Set<string>();
  for (const teacher of teachers) {
    if (!isFtEmploymentType(teacher.employment_type)) continue;
    const name = String(teacher.teacher_name ?? "").trim();
    if (name) set.add(name);
  }
  return set;
}

export function isFtTeacherOnPage(teacherName: string, ftNames: Set<string>): boolean {
  const key = normalizeTeacherNameKey(teacherName);
  for (const ft of ftNames) {
    if (normalizeTeacherNameKey(ft) === key) return true;
  }
  return false;
}

/** True when any teacher listed on the instance is FT (supports "A; B"). */
export function instanceTeacherIncludesFt(
  instanceTeacherName: string,
  ftNames: Set<string>
): boolean {
  const ftKeys = new Set([...ftNames].map(normalizeTeacherNameKey));
  const segments = String(instanceTeacherName ?? "")
    .split(/[;,]/)
    .map((part) => normalizeTeacherNameKey(part))
    .filter(Boolean);

  if (segments.length === 0) return false;
  return segments.some((segment) => ftKeys.has(segment));
}

export function isFtWednesdayAmInstitutionalBlock(
  weekday: number,
  period: string
): boolean {
  return weekday === FT_STAFF_MEETING_WEEKDAY && period === FT_STAFF_MEETING_PERIOD;
}

export function applyFtWednesdayAmInstitutionalBlock(params: {
  naSet: Set<string>;
  teacherName: string;
}) {
  params.naSet.add(
    `${params.teacherName}||${FT_STAFF_MEETING_WEEKDAY}||${FT_STAFF_MEETING_PERIOD}`
  );
}

export function applyFtWednesdayAmToTeacherDraft(draft: Set<string>) {
  draft.add(`${FT_STAFF_MEETING_WEEKDAY}|${FT_STAFF_MEETING_PERIOD}`);
}

/**
 * - `nil` / empty: programme-wide (all streams in this programme).
 * - `mixed`: combined-group timetable row (multiple streams in one class).
 * - otherwise: explicit stream (e.g. IS, NET).
 */
export function normalizeSchedulingStream(streamCode: string | null | undefined) {
  const text = String(streamCode ?? "")
    .trim()
    .toLowerCase();

  if (!text || text === "nil") {
    return "nil";
  }

  if (text === "mixed") {
    return "mixed";
  }

  return text;
}

/** Programme-wide (`nil`) shares a scheduling group with every explicit stream. */
export function isSameStreamSchedulingGroup(
  streamA: string,
  streamB: string
) {
  if (streamA === streamB) {
    return true;
  }

  if (streamA === "mixed" || streamB === "mixed") {
    return false;
  }

  return streamA === "nil" || streamB === "nil";
}

/** Different explicit streams (e.g. IS vs NET) — may align to the same timeslot. */
export function streamsAreDifferentForAlignment(
  streamA: string,
  streamB: string
) {
  if (isSameStreamSchedulingGroup(streamA, streamB)) {
    return false;
  }

  if (streamA === "mixed" || streamB === "mixed") {
    return false;
  }

  return streamA !== streamB;
}

export interface StreamYearTimeslotState {
  /** Keys from buildStreamYearTimeslotKey */
  byStreamYearTimeslot: Set<string>;
  /** Set when a programme-wide (nil) class occupies a year+slot */
  programmeAllStreamYearSlots: Set<string>;
}

export function createStreamYearTimeslotState(): StreamYearTimeslotState {
  return {
    byStreamYearTimeslot: new Set<string>(),
    programmeAllStreamYearSlots: new Set<string>(),
  };
}

function buildProgrammeAllStreamYearSlotMarker(params: {
  programmeCode: string;
  moduleYear: string;
  slotKey: string;
}) {
  return `${normalizeProgrammeKey(params.programmeCode)}|ALL|${String(
    params.moduleYear ?? ""
  )
    .trim()
    .toUpperCase()}|${params.slotKey}`;
}

export function isStreamYearTimeslotBlocked(
  state: StreamYearTimeslotState,
  params: {
    programmeCode: string;
    streamKey: string;
    moduleYear: string;
    slotKey: string;
  }
) {
  const programmeKey = normalizeProgrammeKey(params.programmeCode);
  const streamKey = params.streamKey;
  const year = String(params.moduleYear ?? "")
    .trim()
    .toUpperCase();
  const slotKey = params.slotKey;

  const ownKey = buildStreamYearTimeslotKey({
    programmeCode: programmeKey,
    streamKey,
    moduleYear: year,
    slotKey,
  });

  if (state.byStreamYearTimeslot.has(ownKey)) {
    return true;
  }

  const allMarker = buildProgrammeAllStreamYearSlotMarker({
    programmeCode: programmeKey,
    moduleYear: year,
    slotKey,
  });

  if (state.programmeAllStreamYearSlots.has(allMarker)) {
    return true;
  }

  if (streamKey === "nil") {
    const prefix = `${programmeKey}|`;
    const suffix = `|${year}|${slotKey}`;

    for (const key of state.byStreamYearTimeslot) {
      if (!key.startsWith(prefix) || !key.endsWith(suffix)) {
        continue;
      }

      const streamPart = key.slice(prefix.length).split("|")[0] ?? "";

      if (
        streamPart &&
        streamPart !== "nil" &&
        streamPart !== "mixed" &&
        streamPart !== "ALL"
      ) {
        return true;
      }
    }
  } else if (streamKey !== "mixed") {
    const nilKey = buildStreamYearTimeslotKey({
      programmeCode: programmeKey,
      streamKey: "nil",
      moduleYear: year,
      slotKey,
    });

    if (state.byStreamYearTimeslot.has(nilKey)) {
      return true;
    }
  }

  return false;
}

export function registerStreamYearTimeslot(
  state: StreamYearTimeslotState,
  params: {
    programmeCode: string;
    streamKey: string;
    moduleYear: string;
    slotKey: string;
  }
) {
  const programmeKey = normalizeProgrammeKey(params.programmeCode);
  const streamKey = params.streamKey;
  const year = String(params.moduleYear ?? "")
    .trim()
    .toUpperCase();
  const slotKey = params.slotKey;

  state.byStreamYearTimeslot.add(
    buildStreamYearTimeslotKey({
      programmeCode: programmeKey,
      streamKey,
      moduleYear: year,
      slotKey,
    })
  );

  if (streamKey === "nil") {
    state.programmeAllStreamYearSlots.add(
      buildProgrammeAllStreamYearSlotMarker({
        programmeCode: programmeKey,
        moduleYear: year,
        slotKey,
      })
    );
  }
}

export function buildModuleStreamAlignKey(
  programmeCode: string,
  moduleCode: string
) {
  return `${String(programmeCode ?? "")
    .trim()
    .toUpperCase()}|${String(moduleCode ?? "")
    .trim()
    .toUpperCase()}`;
}

export function buildStreamYearSlotKey(
  programmeCode: string,
  streamKey: string,
  moduleYear: string
) {
  return `${String(programmeCode ?? "")
    .trim()
    .toUpperCase()}|${streamKey}|${String(moduleYear ?? "")
    .trim()
    .toUpperCase()}`;
}

/** Collapsed weekly slot identity (Mon=1 .. Sat=6). */
export function buildWeeklyTimeslotKey(params: {
  weekday: number;
  start: string;
  end: string;
}) {
  return `${params.weekday}|${String(params.start ?? "").slice(0, 5)}|${String(params.end ?? "").slice(0, 5)}`;
}

/** Same programme + stream + year cannot share a weekly timeslot; different streams may. */
export function buildStreamYearTimeslotKey(params: {
  programmeCode: string;
  streamKey: string;
  moduleYear: string;
  slotKey: string;
}) {
  return `${buildStreamYearSlotKey(
    params.programmeCode,
    params.streamKey,
    params.moduleYear
  )}|${params.slotKey}`;
}

export function buildStreamSlotKey(programmeCode: string, streamKey: string) {
  return `${String(programmeCode ?? "")
    .trim()
    .toUpperCase()}|${streamKey}`;
}

export function normalizeProgrammeKey(programmeCode: string) {
  return String(programmeCode ?? "")
    .trim()
    .toUpperCase();
}

/**
 * Score a feasible slot. Returns null when hard-rejected (same stream + same year already uses slot).
 *
 * Preferences:
 * - Align different streams (same module, or other modules in programme e.g. CS423 / CS407)
 * - Same stream + different year: avoid same slot (soft)
 * - Same stream + same year: must not share slot (hard)
 */
export function scoreAutoScheduleSlot(params: {
  slotKey: string;
  streamKey: string;
  moduleYear: string;
  alignKey: string;
  programmeCode: string;
  streamYearTimeslotState: StreamYearTimeslotState;
  streamSlotByModule: Map<string, Map<string, string>>;
  streamYearOccupiedSlots: Map<string, Set<string>>;
  streamAllOccupiedSlots: Map<string, Set<string>>;
  programmeSlotStreams: Map<string, Map<string, Set<string>>>;
}): number | null {
  if (
    isStreamYearTimeslotBlocked(params.streamYearTimeslotState, {
      programmeCode: params.programmeCode,
      streamKey: params.streamKey,
      moduleYear: params.moduleYear,
      slotKey: params.slotKey,
    })
  ) {
    return null;
  }

  let score = 0;

  const slotsByStream = params.streamSlotByModule.get(params.alignKey);

  if (slotsByStream) {
    for (const [otherStream, otherSlot] of slotsByStream) {
      if (
        streamsAreDifferentForAlignment(params.streamKey, otherStream) &&
        otherSlot === params.slotKey
      ) {
        score += 200;
      }
    }
  }

  const programmeKey = normalizeProgrammeKey(params.programmeCode);
  const streamsAtSlot = params.programmeSlotStreams.get(programmeKey)?.get(
    params.slotKey
  );

  if (streamsAtSlot) {
    for (const otherStream of streamsAtSlot) {
      if (streamsAreDifferentForAlignment(params.streamKey, otherStream)) {
        score += 120;
      }
    }
  }

  const streamYearKey = buildStreamYearSlotKey(
    params.programmeCode,
    params.streamKey,
    params.moduleYear
  );

  if (params.streamYearOccupiedSlots.get(streamYearKey)?.has(params.slotKey)) {
    score -= 80;
  }

  for (const [otherStreamKey, slots] of params.streamYearOccupiedSlots) {
    if (!slots.has(params.slotKey)) continue;

    const otherStream = otherStreamKey.split("|")[1] ?? "";

    if (isSameStreamSchedulingGroup(params.streamKey, otherStream)) {
      return null;
    }
  }

  const streamAllKey = buildStreamSlotKey(params.programmeCode, params.streamKey);

  if (params.streamAllOccupiedSlots.get(streamAllKey)?.has(params.slotKey)) {
    score -= 80;
  }

  return score;
}

export function recordAutoSchedulePlacement(params: {
  programmeCode: string;
  streamKey: string;
  moduleYear: string;
  alignKey: string;
  slotKey: string;
  streamYearTimeslotState: StreamYearTimeslotState;
  streamSlotByModule: Map<string, Map<string, string>>;
  streamYearOccupiedSlots: Map<string, Set<string>>;
  streamAllOccupiedSlots: Map<string, Set<string>>;
  programmeSlotStreams: Map<string, Map<string, Set<string>>>;
}) {
  if (!params.streamSlotByModule.has(params.alignKey)) {
    params.streamSlotByModule.set(params.alignKey, new Map());
  }
  params.streamSlotByModule.get(params.alignKey)!.set(params.streamKey, params.slotKey);

  const streamYearKey = buildStreamYearSlotKey(
    params.programmeCode,
    params.streamKey,
    params.moduleYear
  );

  if (!params.streamYearOccupiedSlots.has(streamYearKey)) {
    params.streamYearOccupiedSlots.set(streamYearKey, new Set());
  }
  params.streamYearOccupiedSlots.get(streamYearKey)!.add(params.slotKey);

  registerStreamYearTimeslot(params.streamYearTimeslotState, {
    programmeCode: params.programmeCode,
    streamKey: params.streamKey,
    moduleYear: params.moduleYear,
    slotKey: params.slotKey,
  });

  const streamAllKey = buildStreamSlotKey(params.programmeCode, params.streamKey);

  if (!params.streamAllOccupiedSlots.has(streamAllKey)) {
    params.streamAllOccupiedSlots.set(streamAllKey, new Set());
  }
  params.streamAllOccupiedSlots.get(streamAllKey)!.add(params.slotKey);

  const programmeKey = normalizeProgrammeKey(params.programmeCode);

  if (!params.programmeSlotStreams.has(programmeKey)) {
    params.programmeSlotStreams.set(programmeKey, new Map());
  }

  const slotMap = params.programmeSlotStreams.get(programmeKey)!;

  if (!slotMap.has(params.slotKey)) {
    slotMap.set(params.slotKey, new Set());
  }
  slotMap.get(params.slotKey)!.add(params.streamKey);
}
