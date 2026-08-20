"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loading } from "./AppShell";

interface MovementRow {
  item_id: string;
  category: string;
  qty: number;
  batch_number: string | null;
  expiry_date: string | null;
  item_master: { name: string } | null;
}

interface ExpiringBatch {
  itemId: string;
  itemName: string;
  batchNumber: string;
  expiryDate: string;
  qty: number;
  daysLeft: number;
}

const DAYS_THRESHOLD = 180;

function daysUntil(dateIso: string) {
  const ms = new Date(dateIso).getTime() - new Date().setHours(0, 0, 0, 0);
  return Math.round(ms / 86400000);
}

/**
 * "Stock" here means total units of a batch still somewhere in Arscent's
 * possession, regardless of whether it's sitting in the warehouse or out on
 * consignment at a hospital -- purchase_in/material_in add, sale_out/
 * material_out remove (truly gone), but dc_out/dc_return_in are excluded
 * entirely since they only move a batch between warehouse and a hospital
 * without changing how much of it Arscent is exposed to expiring. That's
 * the "irrespective of consignment or warehouse stock" requirement -- a
 * batch flagged here is at risk no matter which side of that split it's on.
 */
export function ExpiringStockAlert() {
  const supabase = createClient();
  const [batches, setBatches] = useState<ExpiringBatch[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("stock_movements")
        .select("item_id, category, qty, batch_number, expiry_date, item_master(name)")
        .not("batch_number", "is", null)
        .not("expiry_date", "is", null)
        .returns<MovementRow[]>();

      const byBatch = new Map<string, { itemName: string; expiryDate: string; qty: number }>();
      (data ?? []).forEach((m) => {
        if (!m.batch_number || !m.expiry_date) return;
        const key = `${m.item_id}|${m.batch_number}`;
        const cur = byBatch.get(key) ?? { itemName: m.item_master?.name ?? "—", expiryDate: m.expiry_date, qty: 0 };
        const sign = m.category === "purchase_in" || m.category === "material_in" ? 1 : m.category === "sale_out" || m.category === "material_out" ? -1 : 0;
        cur.qty += sign * m.qty;
        byBatch.set(key, cur);
      });

      const result: ExpiringBatch[] = [];
      for (const [key, v] of byBatch) {
        if (v.qty <= 0) continue;
        const daysLeft = daysUntil(v.expiryDate);
        if (daysLeft > DAYS_THRESHOLD) continue;
        const [itemId, batchNumber] = key.split("|");
        result.push({ itemId, itemName: v.itemName, batchNumber, expiryDate: v.expiryDate, qty: v.qty, daysLeft });
      }
      result.sort((a, b) => a.daysLeft - b.daysLeft);
      setBatches(result);
    })();
  }, [supabase]);

  if (batches === null) return <Loading />;
  const visible = batches.filter((b) => !dismissed.has(`${b.itemId}|${b.batchNumber}`));
  if (visible.length === 0) return null;

  return (
    <div className="card border-watch-fg bg-[#fef3e2]">
      <h3 className="mb-1 text-[14.5px] font-extrabold text-watch-fg">⚠ Stock expiring within {DAYS_THRESHOLD} days</h3>
      <p className="mb-3.5 text-xs text-ink-soft">
        Every batch still in Arscent&apos;s possession — warehouse or out on consignment — with less than {DAYS_THRESHOLD} days to
        expiry, already-expired ones included.
      </p>
      <div className="overflow-x-auto">
        <table className="u-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Batch</th>
              <th>Expiry</th>
              <th className="text-right">Days left</th>
              <th className="text-right">Qty</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((b) => (
              <tr key={`${b.itemId}|${b.batchNumber}`}>
                <td className="text-ink">{b.itemName}</td>
                <td className="text-muted">{b.batchNumber}</td>
                <td className="text-muted">{new Date(b.expiryDate).toLocaleDateString("en-IN")}</td>
                <td className={`text-right font-bold ${b.daysLeft < 0 ? "text-bad-fg" : b.daysLeft <= 30 ? "text-bad-fg" : "text-watch-fg"}`}>
                  {b.daysLeft < 0 ? `Expired ${Math.abs(b.daysLeft)}d ago` : `${b.daysLeft}d`}
                </td>
                <td className="text-right font-bold text-ink">{b.qty}</td>
                <td>
                  <button
                    type="button"
                    className="rounded-[4px] border border-border bg-card px-2.5 py-1 text-[11px] font-bold text-ink-soft"
                    onClick={() => setDismissed((prev) => new Set(prev).add(`${b.itemId}|${b.batchNumber}`))}
                  >
                    Dismiss
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
