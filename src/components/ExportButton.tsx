"use client";

import { exportCsv } from "@/lib/exportCsv";

export function ExportButton<T extends object>({
  filename,
  columns,
  rows,
  dark = false,
}: {
  filename: string;
  columns: { key: keyof T & string; label: string }[];
  rows: T[];
  /** For placement on a dark/colored header, matching the surrounding
   * filter controls instead of the default light card-button style. */
  dark?: boolean;
}) {
  return (
    <button
      type="button"
      className={
        dark
          ? "rounded-[6px] border-0 bg-white/15 px-2.5 py-1.5 text-[12px] font-semibold text-white outline-none disabled:opacity-50"
          : "rounded-[4px] border border-border bg-card px-2.5 py-1.5 text-[11px] font-bold text-ink-soft disabled:opacity-50"
      }
      disabled={rows.length === 0}
      onClick={() => exportCsv(filename, columns, rows as unknown as Record<string, unknown>[])}
    >
      ⬇ Export to Excel
    </button>
  );
}
