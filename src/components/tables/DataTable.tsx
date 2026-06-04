import type { ReactNode } from "react";

import { TableViewport, type TableViewportSize } from "./TableViewport";

interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Scroll in a viewport-sized panel (see TableViewportSize). */
  viewportSize?: TableViewportSize | false;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  viewportSize = false,
}: DataTableProps<T>) {
  const table = (
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.header}</th>
            ))}
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-200 bg-white">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="hover:bg-slate-50">
              {columns.map((column) => (
                <td key={column.key}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
  );

  if (viewportSize) {
    return <TableViewport size={viewportSize}>{table}</TableViewport>;
  }

  return <div className="table-wrap">{table}</div>;
}
