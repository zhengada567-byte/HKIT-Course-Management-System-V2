import { Link } from "react-router-dom";
import {
  BookOpenCheck,
  CalendarDays,
  FileSpreadsheet,
  Gauge,
  GraduationCap,
  Search,
  Upload,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { PageHeader } from "../../components/ui/PageHeader";
import { useAcademicYear } from "../../contexts/AcademicYearContext";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";

interface FeatureGuide {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

export function ProgrammeLeaderDashboard() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const {
    academicYear,
    currentStudyTerm,
    currentOfferedTerm,
    loading: termLoading,
  } = useAcademicYear();

  const features: FeatureGuide[] = [
    {
      to: "/admin/programmes",
      label: t.programmeOverview,
      description: t.guidePlProgrammeOverview,
      icon: GraduationCap,
    },
    {
      to: "/course-search",
      label: t.courseSearch,
      description: t.guidePlCourseSearch,
      icon: Search,
    },
    {
      to: "/academic-calendar",
      label: t.academicCalendar,
      description: t.guidePlAcademicCalendar,
      icon: CalendarDays,
    },
    {
      to: "/teacher-loading",
      label: t.teacherLoading,
      description: t.guidePlTeacherLoading,
      icon: Gauge,
    },
    {
      to: "/admin/upload-excel",
      label: t.uploadExcel,
      description: t.guidePlUploadExcel,
      icon: Upload,
    },
    {
      to: "/programme-leader/make-study-plan",
      label: t.studyPlan,
      description: t.guidePlStudyPlan,
      icon: BookOpenCheck,
    },
    {
      to: "/programme-leader/make-timetable",
      label: t.makeTimetable,
      description: t.guidePlMakeTimetable,
      icon: FileSpreadsheet,
    },
    {
      to: "/programme-leader/daily-timetable",
      label: t.plDailyTimetable,
      description: t.guidePlDailyTimetable,
      icon: CalendarDays,
    },
  ];

  return (
    <div className="page-container">
      <PageHeader
        title={t.dashboard}
        description={t.plDashboardWelcome}
      />

      <div className="card mb-4 border-blue-200 bg-blue-50/60">
        <div className="card-body">
          <h2 className="text-base font-semibold text-slate-900">
            {t.plDashboardCurrentTerm}
          </h2>
          {termLoading ? (
            <p className="mt-2 text-sm text-slate-600">{t.loading}</p>
          ) : (
            <dl className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {t.currentAcademicYear}
                </dt>
                <dd className="mt-1 text-lg font-semibold text-slate-900">
                  {academicYear}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {t.studyTermPreview}
                </dt>
                <dd className="mt-1 text-lg font-semibold text-slate-900">
                  {currentStudyTerm}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {t.currentTerm}
                </dt>
                <dd className="mt-1 text-lg font-semibold text-slate-900">
                  {currentOfferedTerm}
                </dd>
              </div>
            </dl>
          )}
          <p className="mt-3 text-xs text-slate-600">
            {t.plDashboardTermHint}
          </p>
        </div>
      </div>

      <h2 className="mb-3 text-base font-semibold text-slate-900">
        {t.plDashboardFeatures}
      </h2>

      <div className="grid gap-3 md:grid-cols-2">
        {features.map((feature) => {
          const Icon = feature.icon;

          return (
            <Link
              key={feature.to}
              to={feature.to}
              className="card transition hover:border-blue-200 hover:shadow-md"
            >
              <div className="card-body flex gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-slate-900">
                    {feature.label}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">
                    {feature.description}
                  </p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <p className="mt-4 text-sm text-slate-500">
        {t.username}：{user?.username ?? "-"}
      </p>
    </div>
  );
}
