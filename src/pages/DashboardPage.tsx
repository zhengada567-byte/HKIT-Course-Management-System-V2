import { useAuth } from "../contexts/AuthContext";
import { DefaultDashboardPage } from "./DefaultDashboardPage";
import { ProgrammeLeaderDashboard } from "./programme-leader/ProgrammeLeaderDashboard";
import { StaffDashboard } from "./StaffDashboard";

export function DashboardPage() {
  const { user } = useAuth();

  if (user?.role === "programme_leader") {
    return <ProgrammeLeaderDashboard />;
  }

  if (user?.role === "staff") {
    return <StaffDashboard />;
  }

  return <DefaultDashboardPage />;
}
