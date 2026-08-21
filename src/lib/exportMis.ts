"use client";

import ExcelJS from "exceljs";

export interface MisSheet {
  name: string;
  columns: { key: string; label: string; width?: number }[];
  rows: Record<string, unknown>[];
}

/**
 * Builds a real multi-sheet .xlsx -- the underlying data behind a dashboard
 * (one sheet per breakdown, plus a raw detail sheet), not a picture of the
 * charts themselves. Same exceljs already used server-side for the
 * Purchase/Movement templates; bundles fine client-side too (it ships its
 * own browser build).
 */
export async function exportMisWorkbook(filename: string, sheets: MisSheet[]) {
  const workbook = new ExcelJS.Workbook();

  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name.slice(0, 31)); // Excel's own sheet-name length cap
    ws.columns = sheet.columns.map((c) => ({ header: c.label, key: c.key, width: c.width ?? 20 }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6EDFA" } };
    sheet.rows.forEach((r) => ws.addRow(r));
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
