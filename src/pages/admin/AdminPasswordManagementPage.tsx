import { useState } from "react";

import { PageHeader } from "../../components/ui/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { changeAppUserPassword } from "../../services/passwordService";

export function AdminPasswordManagementPage() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const [targetUsername, setTargetUsername] = useState<"pl" | "admin">("pl");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();

    if (!user) return;

    setMessage("");

    if (!newPassword) {
      setMessage("New password is required.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    setSaving(true);

    try {
      await changeAppUserPassword({
        actorUserId: user.id,
        targetUsername,
        newPassword,
      });

      setNewPassword("");
      setConfirmPassword("");
      setMessage("Password updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-container">
      <PageHeader
        title={t.passwordManagement}
        description="Admin can change Programme Leader and Admin passwords."
      />

      <form className="card max-w-xl" onSubmit={handleSave}>
        <div className="card-body space-y-4">
          <div>
            <label className="form-label">Target User</label>
            <select
              className="form-select"
              value={targetUsername}
              onChange={(event) =>
                setTargetUsername(event.target.value as "pl" | "admin")
              }
            >
              <option value="pl">Programme Leader - pl</option>
              <option value="admin">Admin - admin</option>
            </select>
          </div>

          <div>
            <label className="form-label">New Password</label>
            <input
              className="form-input"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </div>

          <div>
            <label className="form-label">Confirm Password</label>
            <input
              className="form-input"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </div>

          {message && (
            <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
              {message}
            </div>
          )}

          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? t.loading : t.save}
          </button>
        </div>
      </form>
    </div>
  );
}
