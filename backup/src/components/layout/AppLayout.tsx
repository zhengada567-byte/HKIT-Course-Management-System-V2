// src/components/layout/AppLayout.tsx

import { Outlet } from "react-router-dom";

import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppLayout() {
  return (
    <div className="min-h-screen bg-slate-50">
      <TopBar />

      <div className="mx-auto flex w-full max-w-[1600px]">
        <Sidebar />

        <main className="min-h-[calc(100vh-3.5rem)] min-w-0 flex-1 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
