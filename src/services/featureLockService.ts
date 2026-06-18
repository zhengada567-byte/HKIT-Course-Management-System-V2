import { supabase } from "../lib/supabase";
import type { UserRole } from "../types";

export const FEATURE_LOCK_SETTING_KEYS = {
  courseSearch: "lock_course_search_updates",
  moduleTeacher: "lock_module_teacher_updates",
  uploadExcel: "lock_upload_excel_updates",
} as const;

export type FeatureUpdateLockFeature = keyof typeof FEATURE_LOCK_SETTING_KEYS;

export interface FeatureUpdateLocks {
  courseSearchLocked: boolean;
  moduleTeacherLocked: boolean;
  uploadExcelLocked: boolean;
}

const LOCK_FIELD_BY_FEATURE: Record<
  FeatureUpdateLockFeature,
  keyof FeatureUpdateLocks
> = {
  courseSearch: "courseSearchLocked",
  moduleTeacher: "moduleTeacherLocked",
  uploadExcel: "uploadExcelLocked",
};

function parseLockedValue(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase() === "true";
}

export async function getFeatureUpdateLocks(): Promise<FeatureUpdateLocks> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("setting_key, setting_value")
    .in("setting_key", Object.values(FEATURE_LOCK_SETTING_KEYS));

  if (error) throw error;

  const values = new Map(
    (data ?? []).map((row) => [String(row.setting_key), String(row.setting_value ?? "")])
  );

  return {
    courseSearchLocked: values.has(FEATURE_LOCK_SETTING_KEYS.courseSearch)
      ? parseLockedValue(values.get(FEATURE_LOCK_SETTING_KEYS.courseSearch))
      : true,
    moduleTeacherLocked: values.has(FEATURE_LOCK_SETTING_KEYS.moduleTeacher)
      ? parseLockedValue(values.get(FEATURE_LOCK_SETTING_KEYS.moduleTeacher))
      : false,
    uploadExcelLocked: values.has(FEATURE_LOCK_SETTING_KEYS.uploadExcel)
      ? parseLockedValue(values.get(FEATURE_LOCK_SETTING_KEYS.uploadExcel))
      : true,
  };
}

export async function setFeatureUpdateLock(params: {
  feature: FeatureUpdateLockFeature;
  locked: boolean;
  updatedBy: string;
}) {
  const { error } = await supabase.from("app_settings").upsert(
    {
      setting_key: FEATURE_LOCK_SETTING_KEYS[params.feature],
      setting_value: params.locked ? "true" : "false",
      updated_by: params.updatedBy,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "setting_key",
    }
  );

  if (error) throw error;
}

export function isFeatureLocked(
  locks: FeatureUpdateLocks,
  feature: FeatureUpdateLockFeature
) {
  return locks[LOCK_FIELD_BY_FEATURE[feature]];
}

/** Feature locks apply to programme leaders only; admin always has full control. */
export function isFeatureUpdateBlockedForRole(
  locks: FeatureUpdateLocks,
  feature: FeatureUpdateLockFeature,
  role: UserRole | null | undefined
) {
  if (role === "admin") {
    return false;
  }

  return isFeatureLocked(locks, feature);
}

export async function assertFeatureUpdatesAllowed(
  feature: FeatureUpdateLockFeature,
  options?: { role?: UserRole | null }
) {
  if (options?.role === "admin") {
    return;
  }

  const locks = await getFeatureUpdateLocks();

  if (isFeatureLocked(locks, feature)) {
    throw new Error(
      "Updates are locked by admin for this feature. Ask admin to unlock before saving."
    );
  }
}
