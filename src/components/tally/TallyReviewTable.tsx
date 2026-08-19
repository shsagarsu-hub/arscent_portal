"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { AppShell, Empty } from "@/components/AppShell";
import { BuildingIcon, DashboardIcon, UploadIcon } from "@/components/icons";
import { matchAccount, matchCatalogItem, matchSku, stripPowerSpecs } from "@/lib/tally/matching";
import { PurchaseImportPanel } from "./PurchaseImportPanel";
import { ImportedInvoicesList } from "./ImportedInvoicesList";

interface AccountRow {
  id: string;
  label: string;
}
interface SkuRow {
  id: string;
  name: string;
  account_id: string;
}
interface ItemSuggestion {
  id: string;
  name: string;
}

interface ParsedBatch {
  batchNumber: string;
  expiryDate: string | null;
  qty: number;
}

type TallyDocumentType = "invoice" | "credit_note" | "debit_note";

interface ReviewLine {
  key: string;
  invoiceNo: string;
  date: string;
  descriptionRaw: string;
  qty: number;
  rate: number;
  batches: ParsedBatch[];
  accountId: string;
  accountConfidence: "high" | "low" | "none";
  skuId: string;
  skuLabel: string;
  // "sku" = matched to a committed, monthly-tracked product (counts toward
  // Vs Committed). "item" = matched to the wider Zeiss catalog only — real,
  // just not something with a monthly target.
  skuSource: "sku" | "item" | "";
  skuConfidence: "high" | "low" | "none";
  crossAccount: boolean;
  documentType: TallyDocumentType;
  // Only set for credit_note/debit_note -- which invoice it adjusts. A
  // credit/debit note is a ledger-level amount, not a specific product, so
  // unlike an invoice line it doesn't need a product match to be importable
  // (see `importable` in handleConfirm) — the account is enough.
  relatedInvoiceNo: string | null;
}

const DOCUMENT_TYPE_LABELS: Record<TallyDocumentType, string> = {
  invoice: "Invoice",
  credit_note: "Credit Note",
  debit_note: "Debit Note",
};

function ConfidenceBadge({ level }: { level: "high" | "low" | "none" }) {
  if (level === "high") return <span className="badge badge-good">matched</span>;
  if (level === "low") return <span className="badge badge-watch">check</span>;
  return <span className="badge badge-bad">no match</span>;
}

/** Searches the committed-SKU list (client-side, it's small) and the full
 * item_master catalog (server-side ilike, it's thousands of rows) together,
 * so any invoice line can be tagged — not just ones for a product that
 * happens to have a monthly commitment target. Not gated on the account
 * being matched first: account-matching and product-matching are separate
 * judgment calls a reviewer should be able to make independently. */
