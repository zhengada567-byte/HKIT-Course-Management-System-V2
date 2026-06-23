import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../contexts/LanguageContext";
import type { UserRole } from "../types";

const ROLE_OPTIONS: {
  role: UserRole;
  username: string;
  labelKey: "programmeLeader" | "admin" | "staff";
  passwordless?: boolean;
}[] = [
  { role: "programme_leader", username: "pl", labelKey: "programmeLeader" },
  { role: "admin", username: "admin", labelKey: "admin" },
  { role: "staff", username: "staff", labelKey: "staff", passwordless: true },
];

export function LoginPage() {
  const { isAuthenticated, login, loginStaff } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();

  const [selectedRole, setSelectedRole] = useState<UserRole>("programme_leader");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const from =
    (location.state as { from?: { pathname?: string } } | null)?.from
      ?.pathname || "/dashboard";

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const selectedOption =
    ROLE_OPTIONS.find((option) => option.role === selectedRole) ??
    ROLE_OPTIONS[0];
  const isPasswordless = Boolean(selectedOption.passwordless);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setError("");
    setSubmitting(true);

    try {
    if (!isPasswordless && !password.trim()) {
        setError(t.passwordRequired);
        return;
      }

      const ok = isPasswordless
        ? await loginStaff()
        : await login(selectedOption.username, password);

      if (!ok) {
        setError(isPasswordless ? t.staffLoginFailed : t.invalidLogin);
        return;
      }

      navigate(from, { replace: true });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-slate-900">{t.systemTitle}</h1>
          <p className="mt-1 text-sm text-slate-500">{t.login}</p>
        </div>

        <div className="mb-4 flex justify-center">
          <select
            className="form-select w-auto"
            value={language}
            onChange={(event) =>
              setLanguage(event.target.value === "en" ? "en" : "zhHant")
            }
          >
            <option value="zhHant">繁體中文</option>
            <option value="en">English</option>
          </select>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="form-label">{t.selectUser}</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {ROLE_OPTIONS.map((option) => {
                const selected = selectedRole === option.role;

                return (
                  <button
                    key={option.role}
                    type="button"
                    className={`rounded-lg border px-3 py-3 text-sm font-medium transition ${
                      selected
                        ? "border-blue-600 bg-blue-50 text-blue-700"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                    onClick={() => setSelectedRole(option.role)}
                  >
                    {t[option.labelKey]}
                  </button>
                );
              })}
            </div>
          </div>

          {isPasswordless ? (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {t.staffLoginHint}
            </div>
          ) : (
            <div>
              <label className="form-label">{t.password}</label>
              <input
                className="form-input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            className="btn btn-primary w-full"
            type="submit"
            disabled={submitting}
          >
            {submitting ? t.loading : t.login}
          </button>
        </form>
      </div>
    </div>
  );
}
