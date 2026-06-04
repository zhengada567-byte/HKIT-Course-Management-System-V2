import type { CSSProperties, ReactNode } from "react";

/** `fill` = use remaining flex height; others = max-height from viewport. */
export type TableViewportSize =
  | "fill"
  | "page"
  | "filters"
  | "tallFilters"
  | "studyPlanStudents"
  | "courseSearch";

const MAX_HEIGHT: Record<Exclude<TableViewportSize, "fill">, string> = {
  page: "calc(100vh - 11rem)",
  filters: "calc(100vh - 19rem)",
  tallFilters: "calc(100vh - 26rem)",
  /** Study plan: title, tabs, programme filters (export is collapsible). */
  studyPlanStudents: "calc(100vh - 24rem)",
  /** Course search: compact filter row; breakdown optional/collapsed. */
  courseSearch: "calc(100vh - 13rem)",
};

interface TableViewportProps {
  children: ReactNode;
  size?: TableViewportSize;
  className?: string;
  style?: CSSProperties;
}

export function TableViewport({
  children,
  size = "page",
  className = "",
  style,
}: TableViewportProps) {
  const isFill = size === "fill";

  return (
    <div
      className={[
        "table-viewport",
        isFill ? "table-viewport--fill" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        ...(isFill ? undefined : { maxHeight: MAX_HEIGHT[size] }),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
