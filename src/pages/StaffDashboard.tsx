import { CalendarDays, GraduationCap, Search } from "lucide-react";
import { Link } from "react-router-dom";

import { PageHeader } from "../components/ui/PageHeader";
import { useAuth } from "../contexts/AuthContext";
import { useLanguage } from "../contexts/LanguageContext";

export function StaffDashboard() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const links = [
    {
      to: "/academic-calendar",
      label: t.academicCalendar,
      description: t.guideStaffAcademicCalendar,
      icon: CalendarDays,
    },
    {
      to: "/admin/programmes",
      label: t.programmeOverview,
      description: t.guideStaffProgrammeOverview,
      icon: GraduationCap,
    },
    {
      to: "/course-search",
      label: t.courseSearch,
      description: t.guideStaffCourseSearch,
      icon: Search,
    },
  ];

  return (
    <div className="page-container">
      <PageHeader
        title={t.dashboard}
        description={t.staffDashboardDescription}
      />

      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        {t.username}: <strong>{user?.username ?? "-"}</strong> · {t.staffViewOnlyHint}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {links.map((item) => {
          const Icon = item.icon;

          return (
            <Link
              key={item.to}
              to={item.to}
              className="card transition hover:border-blue-200 hover:shadow-sm"
            >
              <div className="card-body space-y-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    {item.label}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">{item.description}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
