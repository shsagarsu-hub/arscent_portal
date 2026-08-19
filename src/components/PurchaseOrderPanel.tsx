"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Empty, Loading } from "./AppShell";
import { submitPurchaseOrder } from "@/app/manager/purchase/actions";

// Arscent's standing Zeiss PO contacts, editable per send -- every PO to
// date has gone to this same distribution list (see the "Arscent PO #15 &
// 16" email thread), so prefilling it is a real time-save, not a guess.
const DEFAULT_TO = "sagar.manjunath.ext@zeiss.com, prashanth.pakkirappa.ext@zeiss.com, sunil.anjinappa@zeiss.com";
const DEFAULT_CC = "keshav@arraymed.co.in, sathish.l@zeiss.com, siddharth.prakash@zeiss.com";
const DEFAULT_REPLY_TO = "sales.arscent@gmail.com";
const DEFAULT_NOTES = "Please find the attached PO & Kindly do the needful.";
const DEFAULT_GST = "5";
const DEFAULT_DELIVERY = "Immediate";
const DEFAULT_PAYMENT = "60 Days Credit";
const DEFAULT_WARRANTY = "NA";

interface ItemSuggestion {
  id: string;
  name: string;
}

interface Line {
  key: string;
  itemId: string;
  itemName: string;
  qty: string;
  unitPrice: string;
  hsn: string;
}

function emptyLine(): Line {
  return { key: Math.random().toString(36).slice(2), itemId: "", itemName: "", qty: "1", unitPrice: "", hsn: "" };
}

