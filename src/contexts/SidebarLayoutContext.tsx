import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface SidebarLayoutContextValue {
  /** Desktop sidebar collapsed (more room for editor). Mobile drawer unchanged. */
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  expand: () => void;
  collapse: () => void;
}

const SidebarLayoutContext = createContext<SidebarLayoutContextValue | null>(
  null
);

export function SidebarLayoutProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  const expand = useCallback(() => {
    setCollapsed(false);
  }, []);

  const collapse = useCallback(() => {
    setCollapsed(true);
  }, []);

  const value = useMemo(
    () => ({
      collapsed,
      setCollapsed,
      expand,
      collapse,
    }),
    [collapsed, expand, collapse]
  );

  return (
    <SidebarLayoutContext.Provider value={value}>
      {children}
    </SidebarLayoutContext.Provider>
  );
}

export function useSidebarLayout() {
  const context = useContext(SidebarLayoutContext);

  if (!context) {
    throw new Error("useSidebarLayout must be used within SidebarLayoutProvider");
  }

  return context;
}

/** Safe when outside provider (e.g. tests) — returns null. */
export function useSidebarLayoutOptional() {
  return useContext(SidebarLayoutContext);
}
