import { Download } from "lucide-react";

export function BarChart({
  d,
  m,
}: {
  d: { l: string; v: number; c?: string }[];
  m: number;
}): React.JSX.Element {
  return (
    <div className="bar-chart">
      {d.slice(0, 15).map((item, index) => (
        <div className="bar-row" key={item.l}>
          <span className="bar-label" title={item.l}>
            {item.l}
          </span>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={
                {
                  width: `${Math.min((item.v / (m || 1)) * 100, 100)}%`,
                  ...(item.c !== undefined ? { backgroundColor: item.c } : {}),
                  "--i": index,
                } as React.CSSProperties
              }
            />
          </div>
          <span className="bar-value">{item.v.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: (string | number | undefined)[][],
): void {
  const escape = (v: string | number | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    headers.map(escape).join(","),
    ...rows.map((r) => r.map(escape).join(",")),
  ];
  const csv = "﻿" + lines.join("\n"); // UTF-8 BOM for Excel
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportButton({
  filename,
  headers,
  rows,
}: {
  filename: string;
  headers: string[];
  rows: (string | number | undefined)[][];
}): React.JSX.Element {
  return (
    <button
      className="btn btn-ghost btn-sm text-base-content/60 hover:text-base-content"
      onClick={(e) => {
        e.stopPropagation();
        downloadCsv(filename, headers, rows);
      }}
      aria-label={`瀵煎嚭 ${filename}`}
      title="瀵煎嚭 CSV"
    >
      <Download size={14} /> 瀵煎嚭
    </button>
  );
}
