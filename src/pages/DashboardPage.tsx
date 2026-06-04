import { useAuth } from "../contexts/AuthContext";
import { DefaultDashboardPage } from "./DefaultDashboardPage";
import { ProgrammeLeaderDashboard } from "./programme-leader/ProgrammeLeaderDashboard";

export function DashboardPage() {
  const { user } = useAuth();

  if (user?.role === "programme_leader") {
    return <ProgrammeLeaderDashboard />;
  }

  return <DefaultDashboardPage />;
}
