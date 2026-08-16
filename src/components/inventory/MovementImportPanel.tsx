"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CATEGORY_LABELS, HOSPITAL_CATEGORIES } from "@/lib/inventory/movementCategories";
import type { MovementCategory } from "@/lib/supabase/database.types";

interface UploadRow {
  itemName: string;
  itemId: string | null;
  category: MovementCategory | null;
  categoryLabel: string;
  qty: number;
  hospitalLabel: string | null;
  hospitalId: string | null;
  batchNumber: string | null;
  expiryDate: string | null;
  notes: string | null;
}

interface ReviewRow extends UploadRow {
  key: string;
}

function rowStatus(r: ReviewRow): { ok: boolean; label: string } {
  if (!r.itemId) return { ok: false, label: "item not found" };
  if (!r.category) return { ok: false, label: "unknown category" };
  if (HOSPITAL_CATEGORIES.includes(r.category) && !r.hospitalId) return { ok: false, label: "hospital not found" };
  return { ok: true, label: "ok" };
}

/** Bulk sibling to the manual "Log a movement" form above it -- same
 * download-template / upload / preview-with-match-status / confirm shape as
 * the hospital order-upload flow, generalized across every movement
 * category instead of one fixed category. */
export function MovementImportPanel({ onImported }: { onImported: () => void }) {
  const supabase = createClient();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [confirmed, setConfirmed] = useState<{ count: number; total: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleParse() {
    if (!file) return;
    setParsing(true);
    setParseError(null);
    setParseWarnings([]);
    setConfirmed(null);
    setImportError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/manager/movement-upload", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) {
        setParseError(body.error ?? "Failed to parse the file.");
        return;
      }
      setParseWarnings(body.warnings ?? []);
      setRows((body.rows as UploadRow[]).map((r, idx) => ({ ...r, key: `${idx}-${r.itemName}` })));
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Failed to parse the file.");
    } finally {
      setParsing(false);
    }
  }

  async function handleConfirm() {
    setImporting(true);
    setImportError(null);
    setConfirmed(null);

    const importable = rows.filter((r) => rowStatus(r).ok);
    if (importable.length === 0) {
      setImporting(false);
      setConfirmed({ count: 0, total: rows.length });
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const movementRows = importable.map((r) => ({
      item_id: r.itemId!,
      category: r.category!,
      qty: r.qty,
      hospital_account_id: HOSPITAL_CATEGORIES.includes(r.category!) ? r.hospitalId : null,
      batch_number: r.batchNumber,
      expiry_date: r.expiryDate,
      notes: r.notes ?? "Bulk import (Excel)",
      scanned_by: user?.id ?? null,
    }));

    const { error } = await supabase.from("stock_movements").insert(movementRows);
    setImporting(false);
    if (error) {
      setImportError(error.message);
      return;
    }
    setConfirmed({ count: importable.length, total: rows.length });
    setRows([]);
    onImported();
  }

  const stats = {
    total: rows.length,
    matched: rows.filter((r) => rowStatus(r).ok).length,
    unmatched: rows.filter((r) => !rowStatus(r).ok).length,
  };

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="mb-1 flex items-center justify-between">
        <h4 className="text-[13px] font-extrabold text-ink">Bulk import from Excel</h4>
        <a href="/api/manager/movement-template" className="text-xs font-bold text-brand hover:underline">
          ⬇ Download Template
        </a>
      </div>
      <p className="mb-3 text-xs text-muted">
        Log many movements at once — item names must match the catalog exactly, as per Tally (see
        the template&apos;s reference sheet for the exact spelling).
      </p>

      <div className="mb-3 flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xlsm"
          className="field-input max-w-xs"
          disabled={parsing}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button type="button" className="btn-primary shrink-0" disabled={!file || parsing} onClick={handleParse}>
          {parsing ? "Parsing…" : "Preview"}
        </button>
      </div>
      {parseError && <p className="mb-3 text-xs font-semibold text-bad-fg">{parseError}</p>}
      {parseWarnings.length > 0 && (
        <ul className="mb-3 list-disc space-y-0.5 pl-4 text-xs font-semibold text-watch-fg">
          {parseWarnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div className="rounded-[4px] border border-border bg-card p-2 text-center">
              <div className="text-[17px] font-extrabold text-ink">{stats.total}</div>
              <div className="text-[9px] font-bold uppercase tracking-wide text-muted">Rows</div>
            </div>
            <div className="rounded-[4px] border border-border bg-card p-2 text-center">
              <div className="text-[17px] font-extrabold text-good-fg">{stats.matched}</div>
              <div className="text-[9px] font-bold uppercase tracking-wide text-muted">Matched</div>
            </div>
            <div className="rounded-[4px] border border-border bg-card p-2 text-center">
              <div className="text-[17px] font-extrabold text-bad-fg">{stats.unmatched}</div>
              <div className="text-[9px] font-bold uppercase tracking-wide text-muted">Unmatched</div>
            </div>
          </div>

          <div className="mb-3 max-h-96 overflow-y-auto overflow-x-auto">
            <table className="u-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Category</th>
                  <th>Qty</th>
                  <th>Hospital</th>
                  <th>Batch</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const status = rowStatus(r);
                  return (
                    <tr key={r.key}>
                      <td className="whitespace-nowrap">{r.itemName}</td>
                      <td className="whitespace-nowrap">
                        {r.category ? CATEGORY_LABELS[r.category] : r.categoryLabel || "—"}
                      </td>
                      <td>{r.qty}</td>
                      <td className="whitespace-nowrap">{r.hospitalLabel ?? "—"}</td>
                      <td className="whitespace-nowrap">{r.batchNumber ?? "—"}</td>
                      <td>
                        {status.ok ? (
                          <span className="badge badge-good">ok</span>
                        ) : (
                          <span
                            className="badge badge-bad"
                            title="Check the item name, category, or hospital spelling against the template"
                          >
                            {status.label}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            className="btn-primary"
            onClick={handleConfirm}
            disabled={importing || stats.matched === 0}
          >
            {importing ? "Logging…" : `Log ${stats.matched} movement${stats.matched === 1 ? "" : "s"}`}
          </button>
        </>
      )}

      {confirmed && (
        <p className="mt-2 text-xs font-semibold text-good-fg">
          Logged {confirmed.count} of {confirmed.total} rows.
        </p>
      )}
      {importError && <p className="mt-2 text-xs font-semibold text-bad-fg">Import failed: {importError}</p>}
    </div>
  );
}
