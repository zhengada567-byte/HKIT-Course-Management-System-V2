/** Fixed weekly timetable UI bands (display only; sessions keep exact times). */

export type WeeklyPeriodBandId = "morning" | "afternoon" | "evening";

export type WeeklyPeriodBand = {
  id: WeeklyPeriodBandId;
  /** Grid row key — also the default start written on Add. */
  slotStart: string;
  /** Default end written on Add (4h block). */
  slotEnd: string;
  /** Inclusive window start for overlap / cross-band detection. */
  windowStart: string;
  /** Exclusive window end for overlap (R1: morning ends at 13:00 inclusive for sessions). */
  windowEnd: string;
  /** UI label for the Time column. */
  label: string;
};

/**
 * Labels use Unicode escapes so file encoding cannot strip CJK text.
 * Display target: 上午（08–13）/ 下午（13–18）/ 晚上（18:30–22:30）
 */
export const WEEKLY_PERIOD_BANDS: WeeklyPeriodBand[] = [
  {
    id: "morning",
    slotStart: "09:00",
    slotEnd: "13:00",
    windowStart: "08:00",
    windowEnd: "13:00",
    // 上午（08–13）
    label: "\u4e0a\u5348\uff0808\u201313\uff09",
  },
  {
    id: "afternoon",
    slotStart: "14:00",
    slotEnd: "18:00",
    windowStart: "13:00",
    windowEnd: "18:00",
    // 下午（13–18）
    label: "\u4e0b\u5348\uff0813\u201318\uff09",
  },
  {
    id: "evening",
    slotStart: "18:30",
    slotEnd: "22:30",
    windowStart: "18:30",
    windowEnd: "22:30",
    // 晚上（18:30–22:30）
    label: "\u665a\u4e0a\uff0818:30\u201322:30\uff09",
  },
];

export function listFixedWeeklyPeriodSlots(): Array<{
  start: string;
  end: string;
  label: string;
  bandId: WeeklyPeriodBandId;
}> {
  return WEEKLY_PERIOD_BANDS.map((band) => ({
    start: band.slotStart,
    end: band.slotEnd,
    label: band.label,
    bandId: band.id,
  }));
}

function parseHmToMinutes(value: string): number {
  const text = String(value ?? "").trim().slice(0, 5);
  const [hhText, mmText] = text.split(":");
  const hh = Number(hhText);
  const mm = Number(mmText);

  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return NaN;
  return hh * 60 + mm;
}

/** True overlap; endpoint-only touch does not count. */
function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Which UI bands a placement spans.
 * Cross-band (e.g. 10:00–14:00) returns multiple ids.
 */
export function resolveWeeklyPeriodBands(
  startTime: string,
  endTime: string
): WeeklyPeriodBand[] {
  const start = parseHmToMinutes(startTime);
  let end = parseHmToMinutes(endTime);

  if (!Number.isFinite(start)) {
    return [WEEKLY_PERIOD_BANDS[0]!];
  }

  if (!Number.isFinite(end) || end <= start) {
    end = start + 4 * 60;
  }

  const matched = WEEKLY_PERIOD_BANDS.filter((band) => {
    const windowStart = parseHmToMinutes(band.windowStart);
    const windowEnd = parseHmToMinutes(band.windowEnd);
    return rangesOverlap(start, end, windowStart, windowEnd);
  });

  if (matched.length > 0) {
    return matched;
  }

  // Fallback: R1 exclusive by start / end when outside windows.
  if (end <= parseHmToMinutes("13:00") && start < parseHmToMinutes("13:00")) {
    return [WEEKLY_PERIOD_BANDS[0]!];
  }

  if (start >= parseHmToMinutes("18:30")) {
    return [WEEKLY_PERIOD_BANDS[2]!];
  }

  return [WEEKLY_PERIOD_BANDS[1]!];
}

export function findWeeklyPeriodBand(params: {
  slotStart?: string | null;
  bandId?: WeeklyPeriodBandId | string | null;
}): WeeklyPeriodBand | undefined {
  const bandId = String(params.bandId ?? "").trim();
  if (bandId) {
    const byId = WEEKLY_PERIOD_BANDS.find((row) => row.id === bandId);
    if (byId) return byId;
  }

  const start = String(params.slotStart ?? "").trim().slice(0, 5);
  return WEEKLY_PERIOD_BANDS.find((row) => row.slotStart === start);
}

/** Always returns 上午/下午/晚上 labels for the three fixed bands. */
export function weeklyPeriodBandLabel(
  slotStart: string,
  bandId?: WeeklyPeriodBandId | string | null
): string {
  const band = findWeeklyPeriodBand({ slotStart, bandId });
  if (band) return band.label;

  const start = String(slotStart ?? "").trim().slice(0, 5);
  return start || "\u2014";
}