function parseEmails(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Same debounced ilike-against-item_master combobox as Inventory's "Log a
 * movement" form and the order fulfillment modal -- the catalog runs into
 * the thousands, so it's never loaded in full. Also carries Inventory's
 * "no match -- add it" fallback: a PO can be the first time Arscent ever
 * orders a given lens power, so the catalog genuinely won't have it yet. */
function ItemPicker({
  itemId,
  itemName,
  onSelect,
  onCreate,
}: {
  itemId: string;
  itemName: string;
  onSelect: (id: string, name: string) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const supabase = createClient();
  const [query, setQuery] = useState(itemName);
  const [suggestions, setSuggestions] = useState<ItemSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [prevItemName, setPrevItemName] = useState(itemName);
  if (itemName !== prevItemName) {
    setPrevItemName(itemName);
    setQuery(itemName);
  }

  function handleChange(value: string) {
    setQuery(value);
    onSelect("", "");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase.from("item_master").select("id, name").ilike("name", `%${value.trim()}%`).order("name").limit(25);
      setSuggestions(data ?? []);
      setOpen(true);
    }, 250);
  }

  async function handleCreate() {
    setCreating(true);
    await onCreate(query.trim());
    setCreating(false);
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        className="field-input !py-1 text-[12.5px]"
        placeholder="Search catalog…"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-[4px] border border-border bg-card shadow-[0_4px_12px_rgba(23,37,68,0.12)]">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`block w-full px-3 py-2 text-left text-[12.5px] hover:bg-cream ${
                s.id === itemId ? "bg-[#eaf1fd] font-semibold text-brand" : "text-ink"
              }`}
              onMouseDown={() => {
                onSelect(s.id, s.name);
                setQuery(s.name);
                setOpen(false);
              }}
            >
              {s.name}
            </button>
          ))}
          {suggestions.length === 0 && (
            <div className="px-3 py-2 text-[12.5px] text-muted">
              No match.{" "}
              {query.trim().length >= 2 && (
                <button
                  type="button"
                  className="font-bold text-brand hover:underline"
                  onMouseDown={handleCreate}
                  disabled={creating}
                >
                  {creating ? "Adding…" : `+ Add "${query.trim()}" as a new item`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface PurchaseMovementRow {
  id: string;
  qty: number;
  notes: string | null;
  created_at: string;
  item_master: { name: string } | null;
}

// \S+ rather than a PO-specific pattern -- once typed in, this also has to
// match Arscent's real numbering (e.g. "AR/IOLs/26-27/17"), not just the
// auto-generated fallback format.
function poNumberFromNotes(notes: string | null): string {
  const m = notes?.match(/^Zeiss PO (\S+)/);
  return m ? m[1] : "—";
}

export function PurchaseOrderPanel() {
  const supabase = createClient();

  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [poNumber, setPoNumber] = useState("");
  const [to, setTo] = useState(DEFAULT_TO);
  const [cc, setCc] = useState(DEFAULT_CC);
  const [replyTo, setReplyTo] = useState(DEFAULT_REPLY_TO);
  const [notes, setNotes] = useState(DEFAULT_NOTES);
  const [gstPercent, setGstPercent] = useState(DEFAULT_GST);
  const [delivery, setDelivery] = useState(DEFAULT_DELIVERY);
  const [payment, setPayment] = useState(DEFAULT_PAYMENT);
  const [warranty, setWarranty] = useState(DEFAULT_WARRANTY);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const [recent, setRecent] = useState<PurchaseMovementRow[] | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);

  const loadRecent = useCallback(async () => {
    const { data } = await supabase
      .from("stock_movements")
      .select("id, qty, notes, created_at, item_master(name)")
      .eq("category", "purchase_in")
      .ilike("notes", "Zeiss PO %")
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<PurchaseMovementRow[]>();
    setRecent(data ?? []);
  }, [supabase]);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)));
  }

  // Same inline-create pattern as Inventory's "Log a movement" -- a PO can
  // legitimately be the first time Arscent orders a given lens power, so
  // the catalog won't have it yet.
  async function createItem(lineKey: string, name: string) {
    if (!name) return;
    const gtin = `MANUAL-${Date.now().toString(36).toUpperCase()}`;
    const { data, error } = await supabase.from("item_master").insert({ name, gtin }).select("id").single();
    if (!error && data) {
      updateLine(lineKey, { itemId: data.id, itemName: name });
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const toList = parseEmails(to);
    const ccList = parseEmails(cc);
    const cleanedLines = lines
      .map((l) => ({ itemId: l.itemId, itemName: l.itemName, qty: parseInt(l.qty, 10), unitPrice: parseFloat(l.unitPrice), hsn: l.hsn }))
      .filter((l) => l.itemId && l.qty > 0 && l.unitPrice > 0);

    if (cleanedLines.length !== lines.length) {
      setStatus({ ok: false, text: "Every line needs a catalog item, a quantity, and a unit price greater than 0 — that's what fills in the attached PO's pricing." });
      return;
    }
    if (toList.length === 0) {
      setStatus({ ok: false, text: "Add at least one To recipient." });
      return;
    }

    setSending(true);
    setStatus(null);
    const res = await submitPurchaseOrder({
      lines: cleanedLines,
      to: toList,
      cc: ccList,
      replyTo,
      notes,
      gstPercent: parseFloat(gstPercent) || 0,
      delivery,
      payment,
      warranty,
      poNumber: poNumber.trim() || undefined,
    });
    setSending(false);

    if (!res.success) {
      setStatus({ ok: false, text: res.message });
      return;
    }
    const emailNote = res.email.sent
      ? "Email + PDF sent to Zeiss."
      : `Inventory updated, but the email wasn't sent (${"reason" in res.email ? res.email.reason : res.email.error ?? "unknown reason"}).`;
    setStatus({ ok: true, text: `${res.poNumber} recorded — warehouse stock updated. ${emailNote}` });
    setLines([emptyLine()]);
    setPoNumber("");
    setNotes(DEFAULT_NOTES);
    await loadRecent();
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">Place a purchase order with Zeiss</h3>
        <p className="mb-3.5 text-xs text-muted">
          For deliveries already committed to a hospital — pick each product, quantity and unit price,
          then send. This emails Zeiss a PDF purchase order (same layout as Arscent&apos;s own PO
          template) and immediately adds the quantity to warehouse stock, the same as logging a
          Purchase In movement in Inventory.
        </p>
        <form onSubmit={submit}>
          <div className="mb-3 max-w-xs">
            <label className="field-label">PO Number</label>
            <input
              className="field-input"
              placeholder="e.g. AR/IOLs/26-27/17 — leave blank to auto-generate"
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value)}
            />
            {recent && recent.length > 0 && (
              <p className="mt-1 text-[11px] text-muted">
                Last sent: <span className="font-mono">{poNumberFromNotes(recent[0].notes)}</span> on{" "}
                {new Date(recent[0].created_at).toLocaleDateString()}
              </p>
            )}
          </div>
          <div className="mb-3 space-y-2">
            {lines.map((l, i) => (
              <div key={l.key} className="flex items-start gap-2">
                <div className="min-w-[200px] flex-1">
                  {i === 0 && <label className="field-label">Product</label>}
                  <ItemPicker
                    itemId={l.itemId}
                    itemName={l.itemName}
                    onSelect={(id, name) => updateLine(l.key, { itemId: id, itemName: name })}
                    onCreate={(name) => createItem(l.key, name)}
                  />
                </div>
                <div className="w-[80px]">
                  {i === 0 && <label className="field-label">Qty</label>}
                  <input
                    type="number"
                    min={1}
                    className="field-input !py-1 text-[12.5px]"
                    value={l.qty}
                    onChange={(e) => updateLine(l.key, { qty: e.target.value })}
                  />
                </div>
                <div className="w-[120px]">
                  {i === 0 && <label className="field-label">Unit price (Rs.)</label>}
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="field-input !py-1 text-[12.5px]"
                    placeholder="0.00"
                    value={l.unitPrice}
                    onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })}
                  />
                </div>
                <div className="w-[100px]">
                  {i === 0 && <label className="field-label">HSN (optional)</label>}
                  <input
                    className="field-input !py-1 text-[12.5px]"
                    value={l.hsn}
                    onChange={(e) => updateLine(l.key, { hsn: e.target.value })}
                  />
                </div>
                <button
                  type="button"
                  className={`rounded-[4px] border border-border bg-card px-2.5 text-xs font-bold text-ink-soft ${i === 0 ? "mt-[22px]" : ""} py-1.5`}
                  onClick={() => removeLine(l.key)}
                  disabled={lines.length === 1}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mb-4 rounded-[4px] border border-border bg-card px-3 py-1.5 text-xs font-bold text-ink-soft"
            onClick={addLine}
          >
            + Add product
          </button>

          <div className="mb-3 flex flex-wrap gap-3">
            <div className="w-[100px]">
              <label className="field-label">GST %</label>
              <input
                type="number"
                min={0}
                step="0.01"
                className="field-input"
                value={gstPercent}
                onChange={(e) => setGstPercent(e.target.value)}
              />
            </div>
            <div className="min-w-[160px] flex-1">
              <label className="field-label">Delivery</label>
              <input className="field-input" value={delivery} onChange={(e) => setDelivery(e.target.value)} />
            </div>
            <div className="min-w-[160px] flex-1">
              <label className="field-label">Payment</label>
              <input className="field-input" value={payment} onChange={(e) => setPayment(e.target.value)} />
            </div>
            <div className="min-w-[140px] flex-1">
              <label className="field-label">Warranty</label>
              <input className="field-input" value={warranty} onChange={(e) => setWarranty(e.target.value)} />
            </div>
          </div>

          <div className="mb-3 flex flex-wrap gap-3">
            <div className="min-w-[260px] flex-1">
              <label className="field-label">To</label>
              <input className="field-input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@zeiss.com, name2@zeiss.com" />
            </div>
            <div className="min-w-[260px] flex-1">
              <label className="field-label">Cc</label>
              <input className="field-input" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="name@example.com" />
            </div>
            <div className="min-w-[200px] flex-1">
              <label className="field-label">Reply-To</label>
              <input className="field-input" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} />
            </div>
          </div>

          <div className="mb-4">
            <label className="field-label">Message (email body)</label>
            <textarea className="field-input min-h-[70px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <button type="submit" className="btn-primary" disabled={sending}>
            {sending ? "Sending…" : "Send PO & update inventory"}
          </button>
          {status && (
            <p className={`mt-2 text-xs font-semibold ${status.ok ? "text-good-fg" : "text-bad-fg"}`}>{status.text}</p>
          )}
        </form>
      </div>

      <div className="card">
        <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setRecentOpen((o) => !o)}>
          <div>
            <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">Recent purchase orders</h3>
            <p className="text-xs text-muted">Every line sent from this tab — also visible, with edit/delete, in Inventory&apos;s movement log.</p>
          </div>
          <span className="ml-3 shrink-0 text-lg text-muted">{recentOpen ? "−" : "+"}</span>
        </button>
        {recentOpen && (
          <div className="mt-3.5">
            {recent === null ? (
              <Loading />
            ) : recent.length === 0 ? (
              <Empty title="No purchase orders sent yet" body="POs sent above will show up here." />
            ) : (
              <div className="overflow-x-auto">
                <table className="u-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>PO Number</th>
                      <th>Item</th>
                      <th>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((m) => (
                      <tr key={m.id}>
                        <td className="whitespace-nowrap">{new Date(m.created_at).toLocaleDateString()}</td>
                        <td className="whitespace-nowrap font-mono text-[11.5px]">{poNumberFromNotes(m.notes)}</td>
                        <td className="whitespace-nowrap">{m.item_master?.name ?? "—"}</td>
                        <td>{m.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
