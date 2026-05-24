import { useEffect, useState } from "react";

import {
  getStudyPlanSettings,
  updateStudyPlanSettings,
} from "../../../../services/studyPlanService";

import type { StudyPlanSettings } from "../types";

export default function StudyPlanSettingsTab() {
  const [settings, setSettings] = useState<StudyPlanSettings>({
    currentAcademicYear: "2025/26",
    currentStudyTerm: "T2026A",
  });

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getStudyPlanSettings().then(setSettings);
  }, []);

  async function handleSave() {
    setSaving(true);

    try {
      await updateStudyPlanSettings(settings);
      alert("Settings saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border p-4 space-y-4 max-w-xl">
      <div>
        <h2 className="text-lg font-semibold">Study Plan Settings</h2>
        <p className="text-sm text-muted-foreground">
          Set current academic year and current study term for student status
          calculation.
        </p>
      </div>

      <label className="space-y-1 block">
        <span className="text-sm font-medium">Current Academic Year</span>
        <input
          className="w-full border rounded-md px-3 py-2"
          value={settings.currentAcademicYear}
          onChange={(e) =>
            setSettings((prev) => ({
              ...prev,
              currentAcademicYear: e.target.value,
            }))
          }
        />
      </label>

      <label className="space-y-1 block">
        <span className="text-sm font-medium">Current Study Term</span>
        <input
          className="w-full border rounded-md px-3 py-2"
          value={settings.currentStudyTerm}
          onChange={(e) =>
            setSettings((prev) => ({
              ...prev,
              currentStudyTerm: e.target.value,
            }))
          }
          placeholder="T2026A"
        />
      </label>

      <button
        className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? "Saving..." : "Save Settings"}
      </button>
    </div>
  );
}
