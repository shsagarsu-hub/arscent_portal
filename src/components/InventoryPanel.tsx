"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Empty, Loading } from "./AppShell";
import { MovementImportPanel } from "./inventory/MovementImportPanel";
import { ExportButton } from "./ExportButton";
import { CATEGORY_LABELS, HOSPITAL_CATEGORIES, MOVEMENT_CATEGORY_KEYS } from "@/lib/inventory/movementCategories";
import type { MovementCategory } from "@/lib/supabase/database.types";

interface ItemSuggestion {
  id: string;
  name: string;
}

interface AccountRow {
  id: string;
  label: string;
}

interface StockBalanceRow {
  item_id: string;
  name: string;
  purchase_in: number;
  dc_out: number;
  sale_out: number;
  material_out: number;
  dc_return_in: number;
  material_in: number;
  balance: number;
}

interface StockBalanceByBatchRow extends StockBalanceRow {
  batch_number: string | null;
  expiry_date: string | null;
}

interface ConsignmentBalanceRow {
  account_id: string;
  account_label: string;
  item_id: string;
  item_name: string;
  sent: number;
  returned: number;
  consumed: number;
  balance: number;
}

interface ConsignmentBalanceByBatchRow extends ConsignmentBalanceRow {
  batch_number: string;
}

interface ConsignmentLocationRow {
  name: string;
  sent: number;
  returned: number;
}

/** Raw shape of the nested stock_movements query used to derive a
 * per-location split -- consignment_balance itself has no location column
 * (stock_movements doesn't carry one), but every dc_out/dc_return_in row
 * created through a real order does carry order_line_id, and that order
 * always has a location_id, so the split is reachable by joining through it
 * instead of needing a schema change. */
interface LocationJoinRow {
  qty: number;
  category: MovementCategory;
  order_lines: { orders: { account_locations: { name: string } | null } | null } | null;
}

/** One row per item currently on hand at one specific hospital location --
 * "on hand" here means sent minus returned; there's no per-item consumption
 * source at this granularity (billing_requests, the real record of what got
 * used, is tracked per SKU family, not per exact lens power), so this reads
 * right today (nothing has been consumed yet anywhere) but would need that
 * netted in once real usage exists against these locations. */
interface LocationStockLine {
  itemName: string;
  sent: number;
  returned: number;
  balance: number;
}

interface LocationGroup {
  key: string; // `${accountId}-${locationName}`
  accountLabel: string;
  locationName: string;
  lines: LocationStockLine[];
  totalBalance: number;
}

/** Raw shape of the query LocationGroup is built from -- every account+item
 * this session ever sent to a hospital, with the location resolved via the
 * same order_line_id -> orders -> account_locations join as the per-item
 * breakdown, falling back to the account itself (no location) for an ad-hoc
 * "Sent to Hospital" logged directly in Inventory rather than through an
 * order. */
interface LocationStockJoinRow {
  qty: number;
  category: MovementCategory;
  hospital_account_id: string | null;
  item_master: { name: string } | null;
  accounts: { label: string } | null;
  order_lines: { orders: { account_locations: { name: string } | null } | null } | null;
}

interface MovementRow {
  id: string;
  category: MovementCategory;
  qty: number;
  batch_number: string | null;
  expiry_date: string | null;
  tally_invoice_line_id: string | null;
  billing_request_id: string | null;
  notes: string | null;
  created_at: string;
  item_master: { name: string } | null;
  accounts: { label: string } | null;
  tally_invoice_lines: { invoice_no: string; rate: number | null } | null;
}

