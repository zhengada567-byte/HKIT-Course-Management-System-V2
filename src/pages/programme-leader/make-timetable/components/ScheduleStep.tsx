import type { TeachingAssignmentRow, TimetableModuleRow } from "../../../../types";

export function ScheduleStep(props: {
  timetableModules: TimetableModuleRow[];
  assignments: TeachingAssignmentRow[];
}) {
  const { timetableModules } = props;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-lg font-semibold">排課（試作）</div>
        <div className="mt-1 text-sm text-slate-600">
          這一步將會以 <span className="font-medium">module_instance_code</span>{" "}
          為排課單位，顯示教室×時間段的週網格，並在點擊 + 後顯示學期內空閒日子供勾選。
        </div>

        <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          目前先接好資料流與頁面骨架。下一步會加入教室管理、學期日曆、空閒日計算、以及
          cancel/make up 的 daily schedule 編輯。
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-sm font-medium text-slate-900">
          已生成的 module instances
        </div>
        <div className="mt-1 text-sm text-slate-600">
          共 {timetableModules.length} 個（已分班/合班後）
        </div>
      </div>
    </div>
  );
}

