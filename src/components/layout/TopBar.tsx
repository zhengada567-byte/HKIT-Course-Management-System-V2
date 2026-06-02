import { Menu } from "lucide-react";

import { useAuth } from "../../contexts/AuthContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { useAcademicYear } from "../../contexts/AcademicYearContext";
import { useSidebarLayout } from "../../contexts/SidebarLayoutContext";
import { cn } from "../../lib/utils";

interface TopBarProps {
  mobileNavOpen: boolean;
  onToggleMobileNav: () => void;
}

export function TopBar({ mobileNavOpen, onToggleMobileNav }: TopBarProps) {
  const { user, logout } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const { academicYear, currentStudyTerm, currentOfferedTerm } = useAcademicYear();
  const { collapsed, expand } = useSidebarLayout();

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <button
            className={cn(
              "btn btn-secondary",
              !collapsed && "lg:hidden"
            )}
            type="button"
            aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileNavOpen}
            aria-controls="app-sidebar"
            onClick={onToggleMobileNav}
          >
            <Menu className="h-4 w-4" />
          </button>

          {collapsed ? (
            <button
              type="button"
              className="text-left rounded-md px-1 py-0.5 -ml-1 transition cursor-pointer hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
              aria-label="Show navigation menu"
              onClick={expand}
            >
              <h1 className="text-sm font-semibold text-slate-900 sm:text-base">
                {t.systemTitle}
              </h1>
              <p className="text-xs text-slate-500">
                {t.academicYear}: {academicYear} · {t.currentTerm}:{" "}
                {currentOfferedTerm} ({currentStudyTerm})
              </p>
            </button>
          ) : (
            <div>
              <h1 className="text-sm font-semibold text-slate-900 sm:text-base">
                {t.systemTitle}
              </h1>
              <p className="text-xs text-slate-500">
                {t.academicYear}: {academicYear} · {t.currentTerm}:{" "}
                {currentOfferedTerm} ({currentStudyTerm})
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <select
            className="form-select w-auto py-1 text-xs"
            value={language}
            onChange={(event) =>
              setLanguage(event.target.value === "en" ? "en" : "zhHant")
            }
          >
            <option value="zhHant">繁體中文</option>
            <option value="en">English</option>
          </select>

          {user && (
            <div className="hidden text-right sm:block">
              <p className="text-xs font-medium text-slate-700">
                {user.username}
              </p>
              <p className="text-[11px] text-slate-500">{user.role}</p>
            </div>
          )}

          <button className="btn btn-secondary py-1 text-xs" onClick={logout}>
            {t.logout}
          </button>
        </div>
      </div>
    </header>
  );
}
