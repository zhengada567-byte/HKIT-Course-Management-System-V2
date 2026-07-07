import { Navigate, type RouteObject } from "react-router-dom";

import { AppLayout } from "../components/layout/AppLayout";
import { ProtectedRoute } from "../components/layout/ProtectedRoute";

import { LoginPage } from "../pages/LoginPage";
import { DashboardPage } from "../pages/DashboardPage";
import { CourseSearchPage } from "../pages/CourseSearchPage";
import { TeacherLoadingPage } from "../pages/TeacherLoadingPage";

import { AcademicYearPage } from "../pages/admin/AcademicYearPage";
import { AcademicCalendarAdminPage } from "../pages/admin/AcademicCalendarAdminPage";
import { UploadExcelPage } from "../pages/admin/UploadExcelPage";
import { ProgrammeManagementPage } from "../pages/admin/ProgrammeManagementPage";
import { TeacherManagementPage } from "../pages/admin/TeacherManagementPage";
import { ModuleManagementPage } from "../pages/admin/ModuleManagementPage";
import { AdminPasswordManagementPage } from "../pages/admin/AdminPasswordManagementPage";

import { AcademicCalendarPage } from "../pages/AcademicCalendarPage";
import { MakeTimetablePage } from "../pages/programme-leader/MakeTimetablePage";
import { DailyTimetablePage as ProgrammeLeaderDailyTimetablePage } from "../pages/programme-leader/DailyTimetablePage";
import MakeStudyPlanPage from "../pages/programme-leader/make-study-plan/MakeStudyPlanPage";
import { ModuleTeacherAssignmentPage } from "../pages/programme-leader/ModuleTeacherAssignmentPage";
import { AssignmentConfirmationMonitorPage } from "../pages/admin/AssignmentConfirmationMonitorPage";
import { DailyTimetablePage } from "../pages/admin/DailyTimetablePage";
import { StudyPlanEnrollmentPage } from "../pages/admin/StudyPlanEnrollmentPage";
import { FeatureUpdateLocksPage } from "../pages/admin/FeatureUpdateLocksPage";

export const routes: RouteObject[] = [
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "/",
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <Navigate to="/dashboard" replace />,
      },
      {
        path: "dashboard",
        element: <DashboardPage />,
      },
      {
        path: "course-search",
        element: (
          <ProtectedRoute allowedRoles={["programme_leader", "admin", "staff"]}>
            <CourseSearchPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "academic-calendar",
        element: (
          <ProtectedRoute allowedRoles={["programme_leader", "admin", "staff"]}>
            <AcademicCalendarPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "teacher-loading",
        element: (
          <ProtectedRoute allowedRoles={["programme_leader", "admin"]}>
            <TeacherLoadingPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/assignment-confirmation-monitor",
        element: (
          <ProtectedRoute allowedRoles={["admin"]}>
            <AssignmentConfirmationMonitorPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/academic-year",
        element: (
          <ProtectedRoute allowedRoles={["admin"]}>
            <AcademicYearPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/academic-calendar",
        element: (
          <ProtectedRoute allowedRoles={["admin"]}>
            <AcademicCalendarAdminPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/upload-excel",
        element: (
          <ProtectedRoute allowedRoles={["admin", "programme_leader"]}>
            <UploadExcelPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/programmes",
        element: (
          <ProtectedRoute allowedRoles={["admin", "programme_leader", "staff"]}>
            <ProgrammeManagementPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/teachers",
        element: (
          <ProtectedRoute allowedRoles={["admin"]}>
            <TeacherManagementPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/modules",
        element: (
          <ProtectedRoute allowedRoles={["admin"]}>
            <ModuleManagementPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/daily-timetable",
        element: (
          <ProtectedRoute allowedRoles={["admin", "programme_leader"]}>
            <DailyTimetablePage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/study-plan-enrollment",
        element: (
          <ProtectedRoute allowedRoles={["admin"]}>
            <StudyPlanEnrollmentPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/feature-update-locks",
        element: (
          <ProtectedRoute allowedRoles={["admin"]}>
            <FeatureUpdateLocksPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/passwords",
        element: (
          <ProtectedRoute allowedRoles={["admin"]}>
            <AdminPasswordManagementPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "programme-leader/make-study-plan",
        element: (
          <ProtectedRoute allowedRoles={["programme_leader", "admin"]}>
            <MakeStudyPlanPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "programme-leader/module-teachers",
        element: (
          <ProtectedRoute allowedRoles={["programme_leader", "admin"]}>
            <ModuleTeacherAssignmentPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "programme-leader/make-timetable",
        element: (
          <ProtectedRoute allowedRoles={["programme_leader", "admin"]}>
            <MakeTimetablePage />
          </ProtectedRoute>
        ),
      },
      {
        path: "programme-leader/daily-timetable",
        element: (
          <ProtectedRoute allowedRoles={["programme_leader", "admin"]}>
            <ProgrammeLeaderDailyTimetablePage />
          </ProtectedRoute>
        ),
      },
    ],
  },
  {
    path: "*",
    element: <Navigate to="/dashboard" replace />,
  },
];