function SkuPicker({
  skuId,
  skuLabel,
  accountId,
  skus,
  accounts,
  onSelect,
}: {
  skuId: string;
  skuLabel: string;
  accountId: string;
  skus: SkuRow[];
  accounts: AccountRow[];
  onSelect: (id: string, label: string, source: "sku" | "item" | "") => void;
}) {
  const supabase = createClient();
  const [query, setQuery] = useState(skuLabel);
  const [catalogMatches, setCatalogMatches] = useState<ItemSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [prevSkuLabel, setPrevSkuLabel] = useState(skuLabel);
  if (skuLabel !== prevSkuLabel) {
    setPrevSkuLabel(skuLabel);
    setQuery(skuLabel);
  }

  const accountLabel = (id: string) => accounts.find((a) => a.id === id)?.label ?? "";

  const committedMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q.length < 1 ? skus : skus.filter((s) => s.name.toLowerCase().includes(q));
    // Matched account's own products first.
    return [...pool].sort((a, b) => {
      const aOwn = a.account_id === accountId ? 0 : 1;
      const bOwn = b.account_id === accountId ? 0 : 1;
      return aOwn - bOwn || a.name.localeCompare(b.name);
    });
  }, [skus, query, accountId]);

  // The dropdown is portaled to <body> (see below) so it isn't clipped by
  // the table's overflow-x-auto wrapper — which also clips overflow-y,
  // hiding an absolutely-positioned dropdown that lives inside it. Portaling
  // means position: fixed + coordinates read off the input, computed fresh
  // each time it opens.
  function openDropdown() {
    const rect = inputRef.current?.getBoundingClientRect();
    if (rect) setCoords({ top: rect.bottom, left: rect.left, width: Math.max(rect.width, 280) });
    setOpen(true);
  }

  function handleChange(value: string) {
    setQuery(value);
    onSelect("", value, "");
    openDropdown();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setCatalogMatches([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from("item_master")
        .select("id, name")
        .ilike("name", `%${value.trim()}%`)
        .order("name")
        .limit(15);
      setCatalogMatches(data ?? []);
    }, 250);
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        className="field-input min-w-[180px] !py-1.5 text-[12px]"
        placeholder="Search products…"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={openDropdown}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open &&
        coords &&
        createPortal(
          <div
            className="fixed z-50 max-h-72 overflow-y-auto rounded-[4px] border border-border bg-card shadow-[0_4px_12px_rgba(23,37,68,0.12)]"
            style={{ top: coords.top, left: coords.left, width: coords.width }}
          >
            {committedMatches.length > 0 && (
            <div>
              <div className="bg-[#eef1f7] px-3 py-1 text-[9.5px] font-bold uppercase tracking-wide text-muted">
                Committed SKUs
              </div>
              {committedMatches.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`block w-full px-3 py-1.5 text-left text-[12px] hover:bg-cream ${
                    s.id === skuId ? "bg-[#eaf1fd] font-semibold text-brand" : "text-ink"
                  }`}
                  onMouseDown={() => {
                    onSelect(s.id, s.name, "sku");
                    setQuery(s.name);
                    setOpen(false);
                  }}
                >
                  {s.name}
                  {s.account_id !== accountId && (
                    <span className="ml-1.5 text-[10px] text-muted">({accountLabel(s.account_id)})</span>
                  )}
                </button>
              ))}
            </div>
          )}
          {catalogMatches.length > 0 && (
            <div>
              <div className="bg-[#eef1f7] px-3 py-1 text-[9.5px] font-bold uppercase tracking-wide text-muted">
                Catalog items (not committed)
              </div>
              {catalogMatches.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`block w-full px-3 py-1.5 text-left text-[12px] hover:bg-cream ${
                    s.id === skuId ? "bg-[#eaf1fd] font-semibold text-brand" : "text-ink"
                  }`}
                  onMouseDown={() => {
                    onSelect(s.id, s.name, "item");
                    setQuery(s.name);
                    setOpen(false);
                  }}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
          {committedMatches.length === 0 && catalogMatches.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-muted">No match.</div>
          )}
          </div>,
          document.body
        )}
    </div>
  );
}

interface RawLine {
  invoiceNo: string;
  date: string;
  buyerRaw: string;
  descriptionRaw: string;
  qty: number;
  rate: number;
  batches?: ParsedBatch[];
  documentType: TallyDocumentType;
  relatedInvoiceNo: string | null;
}

let batchCounter = 0;

