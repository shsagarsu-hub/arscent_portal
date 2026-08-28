"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Empty, Loading } from "../AppShell";

interface MovementRow {
  id: string;
  item_id: string;
  qty: number;
  batch_number: string | null;
  notes: string | null;
  created_at: string;
  item_master: { name: string } | null;
}

interface InvoiceSummary {
  invoiceNo: string;
  importedAt: string;
  products: Set<string>;
  units: number;
  movementIds: string[];
}

// Every purchase_in movement this panel creates carries "Zeiss Invoice
// <invoiceNo> — <description>" in notes (see PurchaseInvoiceImportPanel) --
// there's no dedicated invoice_no column on stock_movements, so that shared
// prefix is the only thing linking one invoice's ~200 individual-serial
// rows back together, the same way PurchaseOrderPanel groups its own
// Zeiss-PO movements by a shared notes prefix.
const NOTES_PREFIX_RE = /^Zeiss Invoice (\S+)/;

/** One row per invoice (not per serial) -- purpose-built for "have I
 * already imported this one?" before uploading a new PDF. Line-level detail
 * (per-serial batch/expiry) lives in Inventory's Recent Movements once
 * confirmed; this is a quick lookup, not a duplicate of that record. */
export function ImportedPurchaseInvoicesList() {
  const supabase = createClient();
  const [rows, setRows] = useState<MovementRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [cancelingInvoiceNo, setCancelingInvoiceNo] = useState<string | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("stock_movements")
      .select("id, item_id, qty, batch_number, notes, created_at, item_master(name)")
      .eq("category", "purchase_in")
      .ilike("notes", "Zeiss Invoice %")
      .returns<MovementRow[]>();
    setRows(data ?? []);
  }, [supabase]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const invoices = useMemo<InvoiceSummary[]>(() => {
    if (!rows) return [];
    const map = new Map<string, InvoiceSummary>();
    rows.forEach((r) => {
      const m = r.notes?.match(NOTES_PREFIX_RE);
      if (!m) return;
      const invoiceNo = m[1];
      const existing = map.get(invoiceNo);
      if (existing) {
        existing.units += r.qty;
        existing.movementIds.push(r.id);
        if (r.item_master?.name) existing.products.add(r.item_master.name);
        if (r.created_at < existing.importedAt) existing.importedAt = r.created_at;
      } else {
        map.set(invoiceNo, {
          invoiceNo,
          importedAt: r.created_at,
          products: new Set(r.item_master?.name ? [r.item_master.name] : []),
          units: r.qty,
          movementIds: [r.id],
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }, [rows]);

  /**
   * Deletes every purchase_in movement this invoice created -- the exact
   * inverse of importing it, so warehouse stock recomputes back down to
   * what it was before this invoice, exactly like cancelling a Zeiss PO in
   * the Purchase tab does for the opposite direction.
   */
  async function cancelInvoice(inv: InvoiceSummary) {
    if (
      !confirm(
        `Cancel invoice ${inv.invoiceNo}? This removes all ${inv.movementIds.length} purchase-in movement(s) (${inv.units} units across ${inv.products.size} product${inv.products.size === 1 ? "" : "s"}) and reduces warehouse stock accordingly. This can't be undone.`
      )
    ) {
      return;
    }
    setCancelingInvoiceNo(inv.invoiceNo);
    setStatus(null);
    const { error } = await supabase.from("stock_movements").delete().in("id", inv.movementIds);
    setCancelingInvoiceNo(null);
    if (error) {
      setStatus({ ok: false, text: `Couldn't cancel ${inv.invoiceNo}: ${error.message}` });
      return;
    }
    setStatus({ ok: true, text: `${inv.invoiceNo} cancelled.` });
    await load();
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((inv) => inv.invoiceNo.toLowerCase().includes(q));
  }, [invoices, search]);

  if (rows === null) {
    return (
      <div className="card mb-4">
        <Loading />
      </div>
    );
  }

  return (
    <div className="card mb-4">
      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpen((o) => !o)}>
        <div>
          <h3 className="text-[14.5px] font-extrabold text-ink">
            Purchase invoices imported to date <span className="font-normal text-muted">({invoices.length})</span>
          </h3>
        </div>
        <span className="ml-3 shrink-0 text-lg text-muted">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="mt-3.5">
          <div className="mb-3 flex items-center gap-3">
            <input
              className="field-input max-w-xs !py-1.5 text-[12px]"
              placeholder="Search invoice #…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {status && (
              <span className={`text-xs font-semibold ${status.ok ? "text-good-fg" : "text-bad-fg"}`}>{status.text}</span>
            )}
          </div>
          {filtered.length === 0 ? (
            <Empty
              title={invoices.length === 0 ? "Nothing imported yet" : "No match"}
              body={invoices.length === 0 ? "Confirmed purchase invoices will show up here." : "Try a different search term."}
            />
          ) : (
            <div className="max-h-80 overflow-y-auto overflow-x-auto">
              <table className="u-table">
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Imported</th>
                    <th>Products</th>
                    <th>Units</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((inv) => (
                    <tr key={inv.invoiceNo}>
                      <td className="whitespace-nowrap font-semibold text-ink">{inv.invoiceNo}</td>
                      <td className="whitespace-nowrap">{new Date(inv.importedAt).toLocaleDateString("en-IN")}</td>
                      <td>{inv.products.size}</td>
                      <td>{inv.units}</td>
                      <td className="whitespace-nowrap">
                        <button
                          type="button"
                          className="btn-outline-danger !px-2.5 !py-1 text-[11px]"
                          disabled={cancelingInvoiceNo === inv.invoiceNo}
                          onClick={() => cancelInvoice(inv)}
                        >
                          {cancelingInvoiceNo === inv.invoiceNo ? "Cancelling…" : "Cancel"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
