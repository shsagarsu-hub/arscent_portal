"use client";

/**
 * Exports raw row data to a .csv file (opens directly in Excel -- no
 * server round-trip or bundled xlsx library needed since every report's
 * underlying rows already exist in the browser as plain arrays). A leading
 * UTF-8 BOM keeps Excel from mis-reading the ₹ symbol and other non-ASCII
 * characters as a different codepage.
 */
export function exportCsv(filename: string, columns: { key: string; label: string }[], rows: Record<string, unknown>[]) {
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => escape(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => escape(r[c.key])).join(",")).join("\n");
  const csv = "﻿" + [header, body].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
