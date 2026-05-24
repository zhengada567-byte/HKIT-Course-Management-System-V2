// src/components/auth/ProtectedRoute.tsx

import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

import { useAuth } from "../../contexts/AuthContext";
import type { UserRole } from "../../types";

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: UserRole[];
}

type AuthContextWithOptionalLoading = ReturnType<typeof useAuth> & {
  isLoading?: boolean;
  loading?: boolean;
};

export function ProtectedRoute({
  children,
  allowedRoles,
}: ProtectedRouteProps) {
  const auth = useAuth() as AuthContextWithOptionalLoading;
  const location = useLocation();

  const isAuthLoading = Boolean(auth.isLoading ?? auth.loading ?? false);

  if (isAuthLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-5 text-sm text-slate-600 shadow-sm">
          Loading...
        </div>
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!auth.hasRole(allowedRoles)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
