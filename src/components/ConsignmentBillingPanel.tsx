"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Empty, Loading } from "./AppShell";
import { fmtDate, todayISO } from "@/lib/dates";
import { deletePendingBillingRequest } from "@/app/manager/orders/actions";
import { getDefaultUsageInvoiceRecipients, sendUsageInvoiceEmailAction } from "@/app/manager/consignment/actions";
import type { BillingStatus } from "@/lib/supabase/database.types";

interface BillingRow {
  id: string;
  usage_log_id: string | null;
  order_line_id: string | null;
  entry_date: string;
  qty: number;
  unit_price: number | null;
  amount: number | null;
  status: BillingStatus;
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_attachment_url: string | null;
  account_id: string;
  location_id: string;
  batch_number: string | null;
  item_master_id: string | null;
  skus: { name: string } | null;
  usage_log: { note: string | null } | null;
  accounts: { label: string } | null;
  account_locations: { name: string } | null;
  item_master: { name: string } | null;
  order_lines: { notes: string | null; order_id: string } | null;
}

/** One hospital + center + day's worth of billing_requests rows, collapsed
 * to a single summary line -- usage is logged and invoiced per visit, not
 * per individual lens, so that's the granularity both tables show by
 * default. The underlying rows (and their per-item actions) are still there
 * on expand, since Record still has to deduct stock batch by batch. */
interface BillingGroup {
  key: string;
  account_id: string;
  location_id: string;
  entry_date: string;
  accounts: { label: string } | null;
  account_locations: { name: string } | null;
  rows: BillingRow[];
  totalQty: number;
  totalAmount: number | null;
}

function groupRows(rows: BillingRow[]): BillingGroup[] {
  const map = new Map<string, BillingGroup>();
  for (const row of rows) {
    const key = `${row.account_id}|${row.location_id}|${row.entry_date}`;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        account_id: row.account_id,
        location_id: row.location_id,
        entry_date: row.entry_date,
        accounts: row.accounts,
        account_locations: row.account_locations,
        rows: [],
        totalQty: 0,
        totalAmount: null,
      };
      map.set(key, group);
    }
    group.rows.push(row);
    group.totalQty += row.qty;
    if (row.amount != null) group.totalAmount = (group.totalAmount ?? 0) + row.amount;
  }
  // entry_date desc, same ordering the flat list used before grouping.
  return Array.from(map.values()).sort((a, b) => (a.entry_date < b.entry_date ? 1 : a.entry_date > b.entry_date ? -1 : 0));
}

/** Lets a manager confirm the exact catalog item an order-sourced pending
 * row deducts against -- orders only capture the generic SKU family, not
 * the specific diopter/power, so there's no way to auto-resolve this the
 * way a hospital's own Log Usage entry already has it. Same ilike-search
 * pattern as Inventory's item combobox, minus the "add new item" escape
 * hatch (a manager confirming an order should only ever pick something that
 * already exists in the catalog). */
function ItemPicker({
  itemId,
  itemName,
  onSelect,
}: {
  itemId: string;
  itemName: string;
  onSelect: (id: string, name: string) => void;
}) {
  const supabase = createClient();
  const [query, setQuery] = useState(itemName);
  const [suggestions, setSuggestions] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
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

  return (
    <div className="relative">
      <input
        className="field-input w-[220px] !py-1 text-[12px]"
        placeholder="Search catalog…"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-50 mt-1 max-h-56 w-[280px] overflow-y-auto rounded-[4px] border border-border bg-card shadow-[0_4px_12px_rgba(23,37,68,0.12)]">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`block w-full px-3 py-2 text-left text-[12px] hover:bg-cream ${
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
          {suggestions.length === 0 && <div className="px-3 py-2 text-[12px] text-muted">No match.</div>}
        </div>
      )}
    </div>
  );
}

