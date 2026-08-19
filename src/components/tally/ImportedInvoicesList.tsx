"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Empty, Loading } from "../AppShell";

type TallyDocumentType = "invoice" | "credit_note" | "debit_note";

interface TallyLineRow {
  id: string;
  invoice_no: string;
  invoice_date: string;
  qty: number;
  rate: number | null;
  accounts: { label: string } | null;
  document_type: TallyDocumentType;
}

interface InvoiceSummary {
  invoiceNo: string;
  date: string;
  account: string;
  lines: number;
  qty: number;
  revenue: number;
  documentType: TallyDocumentType;
  lineIds: string[];
}

const DOCUMENT_TYPE_LABELS: Record<TallyDocumentType, string> = {
  invoice: "Invoice",
  credit_note: "Credit Note",
  debit_note: "Debit Note",
};

/** One row per invoice number (not per line) -- purpose-built for the
 * question a reviewer actually has before uploading a new PDF: "have I
 * already imported this one?" The full line-level detail (batch, expiry,
 * rate per line) lives in Inventory -> Recent Movements once confirmed;
 * this is a quick lookup, not a duplicate of that record. */
export function ImportedInvoicesList() {
  const supabase = createClient();
  const [rows, setRows] = useState<TallyLineRow[] | null>(null);
  const [search, setSearch] = useState("");
  // Collapsed by default, same as Inventory's Recent Movements/Warehouse
  // Stock -- this is a lookup you open right before an upload, not
  // something that needs to stay in view the rest of the time.
  const [open, setOpen] = useState(false);
  const [cancelingInvoiceNo, setCancelingInvoiceNo] = useState<string | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("tally_invoice_lines")
      .select("id, invoice_no, invoice_date, qty, rate, accounts(label), document_type")
      .returns<TallyLineRow[]>();
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
      const lineRevenue = r.qty * (r.rate ?? 0);
      const existing = map.get(r.invoice_no);
      if (existing) {
        existing.lines += 1;
        existing.qty += r.qty;
        existing.revenue += lineRevenue;
        existing.lineIds.push(r.id);
        if (r.invoice_date > existing.date) existing.date = r.invoice_date;
      } else {
        map.set(r.invoice_no, {
          invoiceNo: r.invoice_no,
          date: r.invoice_date,
          account: r.accounts?.label ?? "—",
          lines: 1,
          qty: r.qty,
          revenue: lineRevenue,
          documentType: r.document_type,
          lineIds: [r.id],
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [rows]);

  /**
   * Deletes every tally_invoice_lines row for this invoice number -- the
   * FK's on-delete-cascade takes the dependent stock_movements rows down
   * with it in the same call, reducing Sold and dropping it out of Vs
   * Committed's Actual, exactly like deleting an invoice-sourced movement
   * in Inventory's Recent Movements does today (see deleteMovement there).
   * This is the invoice-level equivalent: one click for every line instead
   * of deleting them one at a time.
   */
  async function cancelInvoice(inv: InvoiceSummary) {
    const label = DOCUMENT_TYPE_LABELS[inv.documentType].toLowerCase();
    if (
      !confirm(
        `Cancel ${label} ${inv.invoiceNo}? This removes all ${inv.lines} line${inv.lines === 1 ? "" : "s"} (qty ${inv.qty}) from Sold, drops it from Vs Committed's Actual and the Dashboard's Revenue Booked, and adjusts warehouse stock accordingly. This can't be undone.`
      )
    ) {
      return;
    }
    setCancelingInvoiceNo(inv.invoiceNo);
    setStatus(null);
    const { error } = await supabase.from("tally_invoice_lines").delete().in("id", inv.lineIds);
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
    return invoices.filter(
      (inv) => inv.invoiceNo.toLowerCase().includes(q) || inv.account.toLowerCase().includes(q)
    );
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
          <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">Invoices imported to date</h3>
          <p className="text-xs text-muted">
            Check here before uploading a new PDF — {invoices.length} invoice{invoices.length === 1 ? "" : "s"} already
            confirmed. Re-confirming the same invoice number replaces its lines rather than duplicating them, but
            checking first saves the extra upload.
          </p>
        </div>
        <span className="ml-3 shrink-0 text-lg text-muted">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="mt-3.5">
          <div className="mb-3 flex items-center gap-3">
            <input
              className="field-input max-w-xs !py-1.5 text-[12px]"
              placeholder="Search invoice # or account…"
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
              body={invoices.length === 0 ? "Confirmed invoices will show up here." : "Try a different search term."}
            />
          ) : (
            <div className="max-h-80 overflow-y-auto overflow-x-auto">
              <table className="u-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Invoice #</th>
                    <th>Date</th>
                    <th>Account</th>
                    <th>Lines</th>
                    <th>Qty</th>
                    <th>Revenue (ex GST)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((inv) => (
                    <tr key={inv.invoiceNo}>
                      <td className="whitespace-nowrap">
                        {inv.documentType === "invoice" ? (
                          <span className="badge badge-neutral">Invoice</span>
                        ) : (
                          <span className={inv.documentType === "credit_note" ? "badge badge-bad" : "badge badge-watch"}>
                            {DOCUMENT_TYPE_LABELS[inv.documentType]}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap font-semibold text-ink">{inv.invoiceNo}</td>
                      <td className="whitespace-nowrap">{new Date(inv.date).toLocaleDateString("en-IN")}</td>
                      <td className="whitespace-nowrap">{inv.account}</td>
                      <td>{inv.lines}</td>
                      <td>{inv.qty}</td>
                      <td className={`whitespace-nowrap ${inv.revenue < 0 ? "text-bad-fg" : ""}`}>
                        {inv.revenue < 0 ? "−" : ""}₹{Math.abs(inv.revenue).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                      </td>
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
