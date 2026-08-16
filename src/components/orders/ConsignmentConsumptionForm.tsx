"use client";

import { useMemo, useState } from "react";
import { todayISO } from "@/lib/dates";
import { createOrder, getConsignmentBalance, type ConsignmentBalanceLine } from "@/app/manager/orders/actions";

interface AccountRow {
  id: string;
  code: string;
  label: string;
}
interface LocationRow {
  id: string;
  account_id: string;
  name: string;
}

const GST_PCT = 9; // split CGST+SGST, 9% each (18% total) — placeholder until real tax codes exist

export function ConsignmentConsumptionForm({
  accounts,
  locations,
}: {
  accounts: AccountRow[];
  locations: LocationRow[];
}) {
  const [soldTo, setSoldTo] = useState("");
  const [shipTo, setShipTo] = useState("");
  const [requestedDate, setRequestedDate] = useState(todayISO());
  const [poNumber, setPoNumber] = useState("");
  const [comment, setComment] = useState("");
  const [salesRep, setSalesRep] = useState("Account Manager (you)");

  const [lines, setLines] = useState<ConsignmentBalanceLine[] | null>(null);
  const [billingQty, setBillingQty] = useState<Record<string, number>>({});
  const [retrieving, setRetrieving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const accountLocations = useMemo(() => locations.filter((l) => l.account_id === soldTo), [locations, soldTo]);

  async function retrieve() {
    setRetrieving(true);
    setStatus(null);
    const res = await getConsignmentBalance(soldTo, shipTo);
    setRetrieving(false);
    if (!res.success) {
      setStatus({ ok: false, text: res.message });
      setLines(null);
      return;
    }
    setLines(res.lines);
    setBillingQty(Object.fromEntries(res.lines.map((l) => [l.skuId, 0])));
  }

  function rowTotal(line: ConsignmentBalanceLine) {
    const qty = billingQty[line.skuId] ?? 0;
    const base = qty * (line.netPrice ?? 0);
    const gst = base * ((GST_PCT * 2) / 100);
    return { base, gst, total: base + gst };
  }

  async function handleSubmit() {
    if (!lines) return;
    const toSubmit = lines.filter((l) => (billingQty[l.skuId] ?? 0) > 0);
    if (toSubmit.length === 0) {
      setStatus({ ok: false, text: "Set a billing quantity for at least one line." });
      return;
    }
    setSaving(true);
    const res = await createOrder({
      orderType: "long_term_consignment_consumption",
      accountId: soldTo,
      locationId: shipTo,
      poNumber,
      requestedDate,
      deliveryInstruction: "",
      comment,
      taxCode: `GST ${GST_PCT * 2}%`,
      orderLineText: "Long Term Consignment Consumption Order",
      currencyCode: "INR",
      salesRep,
      partialShipment: false,
      lines: toSubmit.map((l) => ({ skuId: l.skuId, qty: billingQty[l.skuId], uom: "EA", netPrice: l.netPrice })),
    });
    setSaving(false);
    if (res.success) {
      setStatus({ ok: true, text: `Consumption billed — ${res.workOrderNo}.` });
      setLines(null);
    } else {
      setStatus({ ok: false, text: res.message });
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-extrabold text-ink">Long Term Consignment Consumption Order</h1>
      <h2 className="mb-4 text-sm font-bold text-muted-strong">Shipment Detail</h2>

      <div className="card mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Sold To">
          <select
            className="field-input"
            value={soldTo}
            onChange={(e) => {
              setSoldTo(e.target.value);
              setShipTo("");
              setLines(null);
            }}
          >
            <option value="">Select</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ship To">
          <select
            className="field-input"
            value={shipTo}
            onChange={(e) => {
              setShipTo(e.target.value);
              setLines(null);
            }}
            disabled={!soldTo}
          >
            <option value="">Select</option>
            {accountLocations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Requested Date">
          <input type="date" className="field-input" value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} />
        </Field>

        <Field label="Purchase Order Number">
          <input className="field-input" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
        </Field>
        <Field label="Comment">
          <input className="field-input" value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        <Field label="Currency Code">
          <input className="field-input bg-cream" value="INR — India Rupee" disabled />
        </Field>

        <Field label="Sales Rep">
          <input className="field-input" value={salesRep} onChange={(e) => setSalesRep(e.target.value)} />
        </Field>
        <div className="flex items-end sm:col-span-2">
          <button className="btn-primary" disabled={!shipTo || retrieving} onClick={retrieve}>
            {retrieving ? "Retrieving…" : "Retrieve"}
          </button>
        </div>
      </div>

      {lines && (
        <div className="card mb-4">
          <h3 className="mb-3 text-[14.5px] font-extrabold text-ink">Product Detail</h3>
          {lines.length === 0 ? (
            <p className="text-xs text-muted">
              No long-term consignment shipments found for this account/location yet — place a
              Long Term Consignment Order first.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="u-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Consignment Qty</th>
                    <th>Unit Price</th>
                    <th>Billing Qty</th>
                    <th>GST %</th>
                    <th>GST Amount</th>
                    <th>Total Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const { gst, total } = rowTotal(l);
                    return (
                      <tr key={l.skuId}>
                        <td>{l.skuName}</td>
                        <td>{l.consignmentQty}</td>
                        <td>{l.netPrice ?? "—"}</td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            max={l.consignmentQty}
                            className="w-20 rounded-[4px] border border-border px-2 py-1.5 text-[12.5px] outline-none focus:border-accent"
                            value={billingQty[l.skuId] ?? 0}
                            onChange={(e) =>
                              setBillingQty((prev) => ({ ...prev, [l.skuId]: parseInt(e.target.value, 10) || 0 }))
                            }
                          />
                        </td>
                        <td>{GST_PCT * 2}%</td>
                        <td>{gst.toFixed(2)}</td>
                        <td>{total.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={handleSubmit} disabled={!lines || lines.length === 0 || saving}>
          {saving ? "Submitting…" : "Submit"}
        </button>
        {status && <span className={`text-xs font-semibold ${status.ok ? "text-good-fg" : "text-bad-fg"}`}>{status.text}</span>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}
