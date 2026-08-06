import { useAuth } from "../contexts/AuthContext";
import { AccountHRDashboard } from "./account-hr/AccountHRDashboard";
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

  if (user?.role === "account_hr") {
    return <AccountHRDashboard />;
  }

  return <DefaultDashboardPage />;
}
