// src/components/layout/AppLayout.tsx

import { useState } from "react";
import { Outlet } from "react-router-dom";

import { SidebarLayoutProvider } from "../../contexts/SidebarLayoutContext";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <SidebarLayoutProvider>
      <div className="min-h-screen bg-slate-50">
        <TopBar
          mobileNavOpen={mobileNavOpen}
          onToggleMobileNav={() => setMobileNavOpen((open) => !open)}
        />

        <div className="mx-auto flex w-full max-w-[1600px]">
          <Sidebar
            mobileOpen={mobileNavOpen}
            onMobileClose={() => setMobileNavOpen(false)}
          />

          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarLayoutProvider>
  );
}
