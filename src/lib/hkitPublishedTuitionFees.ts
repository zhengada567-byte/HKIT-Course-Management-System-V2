/**
 * Published FT annual tuition fees from HKIT programme pages
 * (https://www.hkit.edu.hk/en/programmes/hd/ and /degree/).
 *
 * Values are reference defaults for AccountHR; editable after load.
 * Degree programmes often differ by year — `ftAnnualFee` uses the
 * common top-up / Y3 band where published; see `feeByYear` when available.
 */

export type PublishedTuitionFee = {
  programmeCode: string;
  programmeName: string;
  kind: "hd" | "degree";
  /** Primary FT annual fee used as default for programme_tuition_fees. */
  ftAnnualFee: number;
  feeByYear?: Partial<Record<"Y1" | "Y2" | "Y3", number>>;
  ptPerSubjectFee?: number;
  sourceUrl: string;
  note?: string;
};

export const HKIT_PUBLISHED_TUITION_FEES: PublishedTuitionFee[] = [
  {
    programmeCode: "HDC",
    programmeName: "Higher Diploma in Information Technology (Computing)",
    kind: "hd",
    ftAnnualFee: 56000,
    feeByYear: { Y1: 56000, Y2: 56000 },
    ptPerSubjectFee: 7000,
    sourceUrl: "https://www.hkit.edu.hk/en/programmes/hd/HDC/",
  },
  {
    programmeCode: "HDBA",
    programmeName: "Higher Diploma in Business Administration",
    kind: "hd",
    ftAnnualFee: 58000,
    feeByYear: { Y1: 58000, Y2: 58000 },
    sourceUrl: "https://www.hkit.edu.hk/en/programmes/hd/HDBA/",
  },
  {
    programmeCode: "HDHC",
    programmeName: "Higher Diploma in Health Care",
    kind: "hd",
    ftAnnualFee: 56000,
    feeByYear: { Y1: 56000, Y2: 56000 },
    ptPerSubjectFee: 7000,
    sourceUrl: "https://www.hkit.edu.hk/en/programmes/hd/HDHC",
  },
  {
    programmeCode: "HDEE",
    programmeName: "Higher Diploma in Electrical Engineering",
    kind: "hd",
    ftAnnualFee: 58000,
    feeByYear: { Y1: 58000, Y2: 58000 },
    sourceUrl: "https://www.hkit.edu.hk/en/programmes/hd/HDEE/",
  },
  {
    programmeCode: "HDEEI",
    programmeName: "Higher Diploma in Electrical Engineering",
    kind: "hd",
    ftAnnualFee: 58000,
    feeByYear: { Y1: 58000, Y2: 58000 },
    sourceUrl: "https://www.hkit.edu.hk/en/programmes/hd/HDEE/",
    note: "Same published fee as HDEE.",
  },
  {
    programmeCode: "HDCI",
    programmeName: "Higher Diploma in Crime and Investigation",
    kind: "hd",
    ftAnnualFee: 56000,
    sourceUrl: "https://www.hkit.edu.hk/en/programmes/hd/",
    note: "Confirm on programme page; seeded from typical HD band.",
  },
  {
    programmeCode: "UWLCS",
    programmeName: "BSc (Hons) Computer Science (UWL)",
    kind: "degree",
    ftAnnualFee: 71800,
    feeByYear: { Y1: 62270, Y2: 71800, Y3: 71800 },
    sourceUrl: "https://www.hkit.edu.hk/en/programmes/degree/uwl-computer-science/",
    note: "Gross FT fee before NMTSS (HK$35,120 in 2026/27).",
  },
  {
    programmeCode: "UWLCFI",
    programmeName: "BSc (Hons) Criminology with Forensic Investigation (UWL)",
    kind: "degree",
    ftAnnualFee: 71800,
    sourceUrl: "https://www.hkit.edu.hk/en/programmes/degree/",
    note: "Confirm on programme page; default aligned to UWL CS Y2/Y3 band.",
  },
  {
    programmeCode: "UWLBS",
    programmeName: "BA (Hons) Business Studies (UWL)",
    kind: "degree",
    ftAnnualFee: 71800,
    sourceUrl: "https://www.hkit.edu.hk/en/programmes/degree/",
    note: "Confirm on programme page; Degree list shows net ~$15,020+ after NMTSS.",
  },
  {
    programmeCode: "UWLPH",
    programmeName: "BSc (Hons) Public Health (UWL)",
    kind: "degree",
    ftAnnualFee: 78600,
    feeByYear: { Y1: 61000, Y2: 78600, Y3: 78600 },
    sourceUrl: "https://www.hkit.edu.hk/en/programmes/degree/uwl-public-health/",
    note: "Gross FT fee before NMTSS.",
  },
];

export const HKIT_TUITION_SOURCE_HD =
  "https://www.hkit.edu.hk/en/programmes/hd/";
export const HKIT_TUITION_SOURCE_DEGREE =
  "https://www.hkit.edu.hk/en/programmes/degree/";

export function getPublishedTuitionFee(programmeCode: string) {
  const code = String(programmeCode ?? "").trim().toUpperCase();
  return (
    HKIT_PUBLISHED_TUITION_FEES.find((row) => row.programmeCode === code) ?? null
  );
}
