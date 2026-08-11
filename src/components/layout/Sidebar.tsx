// src/components/layout/Sidebar.tsx

import { useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  BookOpenCheck,
  CalendarCog,
  CalendarDays,
  CalendarRange,
  FileSpreadsheet,
  Gauge,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  Lock,
  Download,
  Search,
  TableProperties,
  Upload,
  UserPlus,
  Users,
  DollarSign,
  Megaphone,
  UsersRound,
  ClipboardCheck,
  Award,
  Share2,
  Building2,
  UserRoundSearch,
  HandCoins,
  Wallet,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

import { cn } from "../../lib/utils";
import { ACCOUNT_HR_LOGIN_ENABLED } from "../../lib/featureFlags";
import { useAuth } from "../../contexts/AuthContext";
import { useFeatureUpdateLocks } from "../../contexts/FeatureUpdateLockContext";
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
  /** Override label for specific roles (e.g. PL sees 課程總覽). */
  labelByRole?: Partial<Record<UserRole, string>>;
  icon: React.ComponentType<{ className?: string }>;
  roles?: UserRole[];
  /** Admin sees these under the Others section (AccountHR tools while in development). */
  section?: "main" | "others";
  disabled?: boolean;
  disabledReason?: string;
}

function resolveNavLabel(item: NavItem, role: UserRole | null) {
  if (role && item.labelByRole?.[role]) {
    return item.labelByRole[role]!;
  }

  return item.label;
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const { role } = useAuth();
  const { t } = useLanguage();
  const { locks } = useFeatureUpdateLocks();
  const { collapsed } = useSidebarLayout();

  /**
   * 保留這兩個狀態，但不再請求 teacher_loading_runs。
   * 避免 Sidebar 持續觸發 Supabase 401。
   */
  const [teacherLoadingReady] = useState(true);
  const [checkingTeacherLoading] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);

  const teacherLoadingDisabled =
    checkingTeacherLoading || !teacherLoadingReady;

  const items: NavItem[] = useMemo(
    () => [
    {
      to: "/dashboard",
      label: t.dashboard,
      icon: LayoutDashboard,
      roles: ACCOUNT_HR_LOGIN_ENABLED
        ? ["admin", "programme_leader", "staff", "account_hr"]
        : ["admin", "programme_leader", "staff"],
    },
    {
      to: "/admin/programmes",
      label: t.programmeManagement,
      labelByRole: {
        programme_leader: t.programmeOverview,
        staff: t.programmeOverview,
      },
      icon: GraduationCap,
      roles: ["admin", "programme_leader", "staff"],
    },
    {
      to: "/course-search",
      label: t.courseSearch,
      icon: Search,
      roles: ["admin", "programme_leader", "staff"],
    },
    {
      to: "/academic-calendar",
      label: t.academicCalendar,
      icon: CalendarDays,
      roles: ACCOUNT_HR_LOGIN_ENABLED
        ? ["programme_leader", "admin", "staff", "account_hr"]
        : ["programme_leader", "admin", "staff"],
    },
    {
      to: "/account-hr/hourly-rates",
      label: t.ptTeacherCostsTitle,
      icon: DollarSign,
      roles: ACCOUNT_HR_LOGIN_ENABLED ? ["account_hr", "admin"] : ["admin"],
    },
    {
      to: "/account-hr/promotion-expenses",
      label: t.promotionExpensesTitle,
      icon: Megaphone,
      roles: ACCOUNT_HR_LOGIN_ENABLED ? ["account_hr", "admin"] : ["admin"],
    },
    {
      to: "/account-hr/ft-staff-costs",
      label: t.ftStaffCostsTitle,
      icon: UsersRound,
      roles: ACCOUNT_HR_LOGIN_ENABLED ? ["account_hr", "admin"] : ["admin"],
    },
    {
      to: "/account-hr/review-fees",
      label: t.reviewFeesTitle,
      icon: ClipboardCheck,
      roles: ACCOUNT_HR_LOGIN_ENABLED ? ["account_hr", "admin"] : ["admin"],
    },
    {
      to: "/account-hr/scholarship-expenses",
      label: t.scholarshipExpensesTitle,
      icon: Award,
      roles: ACCOUNT_HR_LOGIN_ENABLED ? ["account_hr", "admin"] : ["admin"],
    },
    {
      to: "/account-hr/referral-scheme",
      label: t.referralSchemeTitle,
      icon: Share2,
      roles: ACCOUNT_HR_LOGIN_ENABLED ? ["account_hr", "admin"] : ["admin"],
    },
    {
      to: "/account-hr/ssp-misc-costs",
      label: t.sspMiscCostsTitle,
      icon: Building2,
      roles: ACCOUNT_HR_LOGIN_ENABLED ? ["account_hr", "admin"] : ["admin"],
    },
    {
      to: "/account-hr/external-review",
      label: t.externalReviewEngagementsTitle,
      icon: UserRoundSearch,
      roles: ACCOUNT_HR_LOGIN_ENABLED ? ["account_hr", "admin"] : ["admin"],
    },
    {
      to: "/account-hr/tuition-summary",
      label: t.tuitionSummaryTitle,
      icon: Wallet,
      roles: ACCOUNT_HR_LOGIN_ENABLED ? ["account_hr", "admin"] : ["admin"],
    },
    {
      to: "/account-hr/partner-sharing",
      label: t.partnerSharingPageTitle,
      icon: HandCoins,
      roles: ACCOUNT_HR_LOGIN_ENABLED ? ["account_hr", "admin"] : ["admin"],
    },
    {
      to: "/teacher-loading",
      label: t.teacherLoading,
      icon: Gauge,
      roles: ["programme_leader", "admin"],
      disabled: teacherLoadingDisabled,
      disabledReason: checkingTeacherLoading
        ? "正在檢查教師工作量狀態..."
        : "教師工作量尚未產生。",
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
      disabled: role !== "admin" && locks.uploadExcelLocked,
      disabledReason: t.featureUpdateLocksUploadExcelSidebarHint,
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
      roles: ["admin", "programme_leader"],
    },
    {
      to: "/admin/study-plan-enrollment",
      label: t.studyPlanEnrollmentTitle,
      icon: UserPlus,
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
      to: "/admin/feature-update-locks",
      label: t.featureUpdateLocksTitle,
      icon: Lock,
      roles: ["admin"],
    },
    {
      to: "/admin/download-center",
      label: t.adminDownloadCenterTitle,
      icon: Download,
      roles: ["admin"],
    },
    {
      to: "/admin/passwords",
      label: t.passwordManagement,
      icon: KeyRound,
      roles: ["admin"],
    },
  ],
    [locks.uploadExcelLocked, role, t, teacherLoadingDisabled]
  );

  const visibleItems = items.filter((item) => {
    if (!item.roles) return true;
    if (!role) return false;
    return item.roles.includes(role);
  });

  function resolveItemSection(item: NavItem): "main" | "others" {
    if (item.section !== "others") return "main";
    // AccountHR role keeps these as primary nav when that login is enabled.
    if (role === "account_hr") return "main";
    return "others";
  }

  const mainItems = visibleItems.filter(
    (item) => resolveItemSection(item) === "main"
  );
  const otherItems = visibleItems.filter(
    (item) => resolveItemSection(item) === "others"
  );

  function renderNavItem(item: NavItem) {
    const Icon = item.icon;

    if (item.disabled) {
      return (
        <button
          key={item.to}
          type="button"
          title={item.disabledReason}
          disabled
          className="flex w-full cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-400"
        >
          <Icon className="h-4 w-4" />
          <span>{resolveNavLabel(item, role)}</span>
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
        <span>{resolveNavLabel(item, role)}</span>
      </NavLink>
    );
  }

  const nav = (
    <nav className="space-y-1">
      {mainItems.map((item) => renderNavItem(item))}

      {otherItems.length > 0 ? (
        <div className="pt-3">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-expanded={othersOpen}
            onClick={() => setOthersOpen((open) => !open)}
          >
            {othersOpen ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            )}
            <span>{t.sidebarOthers}</span>
          </button>
          {othersOpen ? (
            <div className="mt-1 space-y-1 pl-1">
              {otherItems.map((item) => renderNavItem(item))}
            </div>
          ) : null}
        </div>
      ) : null}
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
