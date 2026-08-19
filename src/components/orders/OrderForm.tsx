"use client";

import { useMemo, useState } from "react";
import { todayISO } from "@/lib/dates";
import { createOrder } from "@/app/manager/orders/actions";
import type { OrderType } from "@/lib/supabase/database.types";

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
interface SkuRow {
  id: string;
  account_id: string;
  name: string;
  price_ex_gst: number | null;
}

interface LineItem {
  skuId: string;
  code: string;
  description: string;
  uom: string;
  qty: number;
  netPrice: number | null;
}

const TAX_CODES = ["GST 18%", "GST 12%", "GST 5%", "Exempt / Consignment"];
const SALES_REPS = ["Account Manager (you)", "Unassigned"];

export function OrderForm({
  orderType,
  title,
  defaultOrderLineText,
  live = true,
  accounts,
  locations,
  skus,
}: {
  orderType: OrderType;
  title: string;
  defaultOrderLineText: string;
  /** false = UI-shape preview only, doesn't submit (used before a backend exists for a type) */
  live?: boolean;
  accounts: AccountRow[];
  locations: LocationRow[];
  skus: SkuRow[];
}) {
  const [soldTo, setSoldTo] = useState("");
  const [shipTo, setShipTo] = useState("");
  const [requestedDate, setRequestedDate] = useState(todayISO());
  const [poNumber, setPoNumber] = useState("");
  const [deliveryInstruction, setDeliveryInstruction] = useState("");
  const [comment, setComment] = useState("");
  const [taxCode, setTaxCode] = useState(TAX_CODES[3]);
  const [orderLineText, setOrderLineText] = useState(defaultOrderLineText);
  const [salesRep, setSalesRep] = useState(SALES_REPS[0]);
  const [partialShipment, setPartialShipment] = useState(false);

  const [showSearch, setShowSearch] = useState(false);
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const accountLocations = useMemo(
    () => locations.filter((l) => l.account_id === soldTo),
    [locations, soldTo]
  );
  const accountSkus = useMemo(
    () =>
      skus
        .filter((s) => s.account_id === soldTo)
        .filter((s) => s.name.toLowerCase().includes(search.toLowerCase())),
    [skus, soldTo, search]
  );

  const shipToLabel = useMemo(() => {
    const account = accounts.find((a) => a.id === soldTo);
    const location = locations.find((l) => l.id === shipTo);
    if (!account || !location) return "";
    return `${account.label} — ${location.name}`;
  }, [accounts, locations, soldTo, shipTo]);

  function addItem(sku: SkuRow) {
    if (items.some((i) => i.skuId === sku.id)) return;
    setItems((prev) => [
      ...prev,
      { skuId: sku.id, code: sku.id.slice(0, 8).toUpperCase(), description: sku.name, uom: "EA", qty: 1, netPrice: sku.price_ex_gst },
    ]);
  }

  function updateQty(skuId: string, qty: number) {
    setItems((prev) => prev.map((i) => (i.skuId === skuId ? { ...i, qty } : i)));
  }

  function removeItem(skuId: string) {
    setItems((prev) => prev.filter((i) => i.skuId !== skuId));
  }

  async function handleSubmit() {
    if (!live) {
      setStatus({
        ok: true,
        text: `Draft captured: ${items.length} line item(s). This order type isn't wired to the database yet — UI shape only.`,
      });
      return;
    }
    setSaving(true);
    setStatus(null);
    const res = await createOrder({
      orderType,
      accountId: soldTo,
      locationId: shipTo,
      poNumber,
      requestedDate,
      deliveryInstruction,
      comment,
      taxCode,
      orderLineText,
      currencyCode: "INR",
      salesRep,
      partialShipment,
      lines: items.map((i) => ({ skuId: i.skuId, qty: i.qty, uom: i.uom, netPrice: i.netPrice })),
    });
    setSaving(false);
    if (res.success) {
      setStatus({
        ok: true,
        text: `Order submitted — ${res.workOrderNo}.${
          res.email.sent ? "" : ` (Confirmation email not sent — ${res.email.reason ?? res.email.error ?? "unknown reason"}.)`
        }`,
      });
      setItems([]);
      setPoNumber("");
      setComment("");
    } else {
      setStatus({ ok: false, text: res.message });
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-extrabold text-ink">{title}</h1>
      <h2 className="mb-4 text-sm font-bold text-muted-strong">Shipment Detail</h2>

      <div className="card mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Sold To">
          <select
            className="field-input"
            value={soldTo}
            onChange={(e) => {
              setSoldTo(e.target.value);
              setShipTo("");
              setItems([]);
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
          <select className="field-input" value={shipTo} onChange={(e) => setShipTo(e.target.value)} disabled={!soldTo}>
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
        <Field label="Delivery Instruction">
          <input className="field-input" value={deliveryInstruction} onChange={(e) => setDeliveryInstruction(e.target.value)} />
        </Field>
        <Field label="Comment">
          <input className="field-input" value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>

        <Field label="Tax Code">
          <select className="field-input" value={taxCode} onChange={(e) => setTaxCode(e.target.value)}>
            {TAX_CODES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Order Line Text">
          <input className="field-input" value={orderLineText} onChange={(e) => setOrderLineText(e.target.value)} />
        </Field>
        <Field label="Currency Code">
          <input className="field-input bg-cream" value="INR — India Rupee" disabled />
        </Field>

        <Field label="Sales Rep">
          <select className="field-input" value={salesRep} onChange={(e) => setSalesRep(e.target.value)}>
            {SALES_REPS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end pb-2.5">
          <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-soft">
            <input type="checkbox" checked={partialShipment} onChange={(e) => setPartialShipment(e.target.checked)} />
            Partial Shipment
          </label>
        </div>
        <Field label="Ship To Address">
          <input className="field-input bg-cream" value={shipToLabel} disabled placeholder="—" />
        </Field>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="panel-dark">
          <svg className="mx-auto mb-2 h-8 w-8 text-white/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round" />
            <circle cx="20" cy="18" r="2.5" />
          </svg>
          <h3 className="mb-1 text-[13px] font-bold">Choose from the SKU list</h3>
          <p className="mb-3 text-xs text-white/70">{soldTo ? "Search the account's SKUs and add them below." : "Select Sold To first."}</p>
          <button className="btn-primary" disabled={!soldTo} onClick={() => setShowSearch((v) => !v)}>
            {showSearch ? "Close search" : "Search Product"}
          </button>
        </div>
        <div className="panel-dark opacity-80">
          <svg className="mx-auto mb-2 h-8 w-8 text-white/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 3v12m0-12 4 4m-4-4-4 4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h3 className="mb-1 text-[13px] font-bold">Download template &amp; upload</h3>
          <p className="mb-3 text-xs text-white/70">Bulk-add via spreadsheet template — not wired up yet.</p>
          <div className="flex justify-center gap-2">
            <input type="file" disabled className="field-input max-w-[160px] !bg-white/90" />
            <button className="btn-primary shrink-0" disabled>
              Upload
            </button>
          </div>
        </div>
      </div>

      {showSearch && soldTo && (
        <div className="card mb-4">
          <input className="field-input mb-3" placeholder="Search SKU name…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="max-h-64 overflow-y-auto">
            <table className="u-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Price (ex GST)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {accountSkus.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{s.price_ex_gst ?? "—"}</td>
                    <td>
                      <button className="text-xs font-bold text-brand hover:underline" onClick={() => addItem(s)} disabled={items.some((i) => i.skuId === s.id)}>
                        {items.some((i) => i.skuId === s.id) ? "Added" : "+ Add"}
                      </button>
                    </td>
                  </tr>
                ))}
                {accountSkus.length === 0 && (
                  <tr>
                    <td colSpan={3} className="text-center text-xs text-muted">
                      No SKUs match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card mb-4">
        <div className="overflow-x-auto">
          <table className="u-table">
            <thead>
              <tr>
                <th>Kit Code</th>
                <th>Kit Description</th>
                <th>UOM</th>
                <th>Quantity</th>
                <th>Net Price</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.skuId}>
                  <td>{i.code}</td>
                  <td>{i.description}</td>
                  <td>{i.uom}</td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      className="w-20 rounded-[4px] border border-border px-2 py-1.5 text-[12.5px] outline-none focus:border-accent"
                      value={i.qty}
                      onChange={(e) => updateQty(i.skuId, parseInt(e.target.value, 10) || 1)}
                    />
                  </td>
                  <td>{i.netPrice ?? "—"}</td>
                  <td>
                    <button className="text-xs font-bold text-bad-fg hover:underline" onClick={() => removeItem(i.skuId)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-xs text-muted">
                    No products added yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={handleSubmit} disabled={!shipTo || items.length === 0 || saving}>
          {saving ? "Submitting…" : "Submit"}
        </button>
        <button
          className="rounded-[4px] border border-border bg-card px-5 py-2.5 text-[13.5px] font-bold text-ink-soft"
          onClick={() => {
            setItems([]);
            setStatus(null);
          }}
        >
          Cancel
        </button>
        {status && (
          <span className={`text-xs font-semibold ${status.ok ? "text-good-fg" : "text-bad-fg"}`}>{status.text}</span>
        )}
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
