import {
  CalendarDays,
  FileSpreadsheet,
  Gauge,
  Search,
  Users,
} from "lucide-react";

import { PageHeader } from "../components/ui/PageHeader";
import { useAuth } from "../contexts/AuthContext";
import { useAcademicYear } from "../contexts/AcademicYearContext";
import { useLanguage } from "../contexts/LanguageContext";

/** Admin home dashboard. */
export function DefaultDashboardPage() {
  const { user } = useAuth();
  const { academicYear, previousAcademicYear } = useAcademicYear();
  const { t } = useLanguage();

  const cards = [
    {
      label: t.academicYear,
      value: academicYear,
      icon: CalendarDays,
    },
    {
      label: t.previousAcademicYear,
      value: previousAcademicYear,
      icon: CalendarDays,
    },
    {
      label: t.courseSearch,
      value: "Available",
      icon: Search,
    },
    {
      label: t.teacherLoading,
      value: "Available",
      icon: Gauge,
    },
    {
      label: t.makeTimetable,
      value:
        user?.role === "programme_leader" || user?.role === "admin"
          ? "Available"
          : "Restricted",
      icon: FileSpreadsheet,
    },
  ];

  return (
    <div className="page-container">
      <PageHeader
        title={t.dashboard}
        description={`${t.username}: ${user?.username ?? "-"} / Role: ${
          user?.role ?? "-"
        }`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => {
          const Icon = card.icon;

          return (
            <div key={card.label} className="card">
              <div className="card-body flex items-center gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                  <Icon className="h-5 w-5" />
                </div>

                <div>
                  <p className="text-sm text-slate-500">{card.label}</p>
                  <p className="text-lg font-semibold text-slate-900">
                    {card.value}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-slate-900">V3.5 Core Rules</h3>
          </div>
          <div className="card-body">
            <ul className="space-y-2 text-sm text-slate-600">
              <li>• Same module code + same term = natural combine.</li>
              <li>
                • Student number key = academic_year + module_code +
                programme_code.
              </li>
              <li>
                • Same programme different streams share one student number.
              </li>
              <li>
                • Different programmes keep separate student number entries.
              </li>
              <li>• Loading uses teaching_status, not employment type.</li>
            </ul>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-slate-900">User Role</h3>
          </div>
          <div className="card-body flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
              <Users className="h-5 w-5 text-slate-600" />
            </div>
            <div>
              <p className="text-sm text-slate-500">{t.username}</p>
              <p className="font-semibold text-slate-900">
                {user?.username} / {user?.role}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
