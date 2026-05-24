import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { getCurrentAcademicYear } from "../services/academicYearService";
import { getPreviousAcademicYear } from "../lib/utils";

interface AcademicYearContextValue {
  academicYear: string;
  previousAcademicYear: string;
  loading: boolean;
  refreshAcademicYear: () => Promise<void>;
  setLocalAcademicYear: (academicYear: string) => void;
}

const AcademicYearContext = createContext<AcademicYearContextValue | undefined>(
  undefined
);

export function AcademicYearProvider({ children }: { children: ReactNode }) {
  const [academicYear, setAcademicYear] = useState("2026/2027");
  const [loading, setLoading] = useState(true);

  async function refreshAcademicYear() {
    setLoading(true);

    try {
      const year = await getCurrentAcademicYear();
      setAcademicYear(year);
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
      loading,
      refreshAcademicYear,
      setLocalAcademicYear,
    }),
    [academicYear, loading]
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
