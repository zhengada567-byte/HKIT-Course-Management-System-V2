import { Navigate, type RouteObject } from "react-router-dom";

import { AppLayout } from "../components/layout/AppLayout";
import { ProtectedRoute } from "../components/layout/ProtectedRoute";

import { LoginPage } from "../pages/LoginPage";
import { DashboardPage } from "../pages/DashboardPage";
import { CourseSearchPage } from "../pages/CourseSearchPage.tsx";
import { TeacherLoadingPage } from "../pages/TeacherLoadingPage";

import { AcademicYearPage } from "../pages/admin/AcademicYearPage";
import { UploadExcelPage } from "../pages/admin/UploadExcelPage";
import { ProgrammeManagementPage } from "../pages/admin/ProgrammeManagementPage";
import { TeacherManagementPage } from "../pages/admin/TeacherManagementPage";
import { ModuleManagementPage } from "../pages/admin/ModuleManagementPage";
import { AdminPasswordManagementPage } from "../pages/admin/AdminPasswordManagementPage";

import { MakeTimetablePage } from "../pages/programme-leader/MakeTimetablePage";
import MakeStudyPlanPage from "../pages/programme-leader/make-study-plan/MakeStudyPlanPage";

import { ApprovedLoadingPage } from "../pages/president/ApprovedLoadingPage";
import { PresidentPasswordPage } from "../pages/president/PresidentPasswordPage";

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
        element: <CourseSearchPage />,
      },
      {
        path: "teacher-loading",
        element: <TeacherLoadingPage />,
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
        path: "admin/upload-excel",
        element: (
          <ProtectedRoute allowedRoles={["admin"]}>
            <UploadExcelPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/programmes",
        element: (
          <ProtectedRoute allowedRoles={["admin", "programme_leader"]}>
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
        path: "programme-leader/make-timetable",
        element: (
          <ProtectedRoute allowedRoles={["programme_leader", "admin"]}>
            <MakeTimetablePage />
          </ProtectedRoute>
        ),
      },
      {
        path: "president/approved-loading",
        element: (
          <ProtectedRoute allowedRoles={["president"]}>
            <ApprovedLoadingPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "president/password",
        element: (
          <ProtectedRoute allowedRoles={["president"]}>
            <PresidentPasswordPage />
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
