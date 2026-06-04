// src/components/layout/Sidebar.tsx

import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  BookOpenCheck,
  CalendarCog,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  FileSpreadsheet,
  Gauge,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  Search,
  TableProperties,
  Upload,
  UserCog,
  Users,
} from "lucide-react";

import { cn } from "../../lib/utils";
import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { useSidebarLayout } from "../../contexts/SidebarLayoutContext";
import type { UserRole } from "../../types";

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: UserRole[];
  disabled?: boolean;
  disabledReason?: string;
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const { role } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { collapsed } = useSidebarLayout();

  /**
   * 保留這兩個狀態，但不再請求 teacher_loading_runs。
   * 避免 Sidebar 持續觸發 Supabase 401。
   */
  const [teacherLoadingReady] = useState(true);
  const [checkingTeacherLoading] = useState(false);

  const teacherLoadingDisabled =
    checkingTeacherLoading || !teacherLoadingReady;

  const items: NavItem[] = [
    {
      to: "/dashboard",
      label: t.dashboard,
      icon: LayoutDashboard,
    },
    {
      to: "/course-search",
      label: t.courseSearch,
      icon: Search,
    },
    {
      to: "/academic-calendar",
      label: "Academic Calendar",
      icon: CalendarDays,
      roles: ["programme_leader", "admin"],
    },
    {
      to: "/teacher-loading",
      label: t.teacherLoading,
      icon: Gauge,
      disabled: teacherLoadingDisabled,
      disabledReason: checkingTeacherLoading
        ? "正在檢查教師工作量狀態..."
        : "教師工作量尚未產生。",
    },
    {
      to: "/admin/assignment-confirmation-monitor",
      label: "教學分配進度",
      icon: ClipboardCheck,
      roles: ["admin"],
    },
    {
      to: "/admin/academic-year",
      label: "學年與學期設定",
      icon: CalendarCog,
      roles: ["admin"],
    },
    {
      to: "/admin/academic-calendar",
      label: "學年日曆設定",
      icon: CalendarDays,
      roles: ["admin"],
    },
    {
      to: "/admin/upload-excel",
      label: t.uploadExcel,
      icon: Upload,
      roles: ["admin", "programme_leader"],
    },
    {
      to: "/admin/programmes",
      label: t.programmeManagement,
      icon: GraduationCap,
      roles: ["admin", "programme_leader"],
    },
    {
      to: "/admin/teachers",
      label: t.teacherManagement,
      icon: Users,
      roles: ["admin"],
    },
    {
      to: "/admin/modules",
      label: t.moduleManagement,
      icon: TableProperties,
      roles: ["admin"],
    },
    {
      to: "/admin/daily-timetable",
      label: t.weeklyDailyTimetable,
      icon: CalendarRange,
      roles: ["admin"],
    },
    {
      to: "/programme-leader/make-study-plan",
      label: "學生學習計劃",
      icon: BookOpenCheck,
      roles: ["programme_leader", "admin"],
    },
    {
      to: "/programme-leader/make-timetable",
      label: t.makeTimetable,
      icon: FileSpreadsheet,
      roles: ["programme_leader", "admin"],
    },
    {
      to: "/programme-leader/daily-timetable",
      label: t.plDailyTimetable,
      icon: CalendarDays,
      roles: ["programme_leader", "admin"],
    },
    {
      to: "/president/approved-loading",
      label: t.approvedLoading,
      icon: UserCog,
      roles: ["president"],
    },
    {
      to: "/admin/passwords",
      label: t.passwordManagement,
      icon: KeyRound,
      roles: ["admin"],
    },
    {
      to: "/president/password",
      label: t.passwordManagement,
      icon: KeyRound,
      roles: ["president"],
    },
  ];

  const visibleItems = items.filter((item) => {
    if (!item.roles) return true;
    if (!role) return false;
    return item.roles.includes(role);
  });

  const nav = (
    <nav className="space-y-1">
      {visibleItems.map((item) => {
        const Icon = item.icon;

        if (item.disabled) {
          return (
            <button
              key={item.to}
              type="button"
              title={item.disabledReason}
              onClick={() => {
                if (role === "admin") {
                  navigate("/admin/assignment-confirmation-monitor");
                  onMobileClose();
                }
              }}
              className="flex w-full cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-400 transition hover:bg-slate-50"
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </button>
          );
        }

        return (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onMobileClose}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                isActive
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-700 hover:bg-slate-100"
              )
            }
          >
            <Icon className="h-4 w-4" />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 top-14 z-30 bg-black/40 lg:hidden"
          aria-label="Close menu"
          onClick={onMobileClose}
        />
      )}

      <aside
        id="app-sidebar"
        className={cn(
          "w-64 shrink-0 border-r border-slate-200 bg-white p-3",
          "min-h-[calc(100vh-3.5rem)]",
          mobileOpen
            ? "fixed left-0 top-14 z-40 block h-[calc(100vh-3.5rem)] overflow-y-auto shadow-xl lg:static lg:shadow-none"
            : collapsed
              ? "hidden"
              : "hidden lg:block lg:static"
        )}
      >
        {nav}
      </aside>
    </>
  );
}
