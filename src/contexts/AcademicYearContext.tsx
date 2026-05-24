import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  offeredTermFromStudyTerm,
} from "../pages/programme-leader/make-study-plan/helpers";
import {
  getCurrentAcademicYear,
  getCurrentStudyTerm,
} from "../services/academicYearService";
import { getPreviousAcademicYear } from "../lib/utils";
import type { ModuleTerm } from "../types/common";

interface AcademicYearContextValue {
  academicYear: string;
  previousAcademicYear: string;
  currentStudyTerm: string;
  currentOfferedTerm: ModuleTerm;
  loading: boolean;
  refreshAcademicYear: () => Promise<void>;
  setLocalAcademicYear: (academicYear: string) => void;
}

const AcademicYearContext = createContext<AcademicYearContextValue | undefined>(
  undefined
);

export function AcademicYearProvider({ children }: { children: ReactNode }) {
  const [academicYear, setAcademicYear] = useState("2026/2027");
  const [currentStudyTerm, setCurrentStudyTerm] = useState("T2026A");
  const [loading, setLoading] = useState(true);

  async function refreshAcademicYear() {
    setLoading(true);

    try {
      const [year, studyTerm] = await Promise.all([
        getCurrentAcademicYear(),
        getCurrentStudyTerm(),
      ]);

      setAcademicYear(year);
      setCurrentStudyTerm(studyTerm);
    } finally {
      setLoading(false);
    }
  }

  function setLocalAcademicYear(next: string) {
    setAcademicYear(next);
  }

  useEffect(() => {
    void refreshAcademicYear();
  }, []);

  const value = useMemo<AcademicYearContextValue>(
    () => ({
      academicYear,
      previousAcademicYear: getPreviousAcademicYear(academicYear),
      currentStudyTerm,
      currentOfferedTerm: offeredTermFromStudyTerm(currentStudyTerm),
      loading,
      refreshAcademicYear,
      setLocalAcademicYear,
    }),
    [academicYear, currentStudyTerm, loading]
  );

  return (
    <AcademicYearContext.Provider value={value}>
      {children}
    </AcademicYearContext.Provider>
  );
}

export function useAcademicYear() {
  const ctx = useContext(AcademicYearContext);

  if (!ctx) {
    throw new Error(
      "useAcademicYear must be used within AcademicYearProvider"
    );
  }

  return ctx;
}