/**
 * Manager-side view of the hospital consignment billing pipeline. Hospitals
 * only ever log usage (HospitalPortal's Log Usage tab) -- a DB trigger
 * auto-creates a billing_requests row the moment that happens (schema.sql
 * fn_create_billing_request). Everything from here on -- confirming
 * consumption actually happened and recording the eventual invoice -- is a
 * manager action across every account at once, not something a hospital
 * self-certifies.
 *
 * Both tables below are grouped one line per hospital + center + day: a
 * center logs usage and gets invoiced per visit, not per individual lens.
 * The per-item rows (and their Edit/Record/Delete actions, which still have
 * to work batch by batch) are one click away on expand.
 */
export function ConsignmentBillingPanel() {
  const supabase = createClient();

  const [billing, setBilling] = useState<BillingRow[] | null>(null);
  const [invoicingGroup, setInvoicingGroup] = useState<BillingGroup | null>(null);
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const [savedInvoiceUrl, setSavedInvoiceUrl] = useState<string | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [emailTo, setEmailTo] = useState("");
  const [emailCc, setEmailCc] = useState("");
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [recordingGroupKey, setRecordingGroupKey] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBatchNumber, setEditBatchNumber] = useState("");
  const [editItemMasterId, setEditItemMasterId] = useState("");
  const [editItemName, setEditItemName] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRecording, setBulkRecording] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedPending, setExpandedPending] = useState<Set<string>>(new Set());
  const [expandedRequested, setExpandedRequested] = useState<Set<string>>(new Set());

  const loadBilling = useCallback(async () => {
    const { data } = await supabase
      .from("billing_requests")
      .select(
        "id, usage_log_id, order_line_id, entry_date, qty, unit_price, amount, status, invoice_number, invoice_date, invoice_attachment_url, account_id, location_id, batch_number, item_master_id, skus(name), usage_log(note), accounts(label), account_locations(name), item_master(name), order_lines(notes, order_id)"
      )
      .in("status", ["pending", "requested"])
      .order("entry_date", { ascending: false })
      .returns<BillingRow[]>();
    setBilling(data ?? []);
    setSelectedIds(new Set());
  }, [supabase]);

  useEffect(() => {
    void (async () => {
      await loadBilling();
    })();
  }, [loadBilling]);

  /** The actual DB work for one row -- shared by the single Record button
   * and the bulk actions below. Returns an error message, or null on success. */
  async function recordOne(row: BillingRow): Promise<string | null> {
    // Deduct from that hospital's consignment stock for the exact item +
    // batch this entry resolved to, so Inventory -> Consignment by hospital
    // reflects it -- only possible once both are set (older/manual usage-log
    // rows from before item_master_id existed, or an order-sourced row the
    // manager hasn't confirmed via Edit yet, skip the movement and just
    // change status instead of guessing).
    if (row.item_master_id && row.batch_number) {
      const { error: moveError } = await supabase.from("stock_movements").insert({
        item_id: row.item_master_id,
        category: "sale_out",
        qty: row.qty,
        hospital_account_id: row.account_id,
        batch_number: row.batch_number,
        billing_request_id: row.id,
        notes: `Consumed & billed — billing_requests ${row.id}`,
      });
      if (moveError) return "Couldn't deduct consignment stock: " + moveError.message;
    }

    const { error } = await supabase
      .from("billing_requests")
      .update({ status: "requested", requested_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) return "Couldn't record it: " + error.message;
    return null;
  }

  async function recordUsage(row: BillingRow) {
    if (
      !confirm(
        `Record ${row.qty} unit(s) of ${row.skus?.name ?? "this product"} for ${row.accounts?.label ?? "this account"} as consumed? This moves it out of their consignment balance and into Pending Invoice.`
      )
    ) {
      return;
    }
    setRecordingId(row.id);
    const err = await recordOne(row);
    setRecordingId(null);
    if (err) {
      alert(err);
      return;
    }
    loadBilling();
  }

  function isReadyToRecord(row: BillingRow) {
    return !!row.item_master_id && !!row.batch_number;
  }

  async function deleteRow(row: BillingRow) {
    if (!confirm(`Delete this pending Usage Log entry (${row.skus?.name ?? "item"}, qty ${row.qty})? This can't be undone.`)) return;
    setDeletingId(row.id);
    const res = await deletePendingBillingRequest(row.id);
    setDeletingId(null);
    if (!res.success) {
      alert(res.message);
      return;
    }
    loadBilling();
  }

  async function bulkRecord() {
    const rows = pending.filter((b) => selectedIds.has(b.id) && isReadyToRecord(b));
    if (rows.length === 0) return;
    if (!confirm(`Record ${rows.length} selected entr${rows.length === 1 ? "y" : "ies"} as consumed?`)) return;
    setBulkRecording(true);
    const errors: string[] = [];
    for (const row of rows) {
      const err = await recordOne(row);
      if (err) errors.push(`${row.skus?.name ?? row.id}: ${err}`);
    }
    setBulkRecording(false);
    if (errors.length > 0) alert(`${rows.length - errors.length} of ${rows.length} recorded. Failures:\n` + errors.join("\n"));
    loadBilling();
  }

  /** Record every ready row in one hospital+center+day group at once -- the
   * group-level counterpart to the single Record button, for the common
   * case of clearing a whole visit in one go. */
  async function recordGroup(group: BillingGroup) {
    const rows = group.rows.filter(isReadyToRecord);
    if (rows.length === 0) return;
    if (
      !confirm(
        `Record ${rows.length} of ${group.rows.length} item(s) for ${group.accounts?.label ?? "this account"}${
          group.account_locations?.name ? ` (${group.account_locations.name})` : ""
        } on ${fmtDate(group.entry_date)} as consumed?`
      )
    ) {
      return;
    }
    setRecordingGroupKey(group.key);
    const errors: string[] = [];
    for (const row of rows) {
      const err = await recordOne(row);
      if (err) errors.push(`${row.skus?.name ?? row.id}: ${err}`);
    }
    setRecordingGroupKey(null);
    if (errors.length > 0) alert(`${rows.length - errors.length} of ${rows.length} recorded. Failures:\n` + errors.join("\n"));
    loadBilling();
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleExpanded(set: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) {
    set((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function startEdit(row: BillingRow) {
    setEditingId(row.id);
    setEditBatchNumber(row.batch_number ?? "");
    setEditItemMasterId(row.item_master_id ?? "");
    setEditItemName(row.item_master?.name ?? "");
  }

  async function saveEdit(row: BillingRow) {
    const trimmed = editBatchNumber.trim();
    if (!trimmed) {
      alert("Batch number can't be empty.");
      return;
    }
    // Order-sourced rows have no usage_log entry to inherit an item from --
    // the manager has to confirm exactly which catalog item this line was
    // for before Record can deduct stock against it.
    if (!row.usage_log_id && !editItemMasterId) {
      alert("Pick the exact catalog item this line is for.");
      return;
    }
    setSavingEdit(true);
    const billingUpdate: { batch_number: string; item_master_id?: string } = { batch_number: trimmed };
    if (editItemMasterId) billingUpdate.item_master_id = editItemMasterId;

    // Correct it everywhere it's read from -- usage_log is what the
    // hospital's own History shows (only exists for usage-log-sourced
    // rows), billing_requests is what Record actually deducts against, so a
    // mismatch between the two would silently pick the wrong batch to debit.
    const [{ error: usageErr }, { error: billingErr }] = await Promise.all([
      row.usage_log_id
        ? supabase.from("usage_log").update({ batch_number: trimmed }).eq("id", row.usage_log_id)
        : Promise.resolve({ error: null }),
      supabase.from("billing_requests").update(billingUpdate).eq("id", row.id),
    ]);
    setSavingEdit(false);
    const error = usageErr || billingErr;
    if (error) {
      alert("Couldn't save: " + error.message);
      return;
    }
    setEditingId(null);
    loadBilling();
  }

  /** Once every line on an order has been billed, the order itself is done
   * -- flip it to 'closed' so it stops showing "Send to Consignment" and
   * reads as finished in the Orders tab. */
  async function maybeCloseOrder(orderId: string) {
    const { data: lines } = await supabase.from("order_lines").select("id").eq("order_id", orderId);
    const lineIds = (lines ?? []).map((l) => l.id);
    if (lineIds.length === 0) return;
    const { data: rows } = await supabase.from("billing_requests").select("status").in("order_line_id", lineIds);
    const allBilled = (rows ?? []).length === lineIds.length && (rows ?? []).every((r) => r.status === "billed");
    if (allBilled) {
      await supabase.from("orders").update({ status: "closed" }).eq("id", orderId);
    }
  }

  /** One invoice covers every item in the group -- a hospital gets billed
   * once per visit, not once per lens. Every billing_requests row in the
   * group gets the same invoice file, date, and billed status in one update. */
  async function submitInvoice() {
    if (!invoicingGroup) return;
    if (!invoiceFile || !invoiceDate) {
      alert("Upload the invoice and enter its date.");
      return;
    }
    setSavingInvoice(true);
    setUploadingInvoice(true);
    const formData = new FormData();
    formData.append("file", invoiceFile);
    formData.append("kind", "usage");
    const uploadRes = await fetch("/api/manager/invoice-upload", { method: "POST", body: formData });
    const uploadBody = await uploadRes.json();
    setUploadingInvoice(false);
    if (!uploadRes.ok) {
      setSavingInvoice(false);
      alert("Couldn't upload the invoice: " + (uploadBody.error ?? "unknown error"));
      return;
    }
    const invoiceUrl: string = uploadBody.url;

    const ids = invoicingGroup.rows.map((r) => r.id);
    const { error } = await supabase
      .from("billing_requests")
      .update({
        status: "billed",
        billed_at: new Date().toISOString(),
        invoice_date: invoiceDate,
        invoice_attachment_url: invoiceUrl,
      })
      .in("id", ids);
    if (error) {
      setSavingInvoice(false);
      alert("Couldn't save the invoice: " + error.message);
      return;
    }
    const orderIds = new Set(invoicingGroup.rows.map((r) => r.order_lines?.order_id).filter((id): id is string => !!id));
    for (const orderId of orderIds) {
      await maybeCloseOrder(orderId);
    }
    setSavingInvoice(false);
    setSavedInvoiceUrl(invoiceUrl);
    // Prefill To with the hospital's own login(s) -- still editable before
    // anything is actually sent.
    const defaults = await getDefaultUsageInvoiceRecipients(invoicingGroup.account_id, invoicingGroup.location_id);
    setEmailTo(defaults.success ? defaults.to.join(", ") : "");
    setEmailCc("");
    loadBilling();
  }

  async function sendInvoiceEmail() {
    if (!invoicingGroup) return;
    const to = emailTo.split(",").map((s) => s.trim()).filter(Boolean);
    const cc = emailCc.split(",").map((s) => s.trim()).filter(Boolean);
    if (to.length === 0) {
      setEmailStatus({ ok: false, text: "Add at least one To recipient." });
      return;
    }
    setSendingEmail(true);
    setEmailStatus(null);
    const res = await sendUsageInvoiceEmailAction(invoicingGroup.rows.map((r) => r.id), to, cc);
    setSendingEmail(false);
    if (!res.success) {
      setEmailStatus({ ok: false, text: res.message });
      return;
    }
    setEmailStatus({ ok: true, text: `Sent to ${res.recipients.join(", ")}.` });
  }

  function closeInvoiceModal() {
    setInvoicingGroup(null);
    setInvoiceFile(null);
    setSavedInvoiceUrl(null);
    setEmailStatus(null);
    setEmailTo("");
    setEmailCc("");
  }

  const pending = billing?.filter((b) => b.status === "pending") ?? [];
  const requested = billing?.filter((b) => b.status === "requested") ?? [];
  const selectedReadyCount = pending.filter((b) => selectedIds.has(b.id) && isReadyToRecord(b)).length;

  const pendingGroups = useMemo(() => groupRows(pending), [pending]);
  const requestedGroups = useMemo(() => groupRows(requested), [requested]);

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[14.5px] font-extrabold text-ink">Usage Log</h3>
          {selectedReadyCount > 0 && (
            <button
              type="button"
              className="btn-primary !px-2.5 !py-1 text-[11px]"
              disabled={bulkRecording}
              onClick={bulkRecord}
            >
              {bulkRecording ? "Recording…" : `Record selected (${selectedReadyCount})`}
            </button>
          )}
        </div>
        {billing === null ? (
          <Loading />
        ) : pendingGroups.length === 0 ? (
          <Empty title="Nothing to record" body="New usage hospitals log or orders sent to Consignment will show up here first." />
        ) : (
          <div className="overflow-x-auto">
            <table className="u-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Date</th>
                  <th>Account</th>
                  <th>Center</th>
                  <th>Items</th>
                  <th>Qty</th>
                  <th>Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pendingGroups.map((g) => {
                  const isOpen = expandedPending.has(g.key);
                  const readyCount = g.rows.filter(isReadyToRecord).length;
                  return (
                    <Fragment key={g.key}>
                      <tr className="cursor-pointer hover:bg-cream" onClick={() => toggleExpanded(setExpandedPending, g.key)}>
                        <td className="text-muted">{isOpen ? "▾" : "▸"}</td>
                        <td className="whitespace-nowrap">{fmtDate(g.entry_date)}</td>
                        <td className="whitespace-nowrap">{g.accounts?.label ?? "—"}</td>
                        <td className="whitespace-nowrap">{g.account_locations?.name ?? "—"}</td>
                        <td>{g.rows.length}</td>
                        <td>{g.totalQty}</td>
                        <td>{g.totalAmount != null ? g.totalAmount.toLocaleString("en-IN") : "—"}</td>
                        <td className="whitespace-nowrap">
                          {readyCount > 0 && (
                            <button
                              type="button"
                              className="btn-primary !px-2.5 !py-1 text-[11px]"
                              disabled={recordingGroupKey === g.key}
                              onClick={(e) => {
                                e.stopPropagation();
                                recordGroup(g);
                              }}
                            >
                              {recordingGroupKey === g.key ? "Recording…" : `Record all ready (${readyCount})`}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={8} className="bg-cream/40 p-0">
                            <table className="u-table w-full">
                              <thead>
                                <tr>
                                  <th></th>
                                  <th>SKU</th>
                                  <th>Batch</th>
                                  <th>Note</th>
                                  <th>Qty</th>
                                  <th>Amount</th>
                                  <th></th>
                                </tr>
                              </thead>
                              <tbody>
                                {g.rows.map((b) =>
                                  editingId === b.id ? (
                                    <tr key={b.id}>
                                      <td></td>
                                      <td className="whitespace-nowrap text-[11.5px] text-muted">{b.skus?.name ?? "—"}</td>
                                      <td>
                                        <div className="flex flex-col gap-1">
                                          {!b.usage_log_id && (
                                            <ItemPicker
                                              itemId={editItemMasterId}
                                              itemName={editItemName}
                                              onSelect={(id, name) => {
                                                setEditItemMasterId(id);
                                                setEditItemName(name);
                                              }}
                                            />
                                          )}
                                          <input
                                            className="field-input w-[150px] !py-1 text-[12px]"
                                            placeholder="Batch number"
                                            value={editBatchNumber}
                                            onChange={(e) => setEditBatchNumber(e.target.value)}
                                            autoFocus={!!b.usage_log_id}
                                          />
                                        </div>
                                      </td>
                                      <td className="max-w-[220px] text-[11.5px] text-muted">
                                        {b.usage_log?.note ?? b.order_lines?.notes ?? "—"}
                                      </td>
                                      <td>{b.qty}</td>
                                      <td>{b.amount != null ? b.amount.toLocaleString("en-IN") : "—"}</td>
                                      <td className="whitespace-nowrap">
                                        <div className="flex gap-1.5">
                                          <button
                                            type="button"
                                            className="btn-primary !px-2.5 !py-1 text-[11px]"
                                            disabled={savingEdit}
                                            onClick={() => saveEdit(b)}
                                          >
                                            {savingEdit ? "Saving…" : "Save"}
                                          </button>
                                          <button
                                            type="button"
                                            className="rounded-[4px] border border-border bg-card px-2.5 py-1 text-[11px] font-bold text-ink-soft"
                                            disabled={savingEdit}
                                            onClick={() => setEditingId(null)}
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  ) : (
                                    <tr key={b.id}>
                                      <td>
                                        <input
                                          type="checkbox"
                                          checked={selectedIds.has(b.id)}
                                          onChange={() => toggleSelected(b.id)}
                                          disabled={!isReadyToRecord(b)}
                                        />
                                      </td>
                                      <td className="whitespace-nowrap text-[11.5px] text-muted">{b.skus?.name ?? "—"}</td>
                                      <td className="whitespace-nowrap">
                                        {b.batch_number ?? (
                                          <span className="badge badge-bad" title="Confirm the catalog item + batch via Edit before this can be recorded">
                                            {b.order_line_id ? "from order — needs item + batch" : "needs batch"}
                                          </span>
                                        )}
                                      </td>
                                      <td className="max-w-[220px] text-[11.5px] text-muted">
                                        {b.usage_log?.note ?? b.order_lines?.notes ?? "—"}
                                      </td>
                                      <td>{b.qty}</td>
                                      <td>{b.amount != null ? b.amount.toLocaleString("en-IN") : "—"}</td>
                                      <td className="whitespace-nowrap">
                                        <div className="flex gap-1.5">
                                          <button
                                            type="button"
                                            className="rounded-[4px] border border-border bg-card px-2.5 py-1 text-[11px] font-bold text-ink-soft"
                                            disabled={recordingId === b.id}
                                            onClick={() => startEdit(b)}
                                          >
                                            Edit
                                          </button>
                                          <button
                                            type="button"
                                            className="btn-primary !px-2.5 !py-1 text-[11px]"
                                            disabled={recordingId === b.id || !isReadyToRecord(b)}
                                            title={isReadyToRecord(b) ? undefined : "Confirm the catalog item + batch via Edit first"}
                                            onClick={() => recordUsage(b)}
                                          >
                                            {recordingId === b.id ? "Recording…" : "Record"}
                                          </button>
                                          <button
                                            type="button"
                                            className="rounded-[4px] border border-border bg-card px-2.5 py-1 text-[11px] font-bold text-bad-fg"
                                            disabled={deletingId === b.id}
                                            onClick={() => deleteRow(b)}
                                          >
                                            {deletingId === b.id ? "Deleting…" : "Delete"}
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  )
                                )}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="mb-3.5 text-[14.5px] font-extrabold text-ink">Pending Invoice</h3>
        {billing === null ? (
          <Loading />
        ) : requestedGroups.length === 0 ? (
          <Empty title="Nothing pending" body="Recorded usage awaiting an invoice will show up here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="u-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Date</th>
                  <th>Account</th>
                  <th>Center</th>
                  <th>Items</th>
                  <th>Qty</th>
                  <th>Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {requestedGroups.map((g) => {
                  const isOpen = expandedRequested.has(g.key);
                  return (
                    <Fragment key={g.key}>
                      <tr className="hover:bg-cream">
                        <td
                          className="cursor-pointer text-muted"
                          onClick={() => toggleExpanded(setExpandedRequested, g.key)}
                        >
                          {isOpen ? "▾" : "▸"}
                        </td>
                        <td className="whitespace-nowrap">{fmtDate(g.entry_date)}</td>
                        <td className="whitespace-nowrap">{g.accounts?.label ?? "—"}</td>
                        <td className="whitespace-nowrap">{g.account_locations?.name ?? "—"}</td>
                        <td>{g.rows.length}</td>
                        <td>{g.totalQty}</td>
                        <td>{g.totalAmount != null ? g.totalAmount.toLocaleString("en-IN") : "—"}</td>
                        <td>
                          <button
                            type="button"
                            className="text-xs font-bold text-brand hover:underline"
                            onClick={() => {
                              setInvoicingGroup(g);
                              setInvoiceFile(null);
                              setSavedInvoiceUrl(null);
                              setEmailStatus(null);
                              setInvoiceDate(todayISO());
                            }}
                          >
                            Add Invoice →
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={8} className="bg-cream/40 p-0">
                            <table className="u-table w-full">
                              <thead>
                                <tr>
                                  <th>SKU</th>
                                  <th>Batch</th>
                                  <th>Qty</th>
                                  <th>Amount</th>
                                </tr>
                              </thead>
                              <tbody>
                                {g.rows.map((b) => (
                                  <tr key={b.id}>
                                    <td className="whitespace-nowrap text-[11.5px] text-muted">{b.skus?.name ?? "—"}</td>
                                    <td className="whitespace-nowrap text-[11.5px] text-muted">{b.batch_number ?? "—"}</td>
                                    <td>{b.qty}</td>
                                    <td>{b.amount != null ? b.amount.toLocaleString("en-IN") : "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {invoicingGroup && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 p-4" onClick={closeInvoiceModal}>
          <div className="w-full max-w-sm rounded-[8px] bg-card p-5 shadow-[0_12px_32px_rgba(23,37,68,0.25)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">Upload invoice</h3>
            <p className="mb-3.5 text-xs text-muted">
              {invoicingGroup.accounts?.label ?? "—"}
              {invoicingGroup.account_locations?.name ? ` (${invoicingGroup.account_locations.name})` : ""} —{" "}
              {invoicingGroup.rows.length} item{invoicingGroup.rows.length === 1 ? "" : "s"}, qty {invoicingGroup.totalQty} ·{" "}
              {fmtDate(invoicingGroup.entry_date)}
            </p>
            {!savedInvoiceUrl ? (
              <>
                <div className="mb-3">
                  <label className="field-label">Invoice</label>
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    className="field-input file:mr-2 file:rounded-[3px] file:border-0 file:bg-brand file:px-2 file:py-1 file:text-[11px] file:font-bold file:text-white"
                    onChange={(e) => setInvoiceFile(e.target.files?.[0] ?? null)}
                  />
                </div>
                <div className="mb-4">
                  <label className="field-label">Invoice Date</label>
                  <input type="date" className="field-input" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn-primary" disabled={savingInvoice} onClick={submitInvoice}>
                    {uploadingInvoice ? "Uploading…" : savingInvoice ? "Saving…" : "Submit"}
                  </button>
                  <button
                    type="button"
                    className="rounded-[4px] border border-border bg-card px-3.5 py-1.5 text-xs font-bold text-ink-soft"
                    onClick={closeInvoiceModal}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mb-3.5 text-[12.5px] font-semibold text-good-fg">
                  Invoice saved.{" "}
                  <a href={savedInvoiceUrl} target="_blank" rel="noreferrer" className="font-bold text-brand hover:underline">
                    View
                  </a>
                </p>
                <div className="mb-3">
                  <label className="field-label">To</label>
                  <input
                    className="field-input"
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    placeholder="name@example.com, name2@example.com"
                    autoFocus
                  />
                </div>
                <div className="mb-4">
                  <label className="field-label">Cc</label>
                  <input
                    className="field-input"
                    value={emailCc}
                    onChange={(e) => setEmailCc(e.target.value)}
                    placeholder="Optional — comma-separated emails"
                  />
                </div>
                {emailStatus && (
                  <p className={`mb-3.5 text-[11.5px] font-semibold ${emailStatus.ok ? "text-good-fg" : "text-bad-fg"}`}>{emailStatus.text}</p>
                )}
                <div className="flex gap-2">
                  <button type="button" className="btn-primary" disabled={sendingEmail} onClick={sendInvoiceEmail}>
                    {sendingEmail ? "Sending…" : "Send Invoice Email"}
                  </button>
                  <button
                    type="button"
                    className="rounded-[4px] border border-border bg-card px-3.5 py-1.5 text-xs font-bold text-ink-soft"
                    onClick={closeInvoiceModal}
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
