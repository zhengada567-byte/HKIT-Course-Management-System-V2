import { useState, type FormEvent } from "react";

interface Props {
  loading: boolean;
  onSearch: (studentId: string) => Promise<void>;
}

export default function StudyPlanSearchTab({ loading, onSearch }: Props) {
  const [studentId, setStudentId] = useState("");
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const trimmedId = studentId.trim();

    if (!trimmedId) {
      setMessage("請輸入學號。");
      return;
    }

    setSearching(true);
    setMessage("");

    try {
      await onSearch(trimmedId);
    } catch (error) {
      const text =
        error instanceof Error
          ? error.message
          : "搜尋失敗，請稍後再試。";

      setMessage(text);
    } finally {
      setSearching(false);
    }
  }

  const busy = loading || searching;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">搜寻</h2>
        <p className="text-sm text-muted-foreground">
          按學號搜尋已儲存的學生檔案及學習計劃，以便快速開啟編輯。
        </p>
      </div>

      <div className="rounded-md border bg-white p-4 space-y-4">
        <p className="text-sm font-medium text-slate-700">学号搜寻</p>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="flex-1 min-w-[200px]">
            <label
              htmlFor="study-plan-search-student-id"
              className="mb-1 block text-sm font-medium"
            >
              學號 Student ID
            </label>
            <input
              id="study-plan-search-student-id"
              className="w-full rounded border px-3 py-2 text-sm"
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
              placeholder="輸入完整學號"
              disabled={busy}
              autoComplete="off"
            />
          </div>

          <button
            type="submit"
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
            disabled={busy}
          >
            {searching ? "搜寻中..." : "搜寻"}
          </button>
        </form>

        {message && (
          <p className="text-sm text-red-600" role="alert">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
