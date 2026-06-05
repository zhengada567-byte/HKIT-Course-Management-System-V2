import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  getFeatureUpdateLocks,
  type FeatureUpdateLocks,
} from "../services/featureLockService";

interface FeatureUpdateLockContextValue {
  locks: FeatureUpdateLocks;
  loading: boolean;
  refreshLocks: () => Promise<void>;
}

const defaultLocks: FeatureUpdateLocks = {
  courseSearchLocked: true,
  moduleTeacherLocked: false,
  uploadExcelLocked: true,
};

const FeatureUpdateLockContext = createContext<FeatureUpdateLockContextValue>({
  locks: defaultLocks,
  loading: true,
  refreshLocks: async () => {},
});

export function FeatureUpdateLockProvider({ children }: { children: ReactNode }) {
  const [locks, setLocks] = useState<FeatureUpdateLocks>(defaultLocks);
  const [loading, setLoading] = useState(true);

  const refreshLocks = useCallback(async () => {
    try {
      const next = await getFeatureUpdateLocks();
      setLocks(next);
    } catch (error) {
      console.error("[FeatureUpdateLockProvider] Failed to load locks:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshLocks();
  }, [refreshLocks]);

  const value = useMemo(
    () => ({
      locks,
      loading,
      refreshLocks,
    }),
    [locks, loading, refreshLocks]
  );

  return (
    <FeatureUpdateLockContext.Provider value={value}>
      {children}
    </FeatureUpdateLockContext.Provider>
  );
}

export function useFeatureUpdateLocks() {
  return useContext(FeatureUpdateLockContext);
}
