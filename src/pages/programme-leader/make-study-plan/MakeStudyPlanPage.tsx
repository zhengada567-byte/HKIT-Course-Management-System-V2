import { useEffect, useMemo, useState } from "react";

import { useSidebarLayout } from "../../../contexts/SidebarLayoutContext";
import type { StudyPlanModule, StudyPlanStudent } from "./types";

import {
  getStudyPlanStudent,
  getStudyPlanStudentByStudentId,
  listStudyPlanStudents,
} from "../../../services/studyPlanService";

import StudentListTab from "./components/StudentListTab";
import StudentProfileEditor from "./components/StudentProfileEditor";
import StudyPlanSearchTab from "./components/StudyPlanSearchTab";
import ReportsTab from "./components/ReportsTab";
import QuotaTab from "./components/QuotaTab";
import { InitialStudyPlanUpload } from "./components/InitialStudyPlanUpload";

type TabKey = "students" | "search" | "quota" | "upload" | "editor" | "reports";
type EditorOrigin = "list" | "search" | "new";

export default function MakeStudyPlanPage() {
  const { setCollapsed } = useSidebarLayout();
  const [activeTab, setActiveTab] = useState<TabKey>("students");
  const [editorOrigin, setEditorOrigin] = useState<EditorOrigin>("list");
  const [students, setStudents] = useState<StudyPlanStudent[]>([]);
  const [selectedStudent, setSelectedStudent] =
    useState<StudyPlanStudent | null>(null);
  const [selectedModules, setSelectedModules] = useState<StudyPlanModule[]>(
    []
  );
  /** Bumped when opening editor or after full save — avoids resetting modules mid-edit. */
  const [editorReloadVersion, setEditorReloadVersion] = useState(0);
  const [loading, setLoading] = useState(false);

  async function refreshStudents() {
    setLoading(true);

    try {
      const rows = await listStudyPlanStudents();
      setStudents(rows);
    } finally {
      setLoading(false);
    }
  }

  function clearEditorState() {
    setSelectedStudent(null);
    setSelectedModules([]);
    setEditorOrigin("list");
  }

  function goToTab(tab: Exclude<TabKey, "editor">) {
    clearEditorState();
    setActiveTab(tab);
  }

  async function openEditorFromProfile(profileId: string, origin: EditorOrigin) {
    setLoading(true);

    try {
      const result = await getStudyPlanStudent(profileId);

      setEditorOrigin(origin);
      setSelectedStudent(result.student);
      setSelectedModules(result.modules);
      setEditorReloadVersion((version) => version + 1);
      setActiveTab("editor");
    } finally {
      setLoading(false);
    }
  }

  async function handleEditStudent(profileId: string) {
    await openEditorFromProfile(profileId, "list");
  }

  const programmeCodes = useMemo(() => {
    return Array.from(
      new Set(students.map((student) => student.programmeCode).filter(Boolean))
    );
  }, [students]);

  async function handleSearchByStudentId(studentId: string) {
    setLoading(true);

    try {
      const result = await getStudyPlanStudentByStudentId(studentId);

      if (!result) {
        throw new Error(`找不到學號「${studentId}」的學習計劃。`);
      }

      setEditorOrigin("search");
      setSelectedStudent(result.student);
      setSelectedModules(result.modules);
      setEditorReloadVersion((version) => version + 1);
      setActiveTab("editor");
    } finally {
      setLoading(false);
    }
  }

  function handleNewStudent() {
    setEditorOrigin("new");
    setSelectedStudent({
      studentId: "",
      studentName: "",
      intakeYear: "",
      intakeTerm: "",
      intakeLevel: "Year 1",
      studyMode: "FT",
      programmeCode: "",
      programmeStream: "",
      studentStatus: "potential",
      okToArticulate: true,
    });

    setSelectedModules([]);
    setEditorReloadVersion((version) => version + 1);
    setActiveTab("editor");
  }

  function handleBackFromEditor() {
    if (editorOrigin === "search") {
      goToTab("search");
      return;
    }

    goToTab("students");
  }

  async function handleEditorSaved() {
    await refreshStudents();

    if (editorOrigin === "search") {
      const profileId = selectedStudent?.id;

      if (profileId) {
        const result = await getStudyPlanStudent(profileId);
        setSelectedStudent(result.student);
        setSelectedModules(result.modules);
        setEditorReloadVersion((version) => version + 1);
      }

      alert("已保存");
      return;
    }

    goToTab("students");
  }

  async function handleUploadCompleted() {
    await refreshStudents();
    goToTab("students");
  }

  useEffect(() => {
    void refreshStudents();
  }, []);

  useEffect(() => {
    setCollapsed(activeTab === "editor");

    return () => {
      setCollapsed(false);
    };
  }, [activeTab, setCollapsed]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          學生學習計劃
        </h1>
        <p className="text-sm text-muted-foreground">
          管理學生學習計劃、科目狀態、修讀學期及實際學生人數。
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b pb-2">
        <button
          type="button"
          className={`px-4 py-2 rounded-md text-sm ${
            activeTab === "students"
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          }`}
          onClick={() => goToTab("students")}
        >
          學生列表
        </button>

        <button
          type="button"
          className={`px-4 py-2 rounded-md text-sm ${
            activeTab === "search"
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          }`}
          onClick={() => goToTab("search")}
        >
          搜寻
        </button>

        <button
          type="button"
          className={`px-4 py-2 rounded-md text-sm ${
            activeTab === "quota"
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          }`}
          onClick={() => goToTab("quota")}
        >
          学年 Quota
        </button>

        <button
          type="button"
          className={`px-4 py-2 rounded-md text-sm ${
            activeTab === "upload"
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          }`}
          onClick={() => goToTab("upload")}
        >
          初始 Excel 上載
        </button>

        <button
          type="button"
          className={`px-4 py-2 rounded-md text-sm ${
            activeTab === "editor"
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          }`}
          onClick={handleNewStudent}
        >
          新增 / 編輯學習計劃
        </button>

        <button
          type="button"
          className={`px-4 py-2 rounded-md text-sm ${
            activeTab === "reports"
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          }`}
          onClick={() => goToTab("reports")}
        >
          報表
        </button>
      </div>

      <div className={activeTab === "students" ? "block" : "hidden"}>
        <StudentListTab
          students={students}
          loading={loading}
          onRefresh={refreshStudents}
          onNew={handleNewStudent}
          onEdit={handleEditStudent}
        />
      </div>

      <div className={activeTab === "quota" ? "block" : "hidden"}>
        <QuotaTab />
      </div>

      <div className={activeTab === "search" ? "block" : "hidden"}>
        <StudyPlanSearchTab
          loading={loading}
          programmeCodes={programmeCodes}
          onSearchByStudentId={handleSearchByStudentId}
          onOpenStudent={(profileId) => openEditorFromProfile(profileId, "search")}
        />
      </div>

      {activeTab === "upload" && (
        <InitialStudyPlanUpload onUploaded={handleUploadCompleted} />
      )}

      {activeTab === "editor" && selectedStudent && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-lg border bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {selectedStudent.studentId
                  ? "編輯學習計劃"
                  : "新增學習計劃"}
              </h2>

              <p className="text-sm text-gray-500">
                {selectedStudent.studentId
                  ? `學生編號：${selectedStudent.studentId}`
                  : "建立新的學生學習計劃。"}
              </p>
            </div>

            <button
              type="button"
              onClick={handleBackFromEditor}
              className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
            >
              {editorOrigin === "search"
                ? "← 返回搜寻"
                : "← 返回學生列表"}
            </button>
          </div>

          <StudentProfileEditor
            initialStudent={selectedStudent}
            initialModules={selectedModules}
            editorReloadVersion={editorReloadVersion}
            onSaved={handleEditorSaved}
          />
        </div>
      )}

      {activeTab === "reports" && <ReportsTab />}
    </div>
  );
}
