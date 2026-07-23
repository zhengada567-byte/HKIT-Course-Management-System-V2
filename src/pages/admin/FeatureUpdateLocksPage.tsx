import { useState } from "react";
import { Lock, Unlock } from "lucide-react";

import { PageHeader } from "../../components/ui/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import { useFeatureUpdateLocks } from "../../contexts/FeatureUpdateLockContext";
import { useLanguage } from "../../contexts/LanguageContext";
import {
  setFeatureUpdateLock,
  type FeatureUpdateLockFeature,
} from "../../services/featureLockService";

function LockCard(props: {
  title: string;
  description: string;
  locked: boolean;
  lockedLabel: string;
  openLabel: string;
  lockButtonLabel: string;
  unlockButtonLabel: string;
  busy: boolean;
  onToggle: (locked: boolean) => void;
}) {
  return (
    <div className="card">
      <div className="card-body space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{props.title}</h2>
          <p className="mt-1 text-sm text-slate-600">{props.description}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
              props.locked
                ? "bg-amber-100 text-amber-900"
                : "bg-emerald-100 text-emerald-900"
            }`}
          >
            {props.locked ? (
              <Lock className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Unlock className="h-3.5 w-3.5" aria-hidden />
            )}
            {props.locked ? props.lockedLabel : props.openLabel}
          </span>

          <button
            type="button"
            className={props.locked ? "btn btn-primary" : "btn btn-secondary"}
            disabled={props.busy}
            onClick={() => props.onToggle(!props.locked)}
          >
            {props.locked ? props.unlockButtonLabel : props.lockButtonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function FeatureUpdateLocksPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { locks, refreshLocks } = useFeatureUpdateLocks();
  const [message, setMessage] = useState("");
  const [busyFeature, setBusyFeature] = useState<FeatureUpdateLockFeature | null>(
    null
  );

  async function handleToggle(
    feature: FeatureUpdateLockFeature,
    locked: boolean
  ) {
    if (!user) {
      setMessage(t.loginRequired);
      return;
    }

    setBusyFeature(feature);
    setMessage("");

    try {
      await setFeatureUpdateLock({
        feature,
        locked,
        updatedBy: user.id,
      });
      await refreshLocks();
      setMessage(t.featureUpdateLocksSaved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setBusyFeature(null);
    }
  }

  return (
    <div className="page-container">
      <PageHeader
        title={t.featureUpdateLocksTitle}
        description={t.featureUpdateLocksDescription}
      />

      {message && (
        <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {message}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <LockCard
          title={t.featureUpdateLocksCourseSearchTitle}
          description={t.featureUpdateLocksCourseSearchDescription}
          locked={locks.courseSearchLocked}
          lockedLabel={t.featureUpdateLocksStatusLocked}
          openLabel={t.featureUpdateLocksStatusOpen}
          lockButtonLabel={t.featureUpdateLocksLockButton}
          unlockButtonLabel={t.featureUpdateLocksUnlockButton}
          busy={busyFeature === "courseSearch"}
          onToggle={(locked) => void handleToggle("courseSearch", locked)}
        />

        <LockCard
          title={t.featureUpdateLocksModuleTeacherTitle}
          description={t.featureUpdateLocksModuleTeacherDescription}
          locked={locks.moduleTeacherLocked}
          lockedLabel={t.featureUpdateLocksStatusLocked}
          openLabel={t.featureUpdateLocksStatusOpen}
          lockButtonLabel={t.featureUpdateLocksLockButton}
          unlockButtonLabel={t.featureUpdateLocksUnlockButton}
          busy={busyFeature === "moduleTeacher"}
          onToggle={(locked) => void handleToggle("moduleTeacher", locked)}
        />

        <LockCard
          title={t.featureUpdateLocksUploadExcelTitle}
          description={t.featureUpdateLocksUploadExcelDescription}
          locked={locks.uploadExcelLocked}
          lockedLabel={t.featureUpdateLocksStatusLocked}
          openLabel={t.featureUpdateLocksStatusOpen}
          lockButtonLabel={t.featureUpdateLocksLockButton}
          unlockButtonLabel={t.featureUpdateLocksUnlockButton}
          busy={busyFeature === "uploadExcel"}
          onToggle={(locked) => void handleToggle("uploadExcel", locked)}
        />
      </div>
    </div>
  );
}
