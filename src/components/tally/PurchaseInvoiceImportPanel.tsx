"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface ParsedLine {
  itemNo: string;
  productId: string;
  description: string;
  qty: number;
  unitPrice: number;
  countryOfOrigin: string | null;
  serials: string[];
  batch: string | null;
  expiryDate: string | null;
  hsnCode: string | null;
}

interface ReviewLine extends ParsedLine {
  key: string;
  itemId: string | null;
}

export function PurchaseInvoiceImportPanel() {
  const supabase = createClient();
  const [invoiceNo, setInvoiceNo] = useState<string | null>(null);
  const [lines, setLines] = useState<ReviewLine[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [confirmed, setConfirmed] = useState<{ movements: number; total: number } | null>(null);
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
      const res = await fetch("/api/purchase/parse-invoice", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) {
        setParseError(body.error ?? "Failed to parse the file.");
        return;
      }
      setParseWarnings(body.warnings ?? []);
      setInvoiceNo(body.invoiceNo ?? null);
      const parsedLines: ParsedLine[] = body.lines;

      // Every real item_master row for these products is named "ZEISS " +
      // the invoice's own product description ("CT LUCIA 621P TIP2.2 DPT
      // 06.0" -> "ZEISS CT LUCIA 621P TIP2.2 DPT 06.0") -- confirmed against
      // the catalog's existing naming convention. One query for every unique
      // name instead of one lookup per line.
      const uniqueNames = Array.from(new Set(parsedLines.map((l) => `ZEISS ${l.description}`)));
      const { data: matches } = await supabase.from("item_master").select("id, name").in("name", uniqueNames);
      const byName = new Map((matches ?? []).map((m) => [m.name, m.id]));

      setLines(
        parsedLines.map((l, idx) => ({
          ...l,
          key: `${idx}-${l.productId}`,
          itemId: byName.get(`ZEISS ${l.description}`) ?? null,
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

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // A line with no matching catalog row is created on the fly -- a real
    // purchase invoice can legitimately be the first time Arscent buys a
    // given power, the same reasoning the Purchase tab's own inline
    // item-create already uses. Zeiss's own SAP product ID (e.g.
    // "003500-0034-693", always present on every line) is used as the gtin
    // value instead of a placeholder, since it's a real, stable Zeiss
    // catalog reference rather than a throwaway timestamp.
    const workingLines = [...lines];
    for (const line of workingLines) {
      if (line.itemId) continue;
      const { data: created, error } = await supabase
        .from("item_master")
        .insert({ name: `ZEISS ${line.description}`, gtin: line.productId })
        .select("id")
        .single();
      if (error || !created) {
        setImporting(false);
        setImportError(`Couldn't create a catalog entry for "${line.description}": ${error?.message ?? "unknown error"}`);
        return;
      }
      line.itemId = created.id;
    }

    // One stock_movements row per physical unit (per serial number), not
    // per invoice line -- batch_number is used elsewhere in this app to
    // match an individually scanned lens sticker back to its stock (see Log
    // Usage's barcode scan), so it has to carry the per-unit serial here,
    // not the shared lot code, to stay findable later. A line with no
        // parsed serials (shouldn't happen with a well-formed invoice, but
    // kept as a safety net) falls back to one row for its full quantity
    // under the shared batch instead of silently dropping it.
    const movementRows = workingLines.flatMap((l) => {
      const notes = `Zeiss Invoice ${invoiceNo ?? "?"} — ${l.description}`;
      if (l.serials.length > 0) {
        return l.serials.map((serial) => ({
          item_id: l.itemId!,
          category: "purchase_in" as const,
          qty: 1,
          batch_number: serial,
          expiry_date: l.expiryDate,
          notes,
          scanned_by: user?.id ?? null,
        }));
      }
      return [
        {
          item_id: l.itemId!,
          category: "purchase_in" as const,
          qty: l.qty,
          batch_number: l.batch,
          expiry_date: l.expiryDate,
          notes,
          scanned_by: user?.id ?? null,
        },
      ];
    });

    const { error } = await supabase.from("stock_movements").insert(movementRows);
    setImporting(false);
    if (error) {
      setImportError(error.message);
      return;
    }
    setConfirmed({ movements: movementRows.length, total: lines.length });
    setLines([]);
    setInvoiceNo(null);
  }

  const stats = {
    lines: lines.length,
    units: lines.reduce((s, l) => s + l.qty, 0),
    matched: lines.filter((l) => l.itemId).length,
    toCreate: lines.filter((l) => !l.itemId).length,
  };

  return (
    <div className="card">
      <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">Purchases (Zeiss invoice PDF)</h3>
      <p className="mb-3.5 text-xs text-muted">
        Upload the tax invoice PDF Zeiss sends with each shipment. Every serialized unit becomes its own
        purchase-in movement, matched to inventory later by that same serial.
      </p>

      <div className="mb-3 flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
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

      {lines.length > 0 && (
        <>
          {invoiceNo && (
            <p className="mb-3 text-xs font-semibold text-ink-soft">
              Invoice <span className="font-mono">{invoiceNo}</span>
            </p>
          )}
          <div className="mb-3 grid grid-cols-4 gap-2">
            <div className="rounded-[4px] border border-border bg-card p-2 text-center">
              <div className="text-[17px] font-extrabold text-ink">{stats.lines}</div>
              <div className="text-[9px] font-bold uppercase tracking-wide text-muted">Lines</div>
            </div>
            <div className="rounded-[4px] border border-border bg-card p-2 text-center">
              <div className="text-[17px] font-extrabold text-ink">{stats.units}</div>
              <div className="text-[9px] font-bold uppercase tracking-wide text-muted">Units</div>
            </div>
            <div className="rounded-[4px] border border-border bg-card p-2 text-center">
              <div className="text-[17px] font-extrabold text-good-fg">{stats.matched}</div>
              <div className="text-[9px] font-bold uppercase tracking-wide text-muted">Matched</div>
            </div>
            <div className="rounded-[4px] border border-border bg-card p-2 text-center">
              <div className="text-[17px] font-extrabold text-watch-fg">{stats.toCreate}</div>
              <div className="text-[9px] font-bold uppercase tracking-wide text-muted">To create</div>
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
                  <th>Serials</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td className="whitespace-nowrap">{l.description}</td>
                    <td className="whitespace-nowrap">{l.batch ?? "—"}</td>
                    <td className="whitespace-nowrap">{l.expiryDate ? new Date(l.expiryDate).toLocaleDateString() : "—"}</td>
                    <td>{l.qty}</td>
                    <td>{l.serials.length}</td>
                    <td>
                      {l.itemId ? (
                        <span className="badge badge-good">matched</span>
                      ) : (
                        <span className="badge badge-watch" title="No catalog entry yet — one will be created on import">
                          will create
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button className="btn-primary" onClick={handleConfirm} disabled={importing}>
            {importing ? "Importing…" : `Confirm & Import (${stats.units} units)`}
          </button>
        </>
      )}

      {confirmed && (
        <p className="mt-2 text-xs font-semibold text-good-fg">
          Logged {confirmed.movements} purchase-in movement(s) from {confirmed.total} invoice line(s) — check
          Inventory to see them.
        </p>
      )}
      {importError && <p className="mt-2 text-xs font-semibold text-bad-fg">Import failed: {importError}</p>}
    </div>
  );
}