/** Searchable item combobox — the catalog can run into the thousands (real
 * toric-lens power grids do), so this never loads the full list. It queries
 * item_master with ilike + a limit as the user types, instead of the plain
 * <select> a small catalog could get away with. */
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

  // Sync from parent (e.g. reset after submit, or a freshly-created item)
  // without an effect — adjusting state during render, per React's guidance
  // for mirroring a prop, avoids the extra render pass an effect would cost.
  const [prevItemName, setPrevItemName] = useState(itemName);
  if (itemName !== prevItemName) {
    setPrevItemName(itemName);
    setQuery(itemName);
  }

  function handleChange(value: string) {
    setQuery(value);
    onSelect("", ""); // clear selection until they pick a real suggestion
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from("item_master")
        .select("id, name")
        .ilike("name", `%${value.trim()}%`)
        .order("name")
        .limit(25);
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
        className="field-input"
        placeholder="Type to search the catalog…"
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

export function InventoryPanel() {
  const supabase = createClient();

  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [warehouse, setWarehouse] = useState<StockBalanceRow[] | null>(null);
  const [consignment, setConsignment] = useState<ConsignmentBalanceRow[] | null>(null);
  const [locationGroups, setLocationGroups] = useState<LocationGroup[] | null>(null);
  const [openLocationKey, setOpenLocationKey] = useState<string | null>(null);
  const [locationStockOpen, setLocationStockOpen] = useState(false);
  const [movements, setMovements] = useState<MovementRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [itemId, setItemId] = useState("");
  const [itemName, setItemName] = useState("");
  const [category, setCategory] = useState<MovementCategory>("purchase_in");
  const [qty, setQty] = useState("1");
  const [hospitalId, setHospitalId] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  // Warehouse Stock shows the item-level total (nets every movement
  // regardless of which specific batch it's tagged with) as the primary
  // figure — a batch-grouped total would silently miss reductions whenever
  // a sale's batch number doesn't match a batch number recorded on a
  // purchase (e.g. stock brought in before batch tracking started, or via a
  // different import), leaving matching sales invisible instead of counted.
  // Batch/expiry detail is still available per item, expanded on demand.
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [batchDetail, setBatchDetail] = useState<Record<string, StockBalanceByBatchRow[]>>({});
  const [loadingBatchId, setLoadingBatchId] = useState<string | null>(null);

  // Same expand-on-click pattern as Warehouse Stock, one level finer here:
  // keyed by account+item since the same item can be out at multiple
  // hospitals at once.
  const [expandedConsignmentKey, setExpandedConsignmentKey] = useState<string | null>(null);
  const [consignmentBatchDetail, setConsignmentBatchDetail] = useState<Record<string, ConsignmentBalanceByBatchRow[]>>({});
  const [consignmentLocationDetail, setConsignmentLocationDetail] = useState<Record<string, ConsignmentLocationRow[]>>({});
  const [loadingConsignmentKey, setLoadingConsignmentKey] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState<MovementCategory>("purchase_in");
  const [editQty, setEditQty] = useState("1");
  const [editBatchNumber, setEditBatchNumber] = useState("");
  const [editExpiryDate, setEditExpiryDate] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Recent Movements defaults to the latest 30 -- fine for day-to-day
  // review, but useless for cleaning up a batch of dozens/hundreds of rows
  // from a bad import (most of them wouldn't even be visible). Filtering by
  // notes text and/or a time window lifts that cap and switches to
  // checkbox + bulk-delete, so a whole mistaken import can be cleared in a
  // couple of clicks instead of one row at a time.
  const [filterNotes, setFilterNotes] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const hasMovementFilter = filterNotes.trim() !== "" || filterFrom !== "" || filterTo !== "";

  // Both sections default collapsed -- they're the two longest tables on
  // this tab (recent movements can run to hundreds when filtered, warehouse
  // stock lists every non-zero catalog item) and aren't needed on every
  // visit, unlike the Log a movement form above them.
  const [recentMovementsOpen, setRecentMovementsOpen] = useState(false);
  const [warehouseStockOpen, setWarehouseStockOpen] = useState(false);
  // Client-side filter over the already-loaded warehouse list -- with 5,000+
  // catalog variants (every lens power is its own row), a single new
  // purchase can be genuinely hard to spot in an alphabetical list with no
  // way to jump to it.
  const [warehouseFilter, setWarehouseFilter] = useState("");

  const loadMovements = useCallback(async () => {
    let query = supabase
      .from("stock_movements")
      .select(
        "id, category, qty, batch_number, expiry_date, tally_invoice_line_id, billing_request_id, notes, created_at, item_master(name), accounts:hospital_account_id(label), tally_invoice_lines(invoice_no, rate)"
      )
      .order("created_at", { ascending: false });
    if (filterNotes.trim()) query = query.ilike("notes", `%${filterNotes.trim()}%`);
    if (filterFrom) query = query.gte("created_at", new Date(filterFrom).toISOString());
    if (filterTo) query = query.lte("created_at", new Date(filterTo).toISOString());
    const filtered = filterNotes.trim() !== "" || filterFrom !== "" || filterTo !== "";
    query = query.limit(filtered ? 1000 : 30);

    const { data, error } = await query.returns<MovementRow[]>();
    setMovements(data ?? []);
    setSelectedIds(new Set());
    if (error) setLoadError(error.message);
  }, [supabase, filterNotes, filterFrom, filterTo]);

  const loadRest = useCallback(async () => {
    const [
      { data: accountRows, error: accountsErr },
      { data: warehouseRows, error: warehouseErr },
      { data: consignmentRows, error: consignmentErr },
      { data: locationJoinRows, error: locationErr },
    ] = await Promise.all([
      supabase.from("accounts").select("id, label").order("label"),
      // Only items with a non-zero total — this table can have thousands of
      // zero-balance catalog entries otherwise (stock_balance is a LEFT JOIN
      // from item_master, so every catalog item gets a row). Negative
      // balances are shown too, not just positive ones — that's a real
      // "sold more than we've recorded receiving" signal worth seeing, not
      // hiding.
      supabase.from("stock_balance").select("*").neq("balance", 0).order("name"),
      supabase.from("consignment_balance").select("*").order("account_label"),
      // Same location join as the per-item "By location" breakdown, but
      // fetched once up front and regrouped location-first -- "what's on
      // the shelf at this specific branch" rather than "which branches have
      // this item".
      supabase
        .from("stock_movements")
        .select(
          "qty, category, hospital_account_id, item_master(name), accounts:hospital_account_id(label), order_lines(orders(account_locations(name)))"
        )
        .in("category", ["dc_out", "dc_return_in"])
        .not("hospital_account_id", "is", null)
        .returns<LocationStockJoinRow[]>(),
    ]);
    setAccounts(accountRows ?? []);
    setWarehouse(warehouseRows ?? []);
    setConsignment(consignmentRows ?? []);
    setBatchDetail({});
    setExpandedItemId(null);
    setConsignmentBatchDetail({});
    setConsignmentLocationDetail({});
    setExpandedConsignmentKey(null);

    const groups = new Map<string, { accountLabel: string; locationName: string; items: Map<string, LocationStockLine> }>();
    (locationJoinRows ?? []).forEach((r) => {
      const accountLabel = r.accounts?.label ?? "—";
      const locationName = r.order_lines?.orders?.account_locations?.name ?? "Not location-tagged";
      const groupKey = `${r.hospital_account_id}-${locationName}`;
      const group = groups.get(groupKey) ?? { accountLabel, locationName, items: new Map<string, LocationStockLine>() };
      const itemName = r.item_master?.name ?? "—";
      const line = group.items.get(itemName) ?? { itemName, sent: 0, returned: 0, balance: 0 };
      if (r.category === "dc_out") line.sent += r.qty;
      else line.returned += r.qty;
      line.balance = line.sent - line.returned;
      group.items.set(itemName, line);
      groups.set(groupKey, group);
    });
    const builtGroups: LocationGroup[] = Array.from(groups.entries())
      .map(([key, g]) => {
        const lines = Array.from(g.items.values())
          .filter((l) => l.balance !== 0)
          .sort((a, b) => a.itemName.localeCompare(b.itemName));
        return { key, accountLabel: g.accountLabel, locationName: g.locationName, lines, totalBalance: lines.reduce((a, l) => a + l.balance, 0) };
      })
      .filter((g) => g.lines.length > 0)
      .sort((a, b) => a.accountLabel.localeCompare(b.accountLabel) || a.locationName.localeCompare(b.locationName));
    setLocationGroups(builtGroups);

    const firstError = accountsErr || warehouseErr || consignmentErr || locationErr;
    setLoadError(firstError ? firstError.message : null);
  }, [supabase]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadMovements(), loadRest()]);
  }, [loadMovements, loadRest]);

  useEffect(() => {
    void (async () => {
      await loadRest();
    })();
    // Runs once on mount — loadMovements has its own effect below, keyed on
    // the filter inputs, so it isn't included here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void (async () => {
      await loadMovements();
    })();
  }, [loadMovements]);

  async function toggleExpand(itemId: string) {
    if (expandedItemId === itemId) {
      setExpandedItemId(null);
      return;
    }
    setExpandedItemId(itemId);
    if (batchDetail[itemId]) return;
    setLoadingBatchId(itemId);
    const { data } = await supabase
      .from("stock_balance_by_batch")
      .select("*")
      .eq("item_id", itemId)
      .order("expiry_date", { ascending: true, nullsFirst: false })
      .returns<StockBalanceByBatchRow[]>();
    setBatchDetail((prev) => ({ ...prev, [itemId]: data ?? [] }));
    setLoadingBatchId(null);
  }

  async function toggleConsignmentExpand(accountId: string, itemId: string) {
    const key = `${accountId}-${itemId}`;
    if (expandedConsignmentKey === key) {
      setExpandedConsignmentKey(null);
      return;
    }
    setExpandedConsignmentKey(key);
    if (consignmentBatchDetail[key]) return;
    setLoadingConsignmentKey(key);
    const [{ data }, { data: locationRows }] = await Promise.all([
      supabase
        .from("consignment_balance_by_batch")
        .select("*")
        .eq("account_id", accountId)
        .eq("item_id", itemId)
        .order("batch_number")
        .returns<ConsignmentBalanceByBatchRow[]>(),
      // stock_movements has no location column, so the split is reached by
      // joining through order_line_id -> orders.location_id instead (every
      // dc_out/dc_return_in row created via a real order carries it). Rows
      // with no order_line_id (an ad-hoc "Sent to Hospital" logged directly
      // in Inventory, not through an order) fall into "Not location-tagged".
      supabase
        .from("stock_movements")
        .select("qty, category, order_lines(orders(account_locations(name)))")
        .eq("hospital_account_id", accountId)
        .eq("item_id", itemId)
        .in("category", ["dc_out", "dc_return_in"])
        .returns<LocationJoinRow[]>(),
    ]);
    setConsignmentBatchDetail((prev) => ({ ...prev, [key]: data ?? [] }));

    const byLocation = new Map<string, ConsignmentLocationRow>();
    (locationRows ?? []).forEach((r) => {
      const name = r.order_lines?.orders?.account_locations?.name ?? "Not location-tagged";
      const row = byLocation.get(name) ?? { name, sent: 0, returned: 0 };
      if (r.category === "dc_out") row.sent += r.qty;
      else row.returned += r.qty;
      byLocation.set(name, row);
    });
    setConsignmentLocationDetail((prev) => ({
      ...prev,
      [key]: Array.from(byLocation.values()).sort((a, b) => a.name.localeCompare(b.name)),
    }));
    setLoadingConsignmentKey(null);
  }

  async function createItem(name: string) {
    if (!name) return;
    const gtin = `MANUAL-${Date.now().toString(36).toUpperCase()}`;
    const { data, error } = await supabase
      .from("item_master")
      .insert({ name, gtin })
      .select("id")
      .single();
    if (!error && data) {
      setItemId(data.id);
      setItemName(name);
    }
  }

  async function logMovement(e: React.FormEvent) {
    e.preventDefault();
    const qtyNum = parseInt(qty, 10);
    if (!itemId || !qtyNum || qtyNum <= 0) {
      setStatus({ ok: false, text: "Pick an item from the list and a quantity greater than 0." });
      return;
    }
    if (HOSPITAL_CATEGORIES.includes(category) && !hospitalId) {
      setStatus({ ok: false, text: "Pick which hospital this movement is for." });
      return;
    }
    setSaving(true);
    setStatus(null);
    const { error } = await supabase.from("stock_movements").insert({
      item_id: itemId,
      category,
      qty: qtyNum,
      hospital_account_id: HOSPITAL_CATEGORIES.includes(category) ? hospitalId : null,
      batch_number: batchNumber.trim() || null,
      expiry_date: expiryDate || null,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) {
      setStatus({ ok: false, text: error.message });
      return;
    }
    setStatus({ ok: true, text: "Logged." });
    setQty("1");
    setBatchNumber("");
    setExpiryDate("");
    setNotes("");
    setItemId("");
    setItemName("");
    await refreshAll();
  }

  function startEdit(m: MovementRow) {
    setEditingId(m.id);
    setEditCategory(m.category);
    setEditQty(String(m.qty));
    setEditBatchNumber(m.batch_number ?? "");
    setEditExpiryDate(m.expiry_date ?? "");
    setStatus(null);
  }

  async function saveEdit(id: string) {
    const qtyNum = parseInt(editQty, 10);
    if (!qtyNum || qtyNum <= 0) {
      setStatus({ ok: false, text: "Quantity must be greater than 0." });
      return;
    }
    setSavingEdit(true);
    const { error } = await supabase
      .from("stock_movements")
      .update({
        category: editCategory,
        qty: qtyNum,
        batch_number: editBatchNumber.trim() || null,
        expiry_date: editExpiryDate || null,
      })
      .eq("id", id);
    setSavingEdit(false);
    if (error) {
      setStatus({ ok: false, text: error.message });
      return;
    }
    setEditingId(null);
    await refreshAll();
  }

  async function deleteMovement(m: MovementRow) {
    // A movement created from a confirmed Tally sales invoice has to be
    // removed at the source (tally_invoice_lines) -- deleting the
    // stock_movements row alone would leave that invoice line still
    // counting toward Vs Committed's Actual, just with no inventory record
    // to show for it. The FK's on-delete-cascade takes this row down too.
    const fromInvoice = m.tally_invoice_line_id !== null;
    // Same problem, different source: the "sale_out" movement Consignment's
    // Record button creates has no on-delete-cascade of its own (billing
    // status lives on a separate billing_requests row, not something a
    // stock_movements delete can cascade into) -- reverting it back to
    // 'pending' here is what keeps Inventory's balance and Vs
    // Committed/Dashboard's revenue from silently disagreeing after a
    // delete.
    const fromBilling = !fromInvoice && m.billing_request_id !== null;
    if (
      !confirm(
        fromInvoice
          ? `Delete this ${CATEGORY_LABELS[m.category]} movement for ${m.item_master?.name ?? "this item"} (qty ${m.qty}), invoice ${m.tally_invoice_lines?.invoice_no ?? "—"}? This also removes it from Vs Committed's Actual.`
          : fromBilling
            ? `Delete this ${CATEGORY_LABELS[m.category]} movement for ${m.item_master?.name ?? "this item"} (qty ${m.qty})? This reverts its Consignment record back to pending in Usage Log -- Vs Committed's Actual and the Dashboard's Revenue Booked will drop it, and any invoice details already entered for it are cleared.`
            : `Delete this ${CATEGORY_LABELS[m.category]} movement for ${m.item_master?.name ?? "this item"} (qty ${m.qty})? Warehouse stock is computed live from these entries, so this will adjust the balance accordingly.`
      )
    ) {
      return;
    }
    setDeletingId(m.id);
    setStatus(null);
    if (fromBilling) {
      // Revert before deleting the movement -- if something fails partway,
      // a billing_requests row stuck at 'pending' with its movement still
      // present is a harmless, re-recordable state; the movement gone while
      // billing_requests still says 'billed' is exactly the silent
      // inconsistency this exists to prevent.
      const { error: revertError } = await supabase
        .from("billing_requests")
        .update({ status: "pending", requested_at: null, billed_at: null, invoice_number: null, invoice_date: null })
        .eq("id", m.billing_request_id!);
      if (revertError) {
        setDeletingId(null);
        setStatus({ ok: false, text: revertError.message });
        return;
      }
    }
    const { error } = fromInvoice
      ? await supabase.from("tally_invoice_lines").delete().eq("id", m.tally_invoice_line_id!)
      : await supabase.from("stock_movements").delete().eq("id", m.id);
    setDeletingId(null);
    if (error) {
      setStatus({ ok: false, text: error.message });
      return;
    }
    await refreshAll();
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => (prev.size === movements!.length ? new Set() : new Set(movements!.map((m) => m.id))));
  }

  async function bulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    // Same three-way source split as the single-row delete above -- a
    // selection can freely mix plain movements, Tally-invoice-derived ones,
    // and Consignment-billing-derived ones, so each group has to go through
    // its own table (and the billing group has to revert its
    // billing_requests rows first, same reasoning as the single-row path).
    const selected = movements!.filter((m) => ids.includes(m.id));
    const tallyLineIds = Array.from(
      new Set(selected.filter((m) => m.tally_invoice_line_id !== null).map((m) => m.tally_invoice_line_id!))
    );
    const billingSelected = selected.filter((m) => m.tally_invoice_line_id === null && m.billing_request_id !== null);
    const billingRequestIds = Array.from(new Set(billingSelected.map((m) => m.billing_request_id!)));
    const billingMovementIds = billingSelected.map((m) => m.id);
    const plainIds = selected
      .filter((m) => m.tally_invoice_line_id === null && m.billing_request_id === null)
      .map((m) => m.id);
    if (
      !confirm(
        `Delete ${ids.length} selected movement${ids.length === 1 ? "" : "s"}?${
          tallyLineIds.length > 0 ? ` ${tallyLineIds.length} of these came from a confirmed Tally invoice and will also be removed from Vs Committed's Actual.` : ""
        }${
          billingRequestIds.length > 0
            ? ` ${billingRequestIds.length} of these are recorded consignment usage and will revert back to pending in Consignment, dropping out of Vs Committed's Actual and Dashboard's Revenue Booked.`
            : ""
        } Warehouse stock recomputes from what's left, so this will adjust affected balances accordingly. This can't be undone.`
      )
    ) {
      return;
    }
    setBulkDeleting(true);
    setStatus(null);
    if (billingRequestIds.length > 0) {
      const { error: revertError } = await supabase
        .from("billing_requests")
        .update({ status: "pending", requested_at: null, billed_at: null, invoice_number: null, invoice_date: null })
        .in("id", billingRequestIds);
      if (revertError) {
        setBulkDeleting(false);
        setStatus({ ok: false, text: revertError.message });
        return;
      }
    }
    const [{ error: tallyError }, { error: plainError }, { error: billingMoveError }] = await Promise.all([
      tallyLineIds.length > 0
        ? supabase.from("tally_invoice_lines").delete().in("id", tallyLineIds)
        : Promise.resolve({ error: null }),
      plainIds.length > 0 ? supabase.from("stock_movements").delete().in("id", plainIds) : Promise.resolve({ error: null }),
      billingMovementIds.length > 0
        ? supabase.from("stock_movements").delete().in("id", billingMovementIds)
        : Promise.resolve({ error: null }),
    ]);
    setBulkDeleting(false);
    const error = tallyError || plainError || billingMoveError;
    if (error) {
      setStatus({ ok: false, text: error.message });
      return;
    }
    await refreshAll();
  }

  if (accounts === null || warehouse === null || consignment === null || movements === null) {
    return <Loading />;
  }

  return (
    <div className="space-y-4">
      {loadError && (
        <div className="card border-bad-fg bg-[#fdecec] text-[12.5px] font-semibold text-bad-fg">
          Couldn&apos;t load some inventory data: {loadError}
        </div>
      )}

      <div className="card">
        <h3 className="mb-3.5 text-[14.5px] font-extrabold text-ink">Log a movement</h3>
        <form onSubmit={logMovement}>
          <div className="mb-3 flex flex-wrap gap-3">
            <div className="min-w-[220px] flex-1">
              <label className="field-label">Item</label>
              <ItemPicker itemId={itemId} itemName={itemName} onSelect={(id, name) => { setItemId(id); setItemName(name); }} onCreate={createItem} />
            </div>
            <div className="min-w-[160px] flex-1">
              <label className="field-label">Category</label>
              <select
                className="field-input"
                value={category}
                onChange={(e) => setCategory(e.target.value as MovementCategory)}
              >
                {MOVEMENT_CATEGORY_KEYS.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[100px]">
              <label className="field-label">Quantity</label>
              <input
                type="number"
                min={1}
                className="field-input"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
          </div>

          {HOSPITAL_CATEGORIES.includes(category) && (
            <div className="mb-3 max-w-xs">
              <label className="field-label">Hospital</label>
              <select className="field-input" value={hospitalId} onChange={(e) => setHospitalId(e.target.value)}>
                <option value="">Select</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mb-3 flex flex-wrap gap-3">
            <div className="min-w-[160px] flex-1">
              <label className="field-label">Batch number (optional)</label>
              <input className="field-input" value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} />
            </div>
            <div className="min-w-[160px] flex-1">
              <label className="field-label">Expiry date (optional)</label>
              <input
                type="date"
                className="field-input"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            </div>
          </div>

          <div className="mb-3">
            <label className="field-label">Notes (optional)</label>
            <input className="field-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Log movement"}
          </button>
          {status && (
            <span className={`ml-3 text-xs font-semibold ${status.ok ? "text-good-fg" : "text-bad-fg"}`}>
              {status.text}
            </span>
          )}
        </form>
        <MovementImportPanel onImported={refreshAll} />
      </div>

      <div className="card">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setRecentMovementsOpen((o) => !o)}
        >
          <div>
            <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">Recent movements</h3>
            {hasMovementFilter && (
              <p className="text-xs text-muted">Filtered — showing every match, not just the latest 30.</p>
            )}
          </div>
          <span className="ml-3 shrink-0 text-lg text-muted">{recentMovementsOpen ? "−" : "+"}</span>
        </button>
        {recentMovementsOpen && (
        <div className="mt-3.5">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[180px] flex-1">
            <label className="field-label">Notes contains</label>
            <input
              className="field-input !py-1.5 text-[12px]"
              placeholder="e.g. Purchase import"
              value={filterNotes}
              onChange={(e) => setFilterNotes(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">From</label>
            <input
              type="datetime-local"
              className="field-input !py-1.5 text-[12px]"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">To</label>
            <input
              type="datetime-local"
              className="field-input !py-1.5 text-[12px]"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
            />
          </div>
          {hasMovementFilter && (
            <button
              type="button"
              className="rounded-[4px] border border-border bg-card px-3 py-1.5 text-xs font-bold text-ink-soft"
              onClick={() => {
                setFilterNotes("");
                setFilterFrom("");
                setFilterTo("");
              }}
            >
              Clear filter
            </button>
          )}
        </div>

        {hasMovementFilter && movements.length > 0 && (
          <div className="mb-3 flex items-center gap-3 rounded-[4px] border border-border bg-[#eef1f7] px-3 py-2">
            <label className="flex items-center gap-1.5 text-xs font-bold text-ink-soft">
              <input
                type="checkbox"
                checked={selectedIds.size === movements.length}
                onChange={toggleSelectAll}
              />
              Select all {movements.length} matching
            </label>
            {selectedIds.size > 0 && (
              <button
                type="button"
                className="btn-outline-danger !px-3 !py-1.5 text-xs"
                disabled={bulkDeleting}
                onClick={bulkDelete}
              >
                {bulkDeleting ? "Deleting…" : `Delete selected (${selectedIds.size})`}
              </button>
            )}
          </div>
        )}

        {movements.length === 0 ? (
          <Empty
            title={hasMovementFilter ? "No movements match this filter" : "No movements logged yet"}
            body={
              hasMovementFilter
                ? "Try widening the notes text or the date range."
                : "Movements you log above will show up here."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="u-table">
              <thead>
                <tr>
                  {hasMovementFilter && <th></th>}
                  <th>Date</th>
                  <th>Item</th>
                  <th>Category</th>
                  <th>Qty</th>
                  <th>Hospital</th>
                  <th>Batch</th>
                  <th>Expiry</th>
                  <th>Notes</th>
                  <th>Invoice #</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) =>
                  editingId === m.id ? (
                    <tr key={m.id}>
                      {hasMovementFilter && <td></td>}
                      <td className="whitespace-nowrap">{new Date(m.created_at).toLocaleDateString()}</td>
                      <td className="whitespace-nowrap">{m.item_master?.name ?? "—"}</td>
                      <td>
                        <select
                          className="field-input !py-1 text-[12px]"
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value as MovementCategory)}
                        >
                          {MOVEMENT_CATEGORY_KEYS.map((c) => (
                            <option key={c} value={c}>
                              {CATEGORY_LABELS[c]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          min={1}
                          className="field-input w-[70px] !py-1 text-[12px]"
                          value={editQty}
                          onChange={(e) => setEditQty(e.target.value)}
                        />
                      </td>
                      <td className="whitespace-nowrap">{m.accounts?.label ?? "—"}</td>
                      <td>
                        <input
                          className="field-input w-[130px] !py-1 text-[12px]"
                          value={editBatchNumber}
                          onChange={(e) => setEditBatchNumber(e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          className="field-input !py-1 text-[12px]"
                          value={editExpiryDate}
                          onChange={(e) => setEditExpiryDate(e.target.value)}
                        />
                      </td>
                      <td className="max-w-[160px] text-[11.5px] text-muted">{m.notes ?? "—"}</td>
                      <td className="whitespace-nowrap">{m.tally_invoice_lines?.invoice_no ?? "—"}</td>
                      <td className="whitespace-nowrap">
                        <div className="flex gap-1.5">
                          <button
                            className="btn-primary !px-2.5 !py-1 text-[11px]"
                            disabled={savingEdit}
                            onClick={() => saveEdit(m.id)}
                          >
                            {savingEdit ? "Saving…" : "Save"}
                          </button>
                          <button
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
                    <tr key={m.id} className={selectedIds.has(m.id) ? "bg-[#eaf1fd]" : undefined}>
                      {hasMovementFilter && (
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(m.id)}
                            onChange={() => toggleSelected(m.id)}
                          />
                        </td>
                      )}
                      <td className="whitespace-nowrap">{new Date(m.created_at).toLocaleDateString()}</td>
                      <td className="whitespace-nowrap">
                        {m.item_master?.name ?? "—"}
                        {m.tally_invoice_line_id && (
                          <span
                            className="badge badge-neutral ml-1.5"
                            title={`Created from confirmed Tally invoice ${m.tally_invoice_lines?.invoice_no ?? ""} — deleting here also removes it from Vs Committed's Actual`}
                          >
                            from invoice
                          </span>
                        )}
                        {!m.tally_invoice_line_id && m.billing_request_id && (
                          <span
                            className="badge badge-neutral ml-1.5"
                            title="Created by Consignment's Record button — edit qty/category there via delete + re-record, not here, so it can't drift out of sync with the billing record"
                          >
                            from consignment
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap">{CATEGORY_LABELS[m.category]}</td>
                      <td>{m.qty}</td>
                      <td className="whitespace-nowrap">{m.accounts?.label ?? "—"}</td>
                      <td className="whitespace-nowrap">{m.batch_number ?? "—"}</td>
                      <td className="whitespace-nowrap">
                        {m.expiry_date ? new Date(m.expiry_date).toLocaleDateString() : "—"}
                      </td>
                      <td className="max-w-[160px] text-[11.5px] text-muted">{m.notes ?? "—"}</td>
                      <td className="whitespace-nowrap">{m.tally_invoice_lines?.invoice_no ?? "—"}</td>
                      <td className="whitespace-nowrap">
                        <div className="flex gap-1.5">
                          {!m.billing_request_id && (
                            <button
                              className="rounded-[4px] border border-border bg-card px-2.5 py-1 text-[11px] font-bold text-ink-soft"
                              disabled={deletingId === m.id}
                              onClick={() => startEdit(m)}
                            >
                              Edit
                            </button>
                          )}
                          <button
                            className="btn-outline-danger !px-2.5 !py-1 text-[11px]"
                            disabled={deletingId === m.id}
                            onClick={() => deleteMovement(m)}
                          >
                            {deletingId === m.id ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
        </div>
        )}
      </div>

      <div className="card">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="flex flex-1 items-center justify-between text-left"
            onClick={() => setWarehouseStockOpen((o) => !o)}
          >
            <div>
              <h3 className="text-[14.5px] font-extrabold text-ink">Warehouse stock</h3>
            </div>
            <span className="ml-3 shrink-0 text-lg text-muted">{warehouseStockOpen ? "−" : "+"}</span>
          </button>
          <ExportButton
            filename="warehouse-stock"
            columns={[
              { key: "name", label: "Item" },
              { key: "purchase_in", label: "Purchase In" },
              { key: "dc_out", label: "DC Out" },
              { key: "sale_out", label: "Sale Out" },
              { key: "material_out", label: "Material Out" },
              { key: "dc_return_in", label: "DC Return In" },
              { key: "material_in", label: "Material In" },
              { key: "balance", label: "Balance" },
            ]}
            rows={warehouse}
          />
        </div>
        {warehouseStockOpen && (
        <div className="mt-3.5">
        {warehouse.length === 0 ? (
          <Empty title="No items in stock" body="Log a Purchase In movement to start tracking stock." />
        ) : (
          <>
          <div className="mb-3 max-w-xs">
            <label className="field-label">Filter by item name</label>
            <input
              className="field-input !py-1.5 text-[12px]"
              placeholder="e.g. CT LUCIA"
              value={warehouseFilter}
              onChange={(e) => setWarehouseFilter(e.target.value)}
            />
          </div>
          {(() => {
            const filtered = warehouseFilter.trim()
              ? warehouse.filter((w) => w.name.toLowerCase().includes(warehouseFilter.trim().toLowerCase()))
              : warehouse;
            if (filtered.length === 0) {
              return <Empty title="No items match this filter" body="Try a shorter or different search term." />;
            }
            return (
          <div className="overflow-x-auto">
            <table className="u-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Purchase In</th>
                  <th>DC Out</th>
                  <th>Sale Out</th>
                  <th>Material Out</th>
                  <th>DC Return In</th>
                  <th>Material In</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((w) => {
                  const isOpen = expandedItemId === w.item_id;
                  return (
                    <Fragment key={w.item_id}>
                      <tr className="cursor-pointer hover:bg-cream" onClick={() => toggleExpand(w.item_id)}>
                        <td className="whitespace-nowrap">
                          <span className="mr-1.5 text-muted">{isOpen ? "−" : "+"}</span>
                          {w.name}
                        </td>
                        <td>{w.purchase_in}</td>
                        <td>{w.dc_out}</td>
                        <td>{w.sale_out}</td>
                        <td>{w.material_out}</td>
                        <td>{w.dc_return_in}</td>
                        <td>{w.material_in}</td>
                        <td className={`font-bold ${w.balance < 0 ? "text-bad-fg" : ""}`}>{w.balance}</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={8} className="!p-0">
                            <div className="bg-[#f7f9fd] px-4 py-3">
                              {loadingBatchId === w.item_id ? (
                                <Loading />
                              ) : (batchDetail[w.item_id]?.length ?? 0) === 0 ? (
                                <p className="text-xs text-muted">No batch-tagged movements for this item.</p>
                              ) : (
                                <table className="u-table">
                                  <thead>
                                    <tr>
                                      <th>Batch</th>
                                      <th>Expiry</th>
                                      <th>Purchase In</th>
                                      <th>DC Out</th>
                                      <th>Sale Out</th>
                                      <th>Material Out</th>
                                      <th>DC Return In</th>
                                      <th>Material In</th>
                                      <th>Balance</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {batchDetail[w.item_id]!.map((b) => (
                                      <tr key={`${b.batch_number ?? "none"}-${b.expiry_date ?? "none"}`}>
                                        <td className="whitespace-nowrap">{b.batch_number ?? "—"}</td>
                                        <td className="whitespace-nowrap">
                                          {b.expiry_date ? new Date(b.expiry_date).toLocaleDateString() : "—"}
                                        </td>
                                        <td>{b.purchase_in}</td>
                                        <td>{b.dc_out}</td>
                                        <td>{b.sale_out}</td>
                                        <td>{b.material_out}</td>
                                        <td>{b.dc_return_in}</td>
                                        <td>{b.material_in}</td>
                                        <td className={`font-bold ${b.balance < 0 ? "text-bad-fg" : ""}`}>
                                          {b.balance}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
            );
          })()}
          </>
        )}
        </div>
        )}
      </div>

      <div className="card">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setLocationStockOpen((o) => !o)}
        >
          <div>
            <h3 className="text-[14.5px] font-extrabold text-ink">Consignment stock by location</h3>
          </div>
          <span className="ml-3 shrink-0 text-lg text-muted">{locationStockOpen ? "−" : "+"}</span>
        </button>
        {locationStockOpen && (
          <div className="mt-3.5">
            {locationGroups === null ? (
              <Loading />
            ) : locationGroups.length === 0 ? (
              <Empty title="Nothing on consignment yet" body="DC an order to a hospital location to start tracking it here." />
            ) : (
              <div className="space-y-2">
                {locationGroups.map((g) => {
                  const isOpen = openLocationKey === g.key;
                  return (
                    <div key={g.key} className="rounded-[6px] border border-border">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
                        onClick={() => setOpenLocationKey(isOpen ? null : g.key)}
                      >
                        <span className="text-[12.5px] font-bold text-ink">
                          {g.accountLabel}
                          {g.locationName !== "Not location-tagged" && (
                            <span className="font-normal text-muted"> — {g.locationName}</span>
                          )}
                        </span>
                        <span className="flex items-center gap-2 text-[11.5px] text-muted">
                          {g.lines.length} item{g.lines.length === 1 ? "" : "s"} · {g.totalBalance} unit{g.totalBalance === 1 ? "" : "s"}
                          <span className="text-lg leading-none">{isOpen ? "−" : "+"}</span>
                        </span>
                      </button>
                      {isOpen && (
                        <div className="overflow-x-auto border-t border-border">
                          <table className="u-table">
                            <thead>
                              <tr>
                                <th>Item</th>
                                <th>Sent</th>
                                <th>Returned</th>
                                <th>On hand</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.lines.map((l) => (
                                <tr key={l.itemName}>
                                  <td className="whitespace-nowrap">{l.itemName}</td>
                                  <td>{l.sent}</td>
                                  <td>{l.returned}</td>
                                  <td className={`font-bold ${l.balance < 0 ? "text-bad-fg" : ""}`}>{l.balance}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <div className="mb-3.5 flex items-center justify-between gap-2">
          <h3 className="text-[14.5px] font-extrabold text-ink">Consignment by hospital</h3>
          <ExportButton
            filename="consignment-by-hospital"
            columns={[
              { key: "account_label", label: "Hospital" },
              { key: "item_name", label: "Item" },
              { key: "sent", label: "Sent" },
              { key: "returned", label: "Returned" },
              { key: "consumed", label: "Consumed" },
              { key: "balance", label: "Balance" },
            ]}
            rows={consignment}
          />
        </div>
        {consignment.length === 0 ? (
          <Empty title="Nothing out on consignment" body="Log a 'Sent to Hospital' movement to start tracking it." />
        ) : (
          <div className="overflow-x-auto">
            <table className="u-table">
              <thead>
                <tr>
                  <th>Hospital</th>
                  <th>Item</th>
                  <th>Sent</th>
                  <th>Returned</th>
                  <th>Consumed</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {consignment.map((c) => {
                  const key = `${c.account_id}-${c.item_id}`;
                  const isOpen = expandedConsignmentKey === key;
                  return (
                    <Fragment key={key}>
                      <tr className="cursor-pointer hover:bg-cream" onClick={() => toggleConsignmentExpand(c.account_id, c.item_id)}>
                        <td className="whitespace-nowrap">{c.account_label}</td>
                        <td className="whitespace-nowrap">
                          <span className="mr-1.5 text-muted">{isOpen ? "−" : "+"}</span>
                          {c.item_name}
                        </td>
                        <td>{c.sent}</td>
                        <td>{c.returned}</td>
                        <td>{c.consumed}</td>
                        <td className="font-bold">{c.balance}</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={6} className="!p-0">
                            <div className="bg-[#f7f9fd] px-4 py-3">
                              {loadingConsignmentKey === key ? (
                                <Loading />
                              ) : (
                                <>
                                  {(consignmentLocationDetail[key]?.length ?? 0) > 1 && (
                                    <div className="mb-3">
                                      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">By location</p>
                                      <table className="u-table">
                                        <thead>
                                          <tr>
                                            <th>Location</th>
                                            <th>Sent</th>
                                            <th>Returned</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {consignmentLocationDetail[key]!.map((l) => (
                                            <tr key={l.name}>
                                              <td className="whitespace-nowrap">{l.name}</td>
                                              <td>{l.sent}</td>
                                              <td>{l.returned}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                  {(consignmentBatchDetail[key]?.length ?? 0) === 0 ? (
                                    <p className="text-xs text-muted">No batch-tagged movements for this item at this hospital.</p>
                                  ) : (
                                    <table className="u-table">
                                      <thead>
                                        <tr>
                                          <th>Batch</th>
                                          <th>Sent</th>
                                          <th>Returned</th>
                                          <th>Consumed</th>
                                          <th>Balance</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {consignmentBatchDetail[key]!.map((b) => (
                                          <tr key={b.batch_number}>
                                            <td className="whitespace-nowrap">{b.batch_number}</td>
                                            <td>{b.sent}</td>
                                            <td>{b.returned}</td>
                                            <td>{b.consumed}</td>
                                            <td className={`font-bold ${b.balance < 0 ? "text-bad-fg" : ""}`}>{b.balance}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                </>
                              )}
                            </div>
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
    </div>
  );
}
