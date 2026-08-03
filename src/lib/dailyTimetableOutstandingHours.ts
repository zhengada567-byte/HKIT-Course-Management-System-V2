import { sessionDurationHours } from "../services/teacherContactHoursService";

export type ModuleOutstandingHoursSummary = {
  teachingRequired: number;
  tutorialRequired: number;
  teachingScheduled: number;
  tutorialScheduled: number;
  teachingOutstanding: number;
  tutorialOutstanding: number;
};

type OutstandingHoursEntry = {
  sessionKind: string;
  status: string;
  startTime: string;
  endTime: string;
  isBackup: boolean;
};

function roundHours(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * Catalogue required hours vs saved daily sessions only
 * (excludes cancelled, backup, and unsaved drafts/pending adds).
 */
export function computeModuleOutstandingHours(params: {
  teachingContactHours: number;
  tutorialContactHours: number;
  entries: OutstandingHoursEntry[];
}): ModuleOutstandingHoursSummary {
  const teachingRequired = Math.max(
    0,
    Number(params.teachingContactHours ?? 0) || 0
  );
  const tutorialRequired = Math.max(
    0,
    Number(params.tutorialContactHours ?? 0) || 0
  );

  let teachingScheduled = 0;
  let tutorialScheduled = 0;

  for (const entry of params.entries) {
    if (entry.isBackup || entry.status === "cancel") {
      continue;
    }

    const hours = sessionDurationHours(entry.startTime, entry.endTime);
    if (hours <= 0) {
      continue;
    }

    if (entry.sessionKind === "tutorial") {
      tutorialScheduled += hours;
    } else {
      teachingScheduled += hours;
    }
  }

  teachingScheduled = roundHours(teachingScheduled);
  tutorialScheduled = roundHours(tutorialScheduled);

  return {
    teachingRequired: roundHours(teachingRequired),
    tutorialRequired: roundHours(tutorialRequired),
    teachingScheduled,
    tutorialScheduled,
    teachingOutstanding: roundHours(
      Math.max(0, teachingRequired - teachingScheduled)
    ),
    tutorialOutstanding: roundHours(
      Math.max(0, tutorialRequired - tutorialScheduled)
    ),
  };
}
