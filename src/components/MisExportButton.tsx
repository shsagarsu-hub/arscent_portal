"use client";

import { useState } from "react";
import { exportMisWorkbook, type MisSheet } from "@/lib/exportMis";

export function MisExportButton({
  filename,
  sheets,
  dark = false,
}: {
  filename: string;
  sheets: MisSheet[];
  dark?: boolean;
}) {
  const [exporting, setExporting] = useState(false);
  const hasData = sheets.some((s) => s.rows.length > 0);

  return (
    <button
      type="button"
      className={
        dark
          ? "rounded-[6px] border-0 bg-white/15 px-2.5 py-1.5 text-[12px] font-semibold text-white outline-none disabled:opacity-50"
          : "rounded-[4px] border border-border bg-card px-2.5 py-1.5 text-[11px] font-bold text-ink-soft disabled:opacity-50"
      }
      disabled={!hasData || exporting}
      onClick={async () => {
        setExporting(true);
        try {
          await exportMisWorkbook(filename, sheets);
        } finally {
          setExporting(false);
        }
      }}
    >
      ⬇ {exporting ? "Exporting…" : "Export MIS to Excel"}
    </button>
  );
}
