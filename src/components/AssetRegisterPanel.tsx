"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { Empty, Loading } from "./AppShell";
import { ExportButton } from "./ExportButton";
import type { Asset, AssetCategory } from "@/lib/supabase/database.types";

interface AccountRow {
  id: string;
  label: string;
}
interface LocationRow {
  id: string;
  account_id: string;
  name: string;
}
type AssetRow = Asset & {
  accounts: { label: string } | null;
  account_locations: { name: string } | null;
};

const CATEGORY_LABELS: Record<AssetCategory, string> = {
  capital_equipment: "Capital equipment",
  benefit_equipment: "Benefit equipment",
  cmc_support: "CMC / support",
  other: "Other",
};

function inr(n: number | null) {
  if (n === null) return "—";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function AddAssetForm({
  accounts,
  locations,
  onAdded,
}: {
  accounts: AccountRow[];
  locations: LocationRow[];
  onAdded: () => void;
}) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [assetName, setAssetName] = useState("");
  const [category, setCategory] = useState<AssetCategory>("capital_equipment");
  const [agreementRef, setAgreementRef] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [equipmentValue, setEquipmentValue] = useState("");
  const [invoiceValue, setInvoiceValue] = useState("");
  const [notes, setNotes] = useState("");

  const accountLocations = locations.filter((l) => l.account_id === accountId);

  function reset() {
    setAccountId("");
    setLocationId("");
    setAssetName("");
    setCategory("capital_equipment");
    setAgreementRef("");
    setSerialNumber("");
    setEquipmentValue("");
    setInvoiceValue("");
    setNotes("");
  }

  async function submit() {
    if (!accountId || !assetName.trim()) {
      setError("Pick an account and enter an asset name.");
      return;
    }
    setSaving(true);
    setError(null);
    const { error: insertErr } = await supabase.from("assets").insert({
      account_id: accountId,
      location_id: locationId || null,
      asset_name: assetName.trim(),
      category,
      agreement_reference: agreementRef.trim() || null,
      serial_number: serialNumber.trim() || null,
      equipment_value: equipmentValue ? Number(equipmentValue) : null,
      invoice_value: invoiceValue ? Number(invoiceValue) : null,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    reset();
    setOpen(false);
    onAdded();
  }

  if (!open) {
    return (
      <button type="button" className="btn-primary !px-3 !py-1.5 text-xs" onClick={() => setOpen(true)}>
        + Add asset
      </button>
    );
  }

  return (
    <div className="mb-3.5 rounded-[6px] border border-border bg-app/60 p-3">
      <div className="flex flex-wrap gap-2.5">
        <div>
          <label className="field-label">Account</label>
          <select className="field-input" value={accountId} onChange={(e) => { setAccountId(e.target.value); setLocationId(""); }}>
            <option value="">Select account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">Location (optional)</label>
          <select className="field-input" value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={!accountId}>
            <option value="">—</option>
            {accountLocations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">Category</label>
          <select className="field-input" value={category} onChange={(e) => setCategory(e.target.value as AssetCategory)}>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-2.5">
        <label className="field-label">Asset name</label>
        <input className="field-input" value={assetName} onChange={(e) => setAssetName(e.target.value)} placeholder="e.g. ZEISS VISUMAX 800 Femtosecond Laser Platform" />
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2.5">
        <div className="min-w-[220px] flex-1">
          <label className="field-label">Agreement reference</label>
          <input className="field-input" value={agreementRef} onChange={(e) => setAgreementRef(e.target.value)} placeholder="e.g. LVPEI Capital Equipment Agreement, 13-Aug-2026" />
        </div>
        <div>
          <label className="field-label">Serial number</label>
          <input className="field-input w-[160px]" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Equipment value (₹)</label>
          <input type="number" className="field-input w-[150px]" value={equipmentValue} onChange={(e) => setEquipmentValue(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Invoice value (₹)</label>
          <input type="number" className="field-input w-[150px]" value={invoiceValue} onChange={(e) => setInvoiceValue(e.target.value)} />
        </div>
      </div>
      <div className="mt-2.5">
        <label className="field-label">Notes</label>
        <textarea className="field-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" className="btn-primary !px-3 !py-1.5 text-xs" disabled={saving} onClick={submit}>
          {saving ? "Saving…" : "Add asset"}
        </button>
        <button
          type="button"
          className="rounded-[4px] border border-border bg-card px-2.5 py-1.5 text-[11px] font-bold text-ink-soft"
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          Cancel
        </button>
        {error && <span className="text-[11px] font-semibold text-bad-fg">{error}</span>}
      </div>
    </div>
  );
}

/** Click-to-edit for the plain descriptive/value fields (serial number,
 * agreement reference, equipment/invoice value) that the account manager
 * fills in themselves after a bare row is created for an existing
 * contract -- no boolean toggle, just "here's what's on file, click to
 * fill or correct it." */
function EditableFieldsCell({
  display,
  fields,
  onSave,
}: {
  display: ReactNode;
  fields: { key: string; label: string; type: "text" | "number"; value: string }[];
  onSave: (values: Record<string, string>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.value])));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setValues(Object.fromEntries(fields.map((f) => [f.key, f.value])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  if (!editing) {
    return (
      <button type="button" className="text-left" onClick={() => setEditing(true)}>
        {display}
      </button>
    );
  }

  return (
    <div className="min-w-[200px] rounded-[6px] border border-border bg-app/60 p-2">
      {fields.map((f) => (
        <div key={f.key} className="mb-1.5">
          <label className="field-label">{f.label}</label>
          <input
            type={f.type}
            className="field-input !py-1 text-[12px]"
            value={values[f.key] ?? ""}
            onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
          />
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="btn-primary !px-2 !py-1 text-[11px]"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await onSave(values);
            setSaving(false);
            setEditing(false);
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="rounded-[4px] border border-border bg-card px-2 py-1 text-[11px] font-bold text-ink-soft"
          onClick={() => setEditing(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** One of the three real-world checkpoints -- PO raised to Zeiss, payment
 * received from hospital, PO received from hospital -- rendered as a badge
 * plus an inline edit form for its supporting fields. Kept generic (one
 * component instead of three near-identical blocks) since all three share
 * the same shape: a boolean, a reference number, a date, and sometimes a
 * price. */
function CheckpointCell({
  label,
  done,
  summary,
  fields,
  onSave,
}: {
  label: string;
  done: boolean;
  summary: string | null;
  fields: { key: string; label: string; type: "text" | "date" | "number"; value: string }[];
  onSave: (values: Record<string, string>, done: boolean) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.value])));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setValues(Object.fromEntries(fields.map((f) => [f.key, f.value])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  return (
    <div>
      {!editing ? (
        <button type="button" className="text-left" onClick={() => setEditing(true)}>
          <span className={`badge ${done ? "badge-good" : "badge-neutral"}`}>{done ? label + " ✓" : label + " pending"}</span>
          {summary && <div className="mt-0.5 text-[10.5px] text-muted">{summary}</div>}
        </button>
      ) : (
        <div className="min-w-[200px] rounded-[6px] border border-border bg-app/60 p-2">
          {fields.map((f) => (
            <div key={f.key} className="mb-1.5">
              <label className="field-label">{f.label}</label>
              <input
                type={f.type}
                className="field-input !py-1 text-[12px]"
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="btn-primary !px-2 !py-1 text-[11px]"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                await onSave(values, true);
                setSaving(false);
                setEditing(false);
              }}
            >
              {saving ? "Saving…" : "Confirm"}
            </button>
            {done && (
              <button
                type="button"
                className="rounded-[4px] border border-border bg-card px-2 py-1 text-[11px] font-bold text-ink-soft"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  await onSave(Object.fromEntries(fields.map((f) => [f.key, ""])), false);
                  setSaving(false);
                  setEditing(false);
                }}
              >
                Unmark
              </button>
            )}
            <button
              type="button"
              className="rounded-[4px] border border-border bg-card px-2 py-1 text-[11px] font-bold text-ink-soft"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AssetRegisterPanel() {
  const supabase = createClient();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [assets, setAssets] = useState<AssetRow[] | null>(null);
  const [accountFilter, setAccountFilter] = useState("");

  async function load() {
    const [{ data: accountRows }, { data: locationRows }, { data: assetRows }] = await Promise.all([
      supabase.from("accounts").select("id, label").order("label"),
      supabase.from("account_locations").select("id, account_id, name").order("name"),
      supabase
        .from("assets")
        .select("*, accounts:account_id(label), account_locations:location_id(name)")
        .order("created_at", { ascending: false })
        .returns<AssetRow[]>(),
    ]);
    setAccounts(accountRows ?? []);
    setLocations(locationRows ?? []);
    setAssets(assetRows ?? []);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(
    () => (assets ?? []).filter((a) => !accountFilter || a.account_id === accountFilter),
    [assets, accountFilter]
  );

  async function patch(id: string, values: Record<string, unknown>) {
    await supabase.from("assets").update({ ...values, updated_at: new Date().toISOString() }).eq("id", id);
    void load();
  }

  const exportRows = useMemo(
    () =>
      visible.map((a) => ({
        account: a.accounts?.label ?? "—",
        location: a.account_locations?.name ?? "—",
        assetName: a.asset_name,
        category: CATEGORY_LABELS[a.category],
        agreementReference: a.agreement_reference ?? "",
        serialNumber: a.serial_number ?? "",
        equipmentValue: a.equipment_value ?? "",
        invoiceValue: a.invoice_value ?? "",
        poRaisedToZeiss: a.po_raised_to_zeiss ? "Yes" : "No",
        poToZeissNumber: a.po_to_zeiss_number ?? "",
        poToZeissDate: a.po_to_zeiss_date ?? "",
        paymentReceivedFromHospital: a.payment_received_from_hospital ? "Yes" : "No",
        paymentReceivedAmount: a.payment_received_amount ?? "",
        paymentReceivedDate: a.payment_received_date ?? "",
        poReceivedFromHospital: a.po_received_from_hospital ? "Yes" : "No",
        poFromHospitalNumber: a.po_from_hospital_number ?? "",
        poFromHospitalDate: a.po_from_hospital_date ?? "",
        poFromHospitalPrice: a.po_from_hospital_price ?? "",
        status: a.status,
        notes: a.notes ?? "",
      })),
    [visible]
  );

  if (assets === null) return <Loading />;

  return (
    <div className="card">
      <div className="mb-3.5 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[14.5px] font-extrabold text-ink">Asset register</h3>
          <p className="mt-1 text-xs text-muted">
            Capital and benefit equipment tracked against the agreements on file — whether a PO has been raised to Zeiss,
            whether payment has been received from the hospital, and whether a PO has been received from the hospital
            with price.
          </p>
        </div>
        <ExportButton
          filename="asset-register"
          columns={[
            { key: "account", label: "Account" },
            { key: "location", label: "Location" },
            { key: "assetName", label: "Asset" },
            { key: "category", label: "Category" },
            { key: "agreementReference", label: "Agreement reference" },
            { key: "serialNumber", label: "Serial number" },
            { key: "equipmentValue", label: "Equipment value" },
            { key: "invoiceValue", label: "Invoice value" },
            { key: "poRaisedToZeiss", label: "PO raised to Zeiss" },
            { key: "poToZeissNumber", label: "PO to Zeiss #" },
            { key: "poToZeissDate", label: "PO to Zeiss date" },
            { key: "paymentReceivedFromHospital", label: "Payment received from hospital" },
            { key: "paymentReceivedAmount", label: "Payment amount" },
            { key: "paymentReceivedDate", label: "Payment date" },
            { key: "poReceivedFromHospital", label: "PO received from hospital" },
            { key: "poFromHospitalNumber", label: "Hospital PO #" },
            { key: "poFromHospitalDate", label: "Hospital PO date" },
            { key: "poFromHospitalPrice", label: "Hospital PO price" },
            { key: "status", label: "Status" },
            { key: "notes", label: "Notes" },
          ]}
          rows={exportRows}
        />
      </div>

      <div className="mb-3.5 flex flex-wrap items-end justify-between gap-2.5">
        <div className="max-w-[260px] flex-1">
          <label className="field-label">Filter by account</label>
          <select className="field-input" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <AddAssetForm accounts={accounts} locations={locations} onAdded={load} />
      </div>

      {visible.length === 0 ? (
        <Empty title="No assets yet" body="Add a capital or benefit equipment item to start tracking its PO and payment status." />
      ) : (
        <div className="overflow-x-auto">
          <table className="u-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Account</th>
                <th className="text-right">Value</th>
                <th>PO → Zeiss</th>
                <th>Payment ← Hospital</th>
                <th>PO ← Hospital</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => (
                <tr key={a.id}>
                  <td>
                    <EditableFieldsCell
                      display={
                        <>
                          <div className="font-semibold text-ink">{a.asset_name}</div>
                          <div className="text-[10.5px] text-muted">
                            {CATEGORY_LABELS[a.category]}
                            {a.serial_number ? ` · Serial ${a.serial_number}` : " · Serial —"}
                          </div>
                          <div className="text-[10.5px] text-muted">{a.agreement_reference || "No agreement reference — click to add"}</div>
                        </>
                      }
                      fields={[
                        { key: "agreement_reference", label: "Agreement reference", type: "text", value: a.agreement_reference ?? "" },
                        { key: "serial_number", label: "Serial number", type: "text", value: a.serial_number ?? "" },
                      ]}
                      onSave={(values) =>
                        patch(a.id, {
                          agreement_reference: values.agreement_reference || null,
                          serial_number: values.serial_number || null,
                        })
                      }
                    />
                  </td>
                  <td>
                    {a.accounts?.label ?? "—"}
                    {a.account_locations?.name && <div className="text-[10.5px] text-muted">{a.account_locations.name}</div>}
                  </td>
                  <td className="text-right">
                    <EditableFieldsCell
                      display={
                        <>
                          <div>{inr(a.invoice_value)}</div>
                          {a.equipment_value !== null && a.equipment_value !== a.invoice_value && (
                            <div className="text-[10.5px] text-muted">Actual {inr(a.equipment_value)}</div>
                          )}
                        </>
                      }
                      fields={[
                        { key: "invoice_value", label: "Invoice value (₹)", type: "number", value: a.invoice_value?.toString() ?? "" },
                        { key: "equipment_value", label: "Actual/equipment value (₹)", type: "number", value: a.equipment_value?.toString() ?? "" },
                      ]}
                      onSave={(values) =>
                        patch(a.id, {
                          invoice_value: values.invoice_value ? Number(values.invoice_value) : null,
                          equipment_value: values.equipment_value ? Number(values.equipment_value) : null,
                        })
                      }
                    />
                  </td>
                  <td>
                    <CheckpointCell
                      label="PO raised"
                      done={a.po_raised_to_zeiss}
                      summary={a.po_raised_to_zeiss ? [a.po_to_zeiss_number, a.po_to_zeiss_date].filter(Boolean).join(" · ") || null : null}
                      fields={[
                        { key: "po_to_zeiss_number", label: "PO number", type: "text", value: a.po_to_zeiss_number ?? "" },
                        { key: "po_to_zeiss_date", label: "PO date", type: "date", value: a.po_to_zeiss_date ?? "" },
                      ]}
                      onSave={(values, done) =>
                        patch(a.id, {
                          po_raised_to_zeiss: done,
                          po_to_zeiss_number: done ? values.po_to_zeiss_number || null : null,
                          po_to_zeiss_date: done ? values.po_to_zeiss_date || null : null,
                        })
                      }
                    />
                  </td>
                  <td>
                    <CheckpointCell
                      label="Payment received"
                      done={a.payment_received_from_hospital}
                      summary={
                        a.payment_received_from_hospital
                          ? [a.payment_received_amount !== null ? inr(a.payment_received_amount) : null, a.payment_received_date]
                              .filter(Boolean)
                              .join(" · ") || null
                          : null
                      }
                      fields={[
                        { key: "payment_received_amount", label: "Amount (₹)", type: "number", value: a.payment_received_amount?.toString() ?? "" },
                        { key: "payment_received_date", label: "Date", type: "date", value: a.payment_received_date ?? "" },
                      ]}
                      onSave={(values, done) =>
                        patch(a.id, {
                          payment_received_from_hospital: done,
                          payment_received_amount: done && values.payment_received_amount ? Number(values.payment_received_amount) : null,
                          payment_received_date: done ? values.payment_received_date || null : null,
                        })
                      }
                    />
                  </td>
                  <td>
                    <CheckpointCell
                      label="PO received"
                      done={a.po_received_from_hospital}
                      summary={
                        a.po_received_from_hospital
                          ? [a.po_from_hospital_number, a.po_from_hospital_price !== null ? inr(a.po_from_hospital_price) : null, a.po_from_hospital_date]
                              .filter(Boolean)
                              .join(" · ") || null
                          : null
                      }
                      fields={[
                        { key: "po_from_hospital_number", label: "PO number", type: "text", value: a.po_from_hospital_number ?? "" },
                        { key: "po_from_hospital_price", label: "Price (₹)", type: "number", value: a.po_from_hospital_price?.toString() ?? "" },
                        { key: "po_from_hospital_date", label: "PO date", type: "date", value: a.po_from_hospital_date ?? "" },
                      ]}
                      onSave={(values, done) =>
                        patch(a.id, {
                          po_received_from_hospital: done,
                          po_from_hospital_number: done ? values.po_from_hospital_number || null : null,
                          po_from_hospital_price: done && values.po_from_hospital_price ? Number(values.po_from_hospital_price) : null,
                          po_from_hospital_date: done ? values.po_from_hospital_date || null : null,
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