export function TallyReviewTable({ accounts, skus }: { accounts: AccountRow[]; skus: SkuRow[] }) {
  const supabase = createClient();

  const [lines, setLines] = useState<ReviewLine[]>([]);
  const [confirmed, setConfirmed] = useState<{ count: number; total: number; movementCount: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importWarning, setImportWarning] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Bumped on every successful import so <ImportedInvoicesList key={...}>
  // remounts and re-fetches, instead of the just-confirmed invoice not
  // showing up in the "already imported" list until the page is reloaded.
  const [importedRefreshKey, setImportedRefreshKey] = useState(0);

  function updateLine(key: string, patch: Partial<ReviewLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function buildReviewLines(raw: RawLine[]): ReviewLine[] {
    const batch = batchCounter++;
    return raw.map((l, idx) => {
      const acctMatch = matchAccount(l.buyerRaw, accounts);
      const skuMatch = matchSku(l.descriptionRaw, acctMatch.accountId, skus);
      return {
        key: `${batch}-${l.invoiceNo}-${idx}`,
        invoiceNo: l.invoiceNo,
        date: l.date,
        descriptionRaw: l.descriptionRaw,
        qty: l.qty,
        rate: l.rate,
        batches: l.batches ?? [],
        accountId: acctMatch.accountId ?? "",
        accountConfidence: acctMatch.confidence,
        skuId: skuMatch.skuId ?? "",
        skuLabel: skuMatch.name ?? "",
        skuSource: skuMatch.skuId ? "sku" : "",
        skuConfidence: skuMatch.confidence,
        crossAccount: skuMatch.crossAccount,
        documentType: l.documentType,
        relatedInvoiceNo: l.relatedInvoiceNo,
      };
    });
  }

  // Tries to resolve every line straight to a full-catalog item_master
  // description (not just the short committed-SKU family name) — the
  // catalog now has every real product, so that's what "Product" should show
  // by default. Falls back to the initial committed-SKU guess for any line
  // the catalog search can't confidently place. Runs after the batch is
  // already showing (via built-in guesses), enriching it in place.
  async function enrichWithCatalogMatches(built: ReviewLine[]) {
    const client = createClient();
    // A credit/debit note's "description" is a Tally ledger name ("GST
    // Sales-22"), not a product — searching the catalog for it would only
    // return noise, and it isn't required for the line to be importable
    // anyway (see `importable` in handleConfirm).
    const invoiceOnly = built.filter((l) => l.documentType === "invoice");
    const results = await Promise.all(
      invoiceOnly.map(async (l) => {
        // Try the exact raw description first — some product families have
        // 1,000+ power/cylinder variants in the catalog, so a broad search
        // on just the stripped family name (e.g. "ZEISS AT TORBI 719M")
        // returns far more than the row limit and can push the real match
        // past the cutoff entirely, silently landing on a same-family but
        // wrong-power variant instead (confirmed: "SE+18.00" matched to a
        // catalog row for "SE+10.00" this way). An exact-text search finds
        // the real row directly when the catalog has it verbatim, which it
        // usually does — only fall back to the broad family search, and its
        // looser scoring, when nothing comes back.
        const exact = await client
          .from("item_master")
          .select("id, name")
          .ilike("name", `%${l.descriptionRaw.trim()}%`)
          .limit(5);
        let candidates = exact.data ?? [];
        if (candidates.length === 0) {
          const base = stripPowerSpecs(l.descriptionRaw).trim();
          const term = base.length >= 3 ? base : l.descriptionRaw;
          const broad = await client.from("item_master").select("id, name").ilike("name", `%${term}%`).limit(30);
          candidates = broad.data ?? [];
        }
        return { key: l.key, match: matchCatalogItem(l.descriptionRaw, candidates) };
      })
    );
    setLines((prev) =>
      prev.map((l) => {
        const r = results.find((x) => x.key === l.key);
        if (!r?.match.itemId) return l;
        return {
          ...l,
          skuId: r.match.itemId,
          skuLabel: r.match.name ?? "",
          skuSource: "item",
          skuConfidence: r.match.confidence,
        };
      })
    );
  }

  async function loadBatch(raw: RawLine[]) {
    const built = buildReviewLines(raw);
    setLines(built);
    setConfirmed(null);
    setImportError(null);
    await enrichWithCatalogMatches(built);
  }

  async function handleParse() {
    if (!uploadFile) return;
    setUploading(true);
    setUploadError(null);
    setUploadWarnings([]);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      const res = await fetch("/api/tally/parse", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) {
        setUploadError(body.error ?? "Failed to parse the PDF.");
        return;
      }
      setUploadWarnings(body.warnings ?? []);
      await loadBatch(body.lines as RawLine[]);
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Failed to parse the PDF.");
    } finally {
      setUploading(false);
    }
  }

  const stats = {
    total: lines.length,
    needsReview: lines.filter(
      (l) => l.accountConfidence !== "high" || (l.documentType === "invoice" && l.skuConfidence !== "high")
    ).length,
    unresolved: lines.filter((l) => !l.accountId || (l.documentType === "invoice" && !l.skuId)).length,
  };

  async function handleConfirm() {
    setImporting(true);
    setImportError(null);
    setImportWarning(null);
    setConfirmed(null);

    // A credit/debit note is a ledger-level amount, not a product -- it
    // doesn't need (and usually won't get) a product match to be
    // importable, unlike an invoice line. Only the account is required.
    const importable = lines.filter((l) => l.accountId && (l.documentType !== "invoice" || l.skuId));
    if (importable.length === 0) {
      setImporting(false);
      setConfirmed({ count: 0, total: lines.length, movementCount: 0 });
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const rows = importable.map((l) => {
      // If matched straight to a committed SKU, that's the rollup. If
      // matched to a catalog item instead, resolve which committed family it
      // belongs to (e.g. "ZEISS CT LUCIA 621P TIP2.2 DPT 19.5" -> "CT
      // LUCIA") from the item's clean name — same matcher used for the
      // initial auto-match, just fed a canonical name instead of noisy raw
      // invoice text, so it's far more reliable here.
      const itemId = l.skuSource === "item" ? l.skuId : null;
      const committedSkuId = l.skuSource === "sku" ? l.skuId : l.skuLabel ? matchSku(l.skuLabel, l.accountId, skus).skuId : null;
      const firstBatch = l.batches[0];
      return {
        invoice_no: l.invoiceNo,
        invoice_date: l.date,
        account_id: l.accountId,
        item_id: itemId,
        sku_id: committedSkuId,
        description_raw: l.descriptionRaw,
        qty: l.qty,
        rate: l.rate,
        batch_number: firstBatch?.batchNumber ?? null,
        expiry_date: firstBatch?.expiryDate ?? null,
        imported_by: user?.id ?? null,
        document_type: l.documentType,
        related_invoice_no: l.relatedInvoiceNo,
      };
    });

    // Re-confirming replaces this invoice's lines rather than duplicating
    // them, so clicking Confirm & Import twice on the same data is safe. The
    // stock_movements this creates below cascade-delete along with their
    // tally_invoice_lines row, so the old inventory movements go with them.
    const invoiceNos = Array.from(new Set(rows.map((r) => r.invoice_no)));
    const { error: deleteError } = await supabase.from("tally_invoice_lines").delete().in("invoice_no", invoiceNos);
    if (deleteError) {
      setImporting(false);
      setImportError(deleteError.message);
      return;
    }

    // .select() returns rows in the same order as inserted, so index-matching
    // back to `importable` (which `rows` was built from, same order) is safe.
    const { data: insertedRows, error: insertError } = await supabase
      .from("tally_invoice_lines")
      .insert(rows)
      .select("id, item_id");
    if (insertError) {
      setImporting(false);
      setImportError(insertError.message);
      return;
    }

    // Every invoice line that resolved to a specific catalog item also
    // becomes a "sale_out" inventory movement — Arscent invoiced the
    // hospital, so it leaves warehouse stock. Lines matched only to a
    // committed SKU (no specific catalog item) can't be attributed to one
    // exact product, so they don't get a movement. Each batch line keeps
    // its own qty (one movement per unit for lens items with per-unit
    // batches, one movement for the whole line where the source only gave
    // one batch for it all).
    //
    // Credit/debit note lines NEVER get a movement, even if a manager tags
    // one with a catalog item for reporting — confirmed against a real
    // credit note: it was a pure price/revenue adjustment, no goods moved.
    // A future note that DOES represent an actual return would need its own
    // explicit handling, not this same-shape movement.
    const movementRows = (insertedRows ?? []).flatMap((inserted, i) => {
      const line = importable[i];
      if (line.documentType !== "invoice") return [];
      if (!inserted.item_id) return [];
      const batches = line.batches.length > 0 ? line.batches : [{ batchNumber: null, expiryDate: null, qty: line.qty }];
      return batches.map((b) => ({
        item_id: inserted.item_id!,
        category: "sale_out" as const,
        qty: b.qty,
        batch_number: b.batchNumber,
        expiry_date: b.expiryDate,
        tally_invoice_line_id: inserted.id,
        notes: `Tally invoice ${line.invoiceNo}`,
      }));
    });

    let movementCount = 0;
    if (movementRows.length > 0) {
      const { error: movementError } = await supabase.from("stock_movements").insert(movementRows);
      if (movementError) {
        setImportWarning(`Lines imported, but logging inventory movements failed: ${movementError.message}`);
      } else {
        movementCount = movementRows.length;
      }
    }

    setImporting(false);
    setConfirmed({ count: rows.length, total: lines.length, movementCount });
    setImportedRefreshKey((k) => k + 1);
    // Clear the preview — it's served its purpose, and leaving it sitting
    // there reads as "still needs action" when the next thing to do is
    // upload the next invoice PDF.
    setLines([]);
  }

  return (
    <AppShell
      ctx="Account Manager"
      stats={[]}
      maxWidthClass="max-w-[1000px]"
      extraNav={[
        { href: "/manager", label: "Dashboard", icon: <DashboardIcon /> },
        { href: "/accounts", label: "Accounts", icon: <BuildingIcon /> },
      ]}
      tabs={[
        {
          id: "import",
          label: "Import",
          icon: <UploadIcon />,
          content: (
            <>
      <h1 className="mb-6 text-xl font-extrabold text-ink">Import</h1>

      <h2 className="mb-3 text-[15px] font-extrabold text-ink">Sales invoices, credit &amp; debit notes (Tally PDF)</h2>

      <ImportedInvoicesList key={importedRefreshKey} />

      <div className="card mb-4">
        <h3 className="mb-2 text-[13px] font-extrabold text-ink">Upload Tally PDF</h3>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="field-input max-w-xs"
            disabled={uploading}
            onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
          />
          <button className="btn-primary shrink-0" disabled={!uploadFile || uploading} onClick={handleParse}>
            {uploading ? "Parsing…" : "Parse"}
          </button>
        </div>
        {uploadError && <p className="mt-2 text-xs font-semibold text-bad-fg">{uploadError}</p>}
        {uploadWarnings.length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs font-semibold text-watch-fg">
            {uploadWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        <div className="card text-center">
          <div className="text-[19px] font-extrabold text-ink">{stats.total}</div>
          <div className="text-[9.5px] font-bold uppercase tracking-wide text-muted">Line Items</div>
        </div>
        <div className="card text-center">
          <div className="text-[19px] font-extrabold text-watch-fg">{stats.needsReview}</div>
          <div className="text-[9.5px] font-bold uppercase tracking-wide text-muted">Need Review</div>
        </div>
        <div className="card text-center">
          <div className="text-[19px] font-extrabold text-bad-fg">{stats.unresolved}</div>
          <div className="text-[9.5px] font-bold uppercase tracking-wide text-muted">Unresolved</div>
        </div>
      </div>

      <div className="card">
        {lines.length === 0 ? (
          <Empty title="Nothing to review" body="Upload a Tally invoice PDF above to load its lines here." />
        ) : (
        <div className="overflow-x-auto">
          <table className="u-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Invoice</th>
                <th>Date</th>
                <th>Description (raw)</th>
                <th>Qty</th>
                <th>Amount (ex GST)</th>
                <th>Batch</th>
                <th>Expiry</th>
                <th>Account</th>
                <th>Product</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                  <td className="whitespace-nowrap">
                    {l.documentType === "invoice" ? (
                      <span className="badge badge-neutral">Invoice</span>
                    ) : (
                      <span className={l.documentType === "credit_note" ? "badge badge-bad" : "badge badge-watch"}>
                        {DOCUMENT_TYPE_LABELS[l.documentType]}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    {l.invoiceNo}
                    {l.relatedInvoiceNo && (
                      <div className="text-[10px] font-normal text-muted">adj. {l.relatedInvoiceNo}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap">{l.date}</td>
                  <td className="max-w-[220px] text-[11.5px] text-muted">{l.descriptionRaw}</td>
                  <td>{l.qty}</td>
                  <td className={`whitespace-nowrap ${l.rate < 0 ? "text-bad-fg" : ""}`}>
                    {l.rate < 0 ? "−" : ""}₹{Math.abs(l.rate).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  </td>
                  <td className="whitespace-nowrap">
                    {l.batches.length === 0
                      ? "—"
                      : l.batches.length === 1
                        ? l.batches[0].batchNumber
                        : (
                            <span title={l.batches.map((b) => `${b.batchNumber} (${b.qty})`).join(", ")}>
                              {l.batches.length} batches
                            </span>
                          )}
                  </td>
                  <td className="whitespace-nowrap">
                    {l.batches.length === 1 && l.batches[0].expiryDate
                      ? new Date(l.batches[0].expiryDate).toLocaleDateString()
                      : "—"}
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <select
                        className="field-input min-w-[140px] !py-1.5 text-[12px]"
                        value={l.accountId}
                        onChange={(e) => updateLine(l.key, { accountId: e.target.value, accountConfidence: "high" })}
                      >
                        <option value="">Select</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                      <ConfidenceBadge level={l.accountConfidence} />
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <SkuPicker
                        skuId={l.skuId}
                        skuLabel={l.skuLabel}
                        accountId={l.accountId}
                        skus={skus}
                        accounts={accounts}
                        onSelect={(id, label, source) =>
                          updateLine(l.key, {
                            skuId: id,
                            skuLabel: label,
                            skuSource: source,
                            skuConfidence: id ? "high" : "none",
                          })
                        }
                      />
                      {l.documentType === "invoice" || l.skuId ? (
                        <ConfidenceBadge level={l.skuId ? l.skuConfidence : "none"} />
                      ) : (
                        <span className="badge badge-neutral" title="Not a product line -- tagging one is optional, only for reporting rollup">
                          optional
                        </span>
                      )}
                      {l.skuSource === "item" && (
                        <span className="badge badge-neutral" title="Real product, but not tracked against a monthly commitment">
                          catalog-only
                        </span>
                      )}
                      {l.crossAccount && (
                        <span className="badge badge-neutral" title="Best text match was on a different account's catalog">
                          cross-acct
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button className="btn-primary" onClick={handleConfirm} disabled={importing || lines.length === 0}>
          {importing ? "Importing…" : "Confirm & Import"}
        </button>
        {confirmed && (
          <span className="text-xs font-semibold text-good-fg">
            Imported {confirmed.count} of {confirmed.total} lines
            {confirmed.movementCount > 0 && ` — logged ${confirmed.movementCount} inventory movement${confirmed.movementCount === 1 ? "" : "s"}`}
            .
          </span>
        )}
        {importWarning && <span className="text-xs font-semibold text-watch-fg">{importWarning}</span>}
        {importError && <span className="text-xs font-semibold text-bad-fg">Import failed: {importError}</span>}
      </div>

      <h2 className="mt-8 mb-3 text-[15px] font-extrabold text-ink">Purchases (Excel)</h2>
      <PurchaseImportPanel />
            </>
          ),
        },
      ]}
    />
  );
}
