"use client";

import { useState, type FormEvent } from "react";
import { AppShell } from "./AppShell";
import { BuildingIcon, DashboardIcon, UploadIcon } from "./icons";
import {
  createAccount,
  createLocation,
  createLocationLogin,
  deleteLogin,
  deleteSku,
  updateAccount,
  updateLogin,
  upsertSku,
} from "@/app/accounts/actions";
import type { Account, AccountLocation, Sku } from "@/lib/supabase/database.types";

type LoginProfile = { id: string; account_id: string | null; location_id: string | null; email: string };

export function AccountsAdmin({
  accounts,
  locations,
  skus,
  logins,
}: {
  accounts: Account[];
  locations: Pick<AccountLocation, "id" | "account_id" | "name">[];
  skus: Sku[];
  logins: LoginProfile[];
}) {
  const [showNewAccount, setShowNewAccount] = useState(false);

  return (
    <AppShell
      ctx="Account Manager"
      stats={[]}
      maxWidthClass="max-w-[860px]"
      extraNav={[
        { href: "/manager", label: "Dashboard", icon: <DashboardIcon /> },
        { href: "/manager/import", label: "Import", icon: <UploadIcon /> },
      ]}
      tabs={[
        {
          id: "accounts",
          label: "Accounts",
          icon: <BuildingIcon />,
          content: (
            <>
              <div className="card mb-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[14.5px] font-extrabold text-ink">Hospitals / accounts</h3>
                  <button className="btn-primary" onClick={() => setShowNewAccount((v) => !v)}>
                    {showNewAccount ? "Cancel" : "Add hospital"}
                  </button>
                </div>
                {showNewAccount && (
                  <form
                    action={async (fd) => {
                      await createAccount(fd);
                      setShowNewAccount(false);
                    }}
                    className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
                  >
                    <TextField name="code" label="Code" placeholder="e.g. NN1" required />
                    <TextField name="label" label="Label" placeholder="Display name" required />
                    <TextField name="commitment_start" label="Commitment start" type="date" />
                    <TextField name="commitment_period_months" label="Commitment (months)" type="number" />
                    <TextField name="iol_payment_days" label="IOL payment days" type="number" />
                    <TextField name="interest_rate" label="Interest rate" placeholder="e.g. 11% p.a." />
                    <TextField name="review_cadence" label="Review cadence" placeholder="e.g. Quarterly" />
                    <TextField
                      name="license_payment_term"
                      label="License payment term"
                      textarea
                      className="sm:col-span-2"
                    />
                    <TextField name="key_dates" label="Key dates" textarea className="sm:col-span-2" />
                    <TextField name="notes" label="Notes" textarea className="sm:col-span-2" />
                    <div className="sm:col-span-2">
                      <button type="submit" className="btn-primary">
                        Create account
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {accounts.map((account) => (
                <AccountCard
                  key={account.id}
                  account={account}
                  locations={locations.filter((l) => l.account_id === account.id)}
                  skus={skus.filter((s) => s.account_id === account.id)}
                  logins={logins.filter((p) => p.account_id === account.id)}
                />
              ))}
            </>
          ),
        },
      ]}
    />
  );
}

function AccountCard({
  account,
  locations,
  skus,
  logins,
}: {
  account: Account;
  locations: Pick<AccountLocation, "id" | "account_id" | "name">[];
  skus: Sku[];
  logins: LoginProfile[];
}) {
  const [showAddSku, setShowAddSku] = useState(false);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const boundUpdate = updateAccount.bind(null, account.id);
  const boundCreateLocation = createLocation.bind(null, account.id);
  const boundCreateSku = upsertSku.bind(null, account.id, null);

  return (
    <div className="card mb-4">
      <h3 className="mb-3 text-[14.5px] font-extrabold text-ink">
        {account.code} — {account.label}
      </h3>

      <form action={boundUpdate} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField name="label" label="Label" defaultValue={account.label} required />
        <TextField
          name="commitment_start"
          label="Commitment start"
          type="date"
          defaultValue={account.commitment_start ?? ""}
        />
        <TextField
          name="commitment_period_months"
          label="Commitment (months)"
          type="number"
          defaultValue={account.commitment_period_months ?? ""}
        />
        <TextField
          name="iol_payment_days"
          label="IOL payment days"
          type="number"
          defaultValue={account.iol_payment_days ?? ""}
        />
        <TextField name="interest_rate" label="Interest rate" defaultValue={account.interest_rate ?? ""} />
        <TextField
          name="review_cadence"
          label="Review cadence"
          defaultValue={account.review_cadence ?? ""}
        />
        <TextField
          name="license_payment_term"
          label="License payment term"
          textarea
          defaultValue={account.license_payment_term ?? ""}
          className="sm:col-span-2"
        />
        <TextField
          name="key_dates"
          label="Key dates"
          textarea
          defaultValue={account.key_dates ?? ""}
          className="sm:col-span-2"
        />
        <TextField name="notes" label="Notes" textarea defaultValue={account.notes ?? ""} className="sm:col-span-2" />
        <div className="sm:col-span-2">
          <button type="submit" className="btn-primary">
            Save terms
          </button>
        </div>
      </form>

      <div className="mt-5 border-t border-border pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wide text-muted-strong">Locations</h4>
          <button
            className="text-xs font-bold text-accent"
            onClick={() => setShowAddLocation((v) => !v)}
          >
            {showAddLocation ? "Cancel" : "+ Add location"}
          </button>
        </div>
        <p className="mb-2 text-[11px] text-muted">
          {locations.length > 1
            ? "One shared login covers every center below — the hospital picks which center per usage entry / order."
            : "The physical center(s) under this account."}
        </p>
        <ul className="mb-2 flex flex-wrap gap-2">
          {locations.map((l) => (
            <li
              key={l.id}
              className="rounded-full bg-neutral-bg px-3 py-1 text-xs font-semibold text-neutral-fg"
            >
              {l.name}
            </li>
          ))}
          {locations.length === 0 && <li className="text-xs text-muted">No locations yet.</li>}
        </ul>
        {showAddLocation && (
          <form
            action={async (fd) => {
              await boundCreateLocation(fd);
              setShowAddLocation(false);
            }}
            className="flex gap-2"
          >
            <input name="name" placeholder="Location name" required className="field-input" />
            <button type="submit" className="btn-primary shrink-0">
              Add
            </button>
          </form>
        )}
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wide text-muted-strong">Login</h4>
        </div>
        <AccountLoginSection accountId={account.id} logins={logins} />
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wide text-muted-strong">SKUs</h4>
          <button className="text-xs font-bold text-accent" onClick={() => setShowAddSku((v) => !v)}>
            {showAddSku ? "Cancel" : "+ Add SKU"}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="u-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Price (ex GST)</th>
                <th>Transfer price</th>
                <th>Units / pack</th>
                <th>Commitment / month</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {skus.map((sku) => (
                <SkuRow key={sku.id} accountId={account.id} sku={sku} />
              ))}
              {showAddSku && (
                <NewSkuRow onAdd={boundCreateSku} onDone={() => setShowAddSku(false)} />
              )}
              {skus.length === 0 && !showAddSku && (
                <tr>
                  <td colSpan={6} className="text-center text-xs text-muted">
                    No SKUs yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AccountLoginSection({ accountId, logins }: { accountId: string; logins: LoginProfile[] }) {
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set("email", email);
      fd.set("password", password);
      // location_id is always null here -- one login covers the whole
      // account; if it has more than one center, the hospital picks which
      // one per usage entry / order instead of it being fixed at login level.
      await createLocationLogin(accountId, null, fd);
      setSuccess(`Login created for ${email}.`);
      setEmail("");
      setPassword("");
      setConfirm("");
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create login.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-neutral-bg px-3 py-2">
      {logins.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1.5">
          {logins.map((l) => (
            <LoginRow key={l.id} login={l} />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-neutral-fg">
          {logins.length === 0 ? "No login yet" : `${logins.length} login${logins.length > 1 ? "s" : ""}`}
        </span>
        <button
          type="button"
          className="text-[11px] font-bold text-accent"
          onClick={() => {
            setShowForm((v) => !v);
            setError(null);
            setSuccess(null);
          }}
        >
          {showForm ? "Cancel" : "+ Create login"}
        </button>
      </div>
      {showForm && (
        <form onSubmit={submit} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field-input"
          />
          <input
            type="password"
            required
            minLength={8}
            placeholder="Password (min 8 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field-input"
          />
          <input
            type="password"
            required
            minLength={8}
            placeholder="Confirm password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="field-input"
          />
          <div className="sm:col-span-3">
            <button type="submit" className="btn-primary !px-3 !py-1.5 text-xs" disabled={saving}>
              {saving ? "Creating…" : "Create login"}
            </button>
          </div>
        </form>
      )}
      {error && <div className="mt-1 text-[11px] font-semibold text-bad-fg">{error}</div>}
      {success && <div className="mt-1 text-[11px] font-semibold text-good-fg">{success}</div>}
    </div>
  );
}

function LoginRow({ login }: { login: LoginProfile }) {
  const [showEdit, setShowEdit] = useState(false);
  const [email, setEmail] = useState(login.email);
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password && password !== confirmPw) {
      setError("Passwords don't match.");
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set("email", email);
      if (password) fd.set("password", password);
      await updateLogin(login.id, fd);
      setSuccess("Saved.");
      setPassword("");
      setConfirmPw("");
      setShowEdit(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete the login "${login.email}"? This can't be undone — they won't be able to sign in anymore.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteLogin(login.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.");
      setDeleting(false);
    }
    // No `finally` — on success the row is gone via revalidatePath, so
    // there's nothing left to un-disable.
  }

  return (
    <li className="rounded-md border border-border bg-card px-2.5 py-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink">{login.email}</span>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            className="text-[11px] font-bold text-accent"
            onClick={() => {
              setShowEdit((v) => !v);
              setEmail(login.email);
              setError(null);
              setSuccess(null);
            }}
          >
            {showEdit ? "Cancel" : "Edit"}
          </button>
          <button
            type="button"
            className="text-[11px] font-bold text-bad-fg disabled:opacity-50"
            disabled={deleting}
            onClick={remove}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
      {showEdit && (
        <form onSubmit={submit} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field-input"
          />
          <input
            type="password"
            minLength={8}
            placeholder="New password (optional)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field-input"
          />
          <input
            type="password"
            minLength={8}
            placeholder="Confirm new password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            className="field-input"
            disabled={!password}
          />
          <div className="sm:col-span-3">
            <button type="submit" className="btn-primary !px-3 !py-1.5 text-xs" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}
      {error && <div className="mt-1 text-[11px] font-semibold text-bad-fg">{error}</div>}
      {success && <div className="mt-1 text-[11px] font-semibold text-good-fg">{success}</div>}
    </li>
  );
}

function SkuRow({ accountId, sku }: { accountId: string; sku: Sku }) {
  const [name, setName] = useState(sku.name);
  const [price, setPrice] = useState(String(sku.price_ex_gst ?? ""));
  const [transferPrice, setTransferPrice] = useState(String(sku.transfer_price ?? ""));
  const [unitsPerPack, setUnitsPerPack] = useState(String(sku.units_per_pack ?? 1));
  const [commitment, setCommitment] = useState(String(sku.commitment_per_month ?? ""));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await upsertSku(accountId, sku.id, {
        name,
        price_ex_gst: price,
        transfer_price: transferPrice,
        units_per_pack: unitsPerPack,
        commitment_per_month: commitment,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${sku.name}"? This can't be undone.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteSku(sku.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.");
      setDeleting(false);
    }
    // No `finally` — on success the row is gone via revalidatePath, so
    // there's nothing left to un-disable.
  }

  return (
    <tr>
      <td>
        <input value={name} onChange={(e) => setName(e.target.value)} className="field-input" />
      </td>
      <td>
        <input
          type="number"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="field-input"
        />
      </td>
      <td>
        <input
          type="number"
          step="0.01"
          value={transferPrice}
          onChange={(e) => setTransferPrice(e.target.value)}
          placeholder="—"
          className="field-input"
        />
      </td>
      <td>
        <input
          type="number"
          min="1"
          step="1"
          value={unitsPerPack}
          onChange={(e) => setUnitsPerPack(e.target.value)}
          title="How many procedures/units one invoice-line qty represents (e.g. a 'Pack of 10' product = 10)"
          className="field-input"
        />
      </td>
      <td>
        <input
          type="number"
          value={commitment}
          onChange={(e) => setCommitment(e.target.value)}
          className="field-input"
        />
      </td>
      <td>
        <div className="flex gap-1.5">
          <button className="btn-primary !px-3 !py-1.5 text-xs" disabled={saving || deleting} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            className="btn-outline-danger !px-3 !py-1.5 text-xs"
            disabled={saving || deleting}
            onClick={remove}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
        {error && <div className="mt-1 max-w-[220px] text-[11px] font-semibold text-bad-fg">{error}</div>}
      </td>
    </tr>
  );
}

function NewSkuRow({
  onAdd,
  onDone,
}: {
  onAdd: (data: {
    name: string;
    price_ex_gst: string;
    transfer_price: string;
    units_per_pack: string;
    commitment_per_month: string;
  }) => Promise<void>;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [transferPrice, setTransferPrice] = useState("");
  const [unitsPerPack, setUnitsPerPack] = useState("1");
  const [commitment, setCommitment] = useState("");
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onAdd({
        name,
        price_ex_gst: price,
        transfer_price: transferPrice,
        units_per_pack: unitsPerPack,
        commitment_per_month: commitment,
      });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New SKU"
          className="field-input"
        />
      </td>
      <td>
        <input
          type="number"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="—"
          className="field-input"
        />
      </td>
      <td>
        <input
          type="number"
          step="0.01"
          value={transferPrice}
          onChange={(e) => setTransferPrice(e.target.value)}
          placeholder="—"
          className="field-input"
        />
      </td>
      <td>
        <input
          type="number"
          min="1"
          step="1"
          value={unitsPerPack}
          onChange={(e) => setUnitsPerPack(e.target.value)}
          title="How many procedures/units one invoice-line qty represents (e.g. a 'Pack of 10' product = 10)"
          className="field-input"
        />
      </td>
      <td>
        <input
          type="number"
          value={commitment}
          onChange={(e) => setCommitment(e.target.value)}
          placeholder="—"
          className="field-input"
        />
      </td>
      <td>
        <button className="btn-primary" disabled={saving} onClick={add}>
          {saving ? "Saving…" : "Add"}
        </button>
      </td>
    </tr>
  );
}

function TextField({
  name,
  label,
  type = "text",
  placeholder,
  defaultValue,
  required,
  textarea,
  className,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string | number;
  required?: boolean;
  textarea?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="field-label">{label}</label>
      {textarea ? (
        <textarea
          name={name}
          placeholder={placeholder}
          defaultValue={defaultValue}
          rows={2}
          className="field-input resize-y"
        />
      ) : (
        <input
          name={name}
          type={type}
          placeholder={placeholder}
          defaultValue={defaultValue}
          required={required}
          className="field-input"
        />
      )}
    </div>
  );
}
