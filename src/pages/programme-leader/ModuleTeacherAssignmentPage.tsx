import { Navigate } from "react-router-dom";

export function ModuleTeacherAssignmentPage() {
  return (
    <Navigate to="/programme-leader/make-timetable?moduleBasicSettings=1" replace />
  );
}
