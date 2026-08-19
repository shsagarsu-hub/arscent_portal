"use client";

import { useRef, useState } from "react";
import { todayISO } from "@/lib/dates";
import { createOrder } from "@/app/manager/orders/actions";
import type { OrderType } from "@/lib/supabase/database.types";

interface SkuRow {
  id: string;
  name: string;
  price_ex_gst: number | null;
}

interface SearchItem {
  id: string;
  name: string;
  skuId: string | null;
  skuName: string | null;
}

interface LineItem {
  key: string;
  skuId: string;
  officialName: string;
  note: string;
  qty: number;
  netPrice: number | null;
}

interface PreviewRow {
  itemName: string;
  qty: number;
  note: string;
  itemId: string | null;
  skuId: string | null;
  skuName: string | null;
}

const ORDER_TYPE_OPTIONS: { value: OrderType; label: string; description: string }[] = [
  {
    value: "short_term_consignment",
    label: "Short-Term Consignment",
    description: "Sent now, billed only for what's actually used.",
  },
  {
    value: "long_term_consignment",
    label: "Long-Term Consignment",
    description: "Standing stock kept at your center, billed as consumed.",
  },
  {
    value: "saleable",
    label: "Purchase",
    description: "An outright sale — billed for the full order.",
  },
];

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export function HospitalOrderForm({
  accountId,
  locationId,
  locations,
  skus,
  onSubmitted,
}: {
  accountId: string;
  locationId: string | null;
  locations: { id: string; name: string }[];
  skus: SkuRow[];
  onSubmitted?: () => void;
}) {
  const [orderLocationId, setOrderLocationId] = useState(locationId ?? locations[0]?.id ?? "");
  const [orderType, setOrderType] = useState<OrderType>("short_term_consignment");
  const [requestedDate, setRequestedDate] = useState(todayISO());
  const [poNumber, setPoNumber] = useState("");
  const [deliveryInstruction, setDeliveryInstruction] = useState("");
  const [comment, setComment] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const [poFile, setPoFile] = useState<File | null>(null);
  const poFileRef = useRef<HTMLInputElement>(null);

  // Search is against the real official ZEISS catalog (item_master), scoped
  // server-side to just the families this hospital's account has -- not the
  // generic 7-row `skus` list, which only exists for Tally-driven commitment
  // tracking and stays untouched.
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewRows, setPreviewRows] = useState<PreviewRow[] | null>(null);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadFileRef = useRef<HTMLInputElement>(null);

  function handleSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`/api/hospital/item-search?q=${encodeURIComponent(value.trim())}`);
      const body = await res.json();
      setSearchResults(body.items ?? []);
      setSearching(false);
    }, 300);
  }

  const skuPriceById = new Map(skus.map((s) => [s.id, s.price_ex_gst]));

  function addItem(item: SearchItem) {
    if (!item.skuId) return; // shouldn't happen -- search only returns matched items
    setItems((prev) => [
      ...prev,
      { key: newKey(), skuId: item.skuId as string, officialName: item.name, note: "", qty: 1, netPrice: skuPriceById.get(item.skuId as string) ?? null },
    ]);
  }
  function updateQty(key: string, qty: number) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, qty } : i)));
  }
  function updateNote(key: string, note: string) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, note } : i)));
  }
  function removeItem(key: string) {
    setItems((prev) => prev.filter((i) => i.key !== key));
  }

  async function handlePreview() {
    if (!uploadFile) return;
    setPreviewing(true);
    setUploadError(null);
    setUploadWarnings([]);
    setPreviewRows(null);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      const res = await fetch("/api/hospital/order-upload", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) {
        setUploadError(body.error ?? "Failed to read the file.");
        return;
      }
      setPreviewRows(body.rows);
      setUploadWarnings(body.warnings ?? []);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Failed to read the file.");
    } finally {
      setPreviewing(false);
      setUploadFile(null);
      if (uploadFileRef.current) uploadFileRef.current.value = "";
    }
  }

  function addPreviewToOrder() {
    if (!previewRows) return;
    const matched = previewRows.filter((r) => r.skuId);
    setItems((prev) => [
      ...prev,
      ...matched.map((row) => ({
        key: newKey(),
        skuId: row.skuId as string,
        officialName: row.itemName,
        note: row.note,
        qty: row.qty,
        netPrice: skuPriceById.get(row.skuId as string) ?? null,
      })),
    ]);
    setPreviewRows(null);
  }

  async function handleSubmit() {
    if (items.length === 0) return;
    if (!orderLocationId) {
      setStatus({ ok: false, text: "Select which center this order is for." });
      return;
    }
    setSaving(true);
    setStatus(null);

    let poAttachmentUrl: string | null = null;
    if (poFile) {
      const formData = new FormData();
      formData.append("file", poFile);
      const res = await fetch("/api/hospital/po-upload", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) {
        setSaving(false);
        setStatus({ ok: false, text: `Couldn't upload the PO attachment: ${body.error ?? "unknown error"}` });
        return;
      }
      poAttachmentUrl = body.url;
    }

    const res = await createOrder({
      orderType,
      accountId,
      locationId: orderLocationId,
      poNumber,
      requestedDate,
      deliveryInstruction,
      comment,
      // Consignment stock isn't billed until consumed; a straight purchase is
      // taxed like any other sale. Hospitals don't pick this directly -- it
      // follows from which of the three order types they chose above.
      taxCode: orderType === "saleable" ? "GST 18%" : "Exempt / Consignment",
      orderLineText: "",
      currencyCode: "INR",
      salesRep: "",
      partialShipment: false,
      poAttachmentUrl,
      lines: items.map((i) => ({
        skuId: i.skuId,
        qty: i.qty,
        uom: "EA",
        netPrice: i.netPrice,
        // The exact official SKU is always recorded here -- sku_id alone
        // only identifies the generic family (needed for Vs Committed), so
        // this is the one place the specific diopter/variant survives.
        notes: i.note ? `${i.officialName} — ${i.note}` : i.officialName,
      })),
    });
    setSaving(false);
    if (res.success) {
      setStatus({
        ok: true,
        text: `Order submitted — ${res.workOrderNo}. Your account manager will confirm it shortly.${
          res.email.sent ? "" : ` (Confirmation email not sent — ${res.email.reason ?? res.email.error ?? "unknown reason"}.)`
        }`,
      });
      setItems([]);
      setPoNumber("");
      setDeliveryInstruction("");
      setComment("");
      setPoFile(null);
      if (poFileRef.current) poFileRef.current.value = "";
      onSubmitted?.();
    } else {
      setStatus({ ok: false, text: res.message });
    }
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">Place an order</h3>
        <p className="mb-3.5 text-xs text-muted">
          Pick an order type, then fill in the shipment details below.
        </p>

        {locationId === null && (
          <div className="mb-4 max-w-xs">
            <label className="field-label">Center</label>
            <select
              className="field-input"
              value={orderLocationId}
              onChange={(e) => setOrderLocationId(e.target.value)}
            >
              <option value="">Select…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {ORDER_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setOrderType(opt.value)}
              className={`rounded-[6px] border p-3 text-left transition ${
                orderType === opt.value ? "border-brand bg-[#eaf1fd]" : "border-border bg-card hover:bg-cream"
              }`}
            >
              <div className="text-[13px] font-extrabold text-ink">{opt.label}</div>
              <div className="mt-0.5 text-[11.5px] text-muted">{opt.description}</div>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
          <div>
            <label className="field-label">Requested Date</label>
            <input
              type="date"
              className="field-input"
              value={requestedDate}
              onChange={(e) => setRequestedDate(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">Purchase Order Number</label>
            <input
              className="field-input"
              placeholder="Optional"
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">Delivery Instruction</label>
            <input
              className="field-input"
              placeholder="Optional"
              value={deliveryInstruction}
              onChange={(e) => setDeliveryInstruction(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
          <div>
            <label className="field-label">PO Attachment</label>
            <input
              ref={poFileRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              className="field-input file:mr-2 file:rounded-[3px] file:border-0 file:bg-brand file:px-2 file:py-1 file:text-[11px] file:font-bold file:text-white"
              onChange={(e) => setPoFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="field-label">Comment</label>
            <input
              className="field-input"
              placeholder="Optional"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="mb-3.5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">Products</h3>
            <p className="text-xs text-muted">
              Search by exact power/diopter, or use the upload template.
            </p>
          </div>
          <a
            href="/api/hospital/order-template"
            className="shrink-0 rounded-[4px] border border-border bg-card px-3 py-1.5 text-[11.5px] font-bold text-brand hover:bg-cream"
          >
            ⬇ Download Template
          </a>
        </div>

        <input
          className="field-input mb-3"
          placeholder="Search by exact power/diopter, e.g. &quot;CT LUCIA DPT 20.5&quot;…"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
        {search.trim().length >= 2 && (
          <div className="mb-3 max-h-56 overflow-y-auto rounded-[4px] border border-border">
            <table className="u-table">
              <thead>
                <tr>
                  <th>Official ZEISS SKU</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {searchResults.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>
                      <button className="text-xs font-bold text-brand hover:underline" onClick={() => addItem(r)}>
                        + Add
                      </button>
                    </td>
                  </tr>
                ))}
                {!searching && searchResults.length === 0 && (
                  <tr>
                    <td colSpan={2} className="text-center text-xs text-muted">
                      No matches in your account&apos;s product families.
                    </td>
                  </tr>
                )}
                {searching && (
                  <tr>
                    <td colSpan={2} className="text-center text-xs text-muted">
                      Searching…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="mb-4 rounded-[6px] border border-border bg-cream/50 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <input
              ref={uploadFileRef}
              type="file"
              accept=".xlsx,.xlsm"
              className="field-input max-w-xs !py-1.5 text-[12px]"
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              className="btn-primary !px-3 !py-1.5 text-[12px]"
              disabled={!uploadFile || previewing}
              onClick={handlePreview}
            >
              {previewing ? "Reading…" : "Preview"}
            </button>
          </div>
          {uploadError && <p className="text-xs font-semibold text-bad-fg">{uploadError}</p>}
          {uploadWarnings.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-xs font-semibold text-watch-fg">
              {uploadWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          {previewRows && previewRows.length > 0 && (
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-bold text-ink-soft">
                  Preview — {previewRows.filter((r) => r.skuId).length} matched, {previewRows.filter((r) => !r.skuId).length} unmatched
                </p>
                <button type="button" className="btn-primary !px-3 !py-1.5 text-[12px]" onClick={addPreviewToOrder}>
                  Add matched items to order
                </button>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-[4px] border border-border">
                <table className="u-table">
                  <thead>
                    <tr>
                      <th>Official ZEISS SKU</th>
                      <th>Qty</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, i) => (
                      <tr key={i}>
                        <td>{r.itemName}</td>
                        <td>{r.qty}</td>
                        <td>
                          {r.skuId ? (
                            <span className="badge badge-good">matched</span>
                          ) : r.itemId ? (
                            <span className="badge badge-bad" title="This exact SKU exists in the catalog, but its product family isn't on your account">
                              not in your account
                            </span>
                          ) : (
                            <span className="badge badge-bad" title="Not found in the official ZEISS catalog">
                              no match
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="u-table">
            <thead>
              <tr>
                <th>Official ZEISS SKU</th>
                <th>Note</th>
                <th>Quantity</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.key}>
                  <td>{i.officialName}</td>
                  <td>
                    <input
                      type="text"
                      placeholder="Optional"
                      className="w-40 rounded-[4px] border border-border px-2 py-1.5 text-[12.5px] outline-none focus:border-accent"
                      value={i.note}
                      onChange={(e) => updateNote(i.key, e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      className="w-20 rounded-[4px] border border-border px-2 py-1.5 text-[12.5px] outline-none focus:border-accent"
                      value={i.qty}
                      onChange={(e) => updateQty(i.key, parseInt(e.target.value, 10) || 1)}
                    />
                  </td>
                  <td>
                    <button className="text-xs font-bold text-bad-fg hover:underline" onClick={() => removeItem(i.key)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-xs text-muted">
                    No products added yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          className="btn-primary"
          onClick={handleSubmit}
          disabled={items.length === 0 || saving || !orderLocationId}
        >
          {saving ? "Submitting…" : "Submit order"}
        </button>
        {status && <span className={`text-xs font-semibold ${status.ok ? "text-good-fg" : "text-bad-fg"}`}>{status.text}</span>}
      </div>
    </div>
  );
}
