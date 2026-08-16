"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Empty, Loading } from "../AppShell";

interface TallyLineRow {
  invoice_no: string;
  invoice_date: string;
  qty: number;
  rate: number | null;
  accounts: { label: string } | null;
}

interface InvoiceSummary {
  invoiceNo: string;
  date: string;
  account: string;
  lines: number;
  qty: number;
  revenue: number;
}

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

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("tally_invoice_lines")
      .select("invoice_no, invoice_date, qty, rate, accounts(label)")
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
        if (r.invoice_date > existing.date) existing.date = r.invoice_date;
      } else {
        map.set(r.invoice_no, {
          invoiceNo: r.invoice_no,
          date: r.invoice_date,
          account: r.accounts?.label ?? "—",
          lines: 1,
          qty: r.qty,
          revenue: lineRevenue,
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [rows]);

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
          <div className="mb-3">
            <input
              className="field-input max-w-xs !py-1.5 text-[12px]"
              placeholder="Search invoice # or account…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
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
                    <th>Invoice #</th>
                    <th>Date</th>
                    <th>Account</th>
                    <th>Lines</th>
                    <th>Qty</th>
                    <th>Revenue (ex GST)</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((inv) => (
                    <tr key={inv.invoiceNo}>
                      <td className="whitespace-nowrap font-semibold text-ink">{inv.invoiceNo}</td>
                      <td className="whitespace-nowrap">{new Date(inv.date).toLocaleDateString("en-IN")}</td>
                      <td className="whitespace-nowrap">{inv.account}</td>
                      <td>{inv.lines}</td>
                      <td>{inv.qty}</td>
                      <td className="whitespace-nowrap">₹{inv.revenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
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
