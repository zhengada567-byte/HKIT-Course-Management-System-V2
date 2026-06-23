import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { loginStaffUser, loginWithPassword } from "../lib/auth";
import type { AppUser, AuthSession, UserRole } from "../types";

const STORAGE_KEY = "hkit_auth_session";

interface AuthContextValue {
  user: AppUser | null;
  isAuthenticated: boolean;
  role: UserRole | null;
  login: (username: string, password: string) => Promise<boolean>;
  loginStaff: () => Promise<boolean>;
  logout: () => void;
  hasRole: (roles?: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readStoredSession(): AuthSession | null {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) return null;

  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);

  useEffect(() => {
    const session = readStoredSession();
    if (session?.user) {
      setUser(session.user);
    }
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const loggedInUser = await loginWithPassword(username, password);

    if (!loggedInUser) {
      return false;
    }

    const session: AuthSession = {
      user: loggedInUser,
      loginAt: new Date().toISOString(),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    setUser(loggedInUser);

    return true;
  }, []);

  const loginStaff = useCallback(async () => {
    const loggedInUser = await loginStaffUser();

    if (!loggedInUser) {
      return false;
    }

    const session: AuthSession = {
      user: loggedInUser,
      loginAt: new Date().toISOString(),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    setUser(loggedInUser);

    return true;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  }, []);

  const hasRole = useCallback(
    (roles?: UserRole[]) => {
      if (!roles || roles.length === 0) return true;
      if (!user) return false;
      return roles.includes(user.role);
    },
    [user]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      role: user?.role ?? null,
      login,
      loginStaff,
      logout,
      hasRole,
    }),
    [user, login, loginStaff, logout, hasRole]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return ctx;
}
