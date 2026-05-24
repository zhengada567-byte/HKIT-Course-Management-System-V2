import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../contexts/LanguageContext";

export function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState("pl");
  const [password, setPassword] = useState("pl");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const from =
    (location.state as { from?: { pathname?: string } } | null)?.from
      ?.pathname || "/dashboard";

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setError("");
    setSubmitting(true);

    try {
      const ok = await login(username, password);

      if (!ok) {
        setError(t.invalidLogin);
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
          <p className="mt-1 text-sm text-slate-500">
            {t.login}
          </p>
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
            <label className="form-label">{t.username}</label>
            <input
              className="form-input"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
            />
          </div>

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

        <div className="mt-5 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
          <p>Default users for testing:</p>
          <p>pl / pl</p>
          <p>admin / admin</p>
          <p>president / president</p>
        </div>
      </div>
    </div>
  );
}
