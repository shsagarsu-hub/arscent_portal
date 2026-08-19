"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface ParsedPurchaseRow {
  itemName: string;
  batchNumber: string | null;
  expiryDate: string | null;
  qty: number;
}

interface ReviewRow extends ParsedPurchaseRow {
  key: string;
  itemId: string | null;
}

export function PurchaseImportPanel() {
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
      const res = await fetch("/api/purchase/parse", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) {
        setParseError(body.error ?? "Failed to parse the file.");
        return;
      }
      setParseWarnings(body.warnings ?? []);
      const parsedRows: ParsedPurchaseRow[] = body.rows;

      // One query for every unique item name, instead of one lookup per row
      // -- a real sheet here runs into the hundreds of batch rows.
      const uniqueNames = Array.from(new Set(parsedRows.map((r) => r.itemName)));
      const { data: matches } = await supabase.from("item_master").select("id, name").in("name", uniqueNames);
      const byName = new Map((matches ?? []).map((m) => [m.name, m.id]));

      setRows(
        parsedRows.map((r, idx) => ({
          ...r,
          key: `${idx}-${r.batchNumber ?? "none"}`,
          itemId: byName.get(r.itemName) ?? null,
        }))
      );
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

    const importable = rows.filter((r) => r.itemId);
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
      category: "purchase_in" as const,
      qty: r.qty,
      batch_number: r.batchNumber,
      expiry_date: r.expiryDate,
      notes: "Purchase import (Excel)",
      scanned_by: user?.id ?? null,
    }));

    const { error } = await supabase.from("stock_movements").insert(movementRows);
    setImporting(false);
    if (error) {
      setImportError(error.message);
      return;
    }
    setConfirmed({ count: importable.length, total: rows.length });
    // Clear the preview — ready for the next sheet, matching the invoice
    // import flow above.
    setRows([]);
  }

  const stats = {
    total: rows.length,
    matched: rows.filter((r) => r.itemId).length,
    unmatched: rows.filter((r) => !r.itemId).length,
  };

  return (
    <div className="card">
      <h3 className="mb-3.5 text-[14.5px] font-extrabold text-ink">Purchases (Excel)</h3>

      <div className="mb-3 flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xlsm"
          className="field-input max-w-xs"
          disabled={parsing}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button className="btn-primary shrink-0" disabled={!file || parsing} onClick={handleParse}>
          {parsing ? "Parsing…" : "Parse"}
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
                  <th>Batch</th>
                  <th>Expiry</th>
                  <th>Qty</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="whitespace-nowrap">{r.itemName}</td>
                    <td className="whitespace-nowrap">{r.batchNumber ?? "—"}</td>
                    <td className="whitespace-nowrap">
                      {r.expiryDate ? new Date(r.expiryDate).toLocaleDateString() : "—"}
                    </td>
                    <td>{r.qty}</td>
                    <td>
                      {r.itemId ? (
                        <span className="badge badge-good">matched</span>
                      ) : (
                        <span
                          className="badge badge-bad"
                          title="Not found in the catalog — add it via Inventory first, then re-upload"
                        >
                          no match
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button className="btn-primary" onClick={handleConfirm} disabled={importing || stats.matched === 0}>
            {importing ? "Importing…" : `Confirm & Import (${stats.matched})`}
          </button>
        </>
      )}

      {confirmed && (
        <p className="mt-2 text-xs font-semibold text-good-fg">
          Logged {confirmed.count} of {confirmed.total} rows as purchase-in movements — check
          Inventory to see them.
        </p>
      )}
      {importError && <p className="mt-2 text-xs font-semibold text-bad-fg">Import failed: {importError}</p>}
    </div>
  );
}
