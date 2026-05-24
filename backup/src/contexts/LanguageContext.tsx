import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { translations } from "../translations";

export type Language = "zhHant" | "en";

const STORAGE_KEY = "hkit_language";

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Record<string, string>;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(
  undefined
);

function getInitialLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY);

  if (stored === "en" || stored === "zhHant") {
    return stored;
  }

  return "zhHant";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

  function setLanguage(next: Language) {
    localStorage.setItem(STORAGE_KEY, next);
    setLanguageState(next);
  }

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      t: translations[language],
    }),
    [language]
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);

  if (!ctx) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }

  return ctx;
}
