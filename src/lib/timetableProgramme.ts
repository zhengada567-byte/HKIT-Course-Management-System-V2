/** Cross-programme combined timetable rows use this programme code. */
export const MIXED_PROGRAMME_CODE = "MIXED";

export const MIXED_STREAM_CODE = "MIXED";

export function isMixedProgrammeCode(programmeCode: string | null | undefined) {
  return (
    String(programmeCode ?? "")
      .trim()
      .toUpperCase() === MIXED_PROGRAMME_CODE
  );
}

export function isMixedStreamCode(streamCode: string | null | undefined) {
  return (
    String(streamCode ?? "")
      .trim()
      .toUpperCase() === MIXED_STREAM_CODE
  );
}

export function formatProgrammeCodeOptionLabel(programmeCode: string) {
  return isMixedProgrammeCode(programmeCode) ? "Mixed" : programmeCode;
}
