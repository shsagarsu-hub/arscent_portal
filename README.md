# Arscent Account Management Portal

Next.js 16 + Supabase portal for Arscent Health Services to manage Zeiss ophthalmic product
distribution to hospitals — orders, consignment stock, invoicing, and reporting, for both the
account manager and each hospital's own login.

## Setup

1. Create a Supabase project and run the SQL migrations against it (see "Database" below).
2. Copy `.env.local.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Project Settings → API.
   - `SUPABASE_SERVICE_ROLE_KEY` — same page. **Server-only** — used by server actions that write
     accounts/locations/SKUs/logins with the caller's role checked first.
   - `RESEND_API_KEY` / `RESEND_SANDBOX_RECIPIENT` — optional; order-placed email notifications are
     skipped (not failed) when unset. See `src/lib/email.ts`.
3. `npm install && npm run dev`.
4. Create your first admin user in Supabase Auth (dashboard → Authentication → Users), then insert a
   matching row in `profiles` (role `admin`). From there, further hospital/manager logins can be
   created from the `/accounts` screen itself.

## What's here

- `/login` — Supabase Auth email/password sign-in.
- `/hospital` — a hospital's own portal: log usage against stock already shipped to them on
  consignment, place LTC/STC/Saleable orders, view order/usage history and reports. Scoped to the
  signed-in login's account (and location, unless it's an account-wide login) via RLS.
- `/manager` — the account manager's portal: Dashboard (revenue vs. committed), Vs Committed,
  Inventory (warehouse + per-hospital consignment balances), Orders (DC/invoice fulfillment, send
  consumption orders to consignment), Consignment (usage log → record → pending invoice → billed),
  Accounts admin, and Tally import.
- `/accounts` — manage hospitals/accounts, locations, SKUs, and logins (create/edit/delete) — account
  manager / admin only.

### The order → consignment → billing lifecycle

1. A hospital places an LTC/STC (consignment) or Saleable order.
2. The manager fulfills it: LTC/STC gets a DC number (stock moves warehouse → that hospital's
   consignment balance, no billing yet); Saleable gets an invoice number directly (stock moves
   warehouse → sold, billed immediately).
3. The hospital logs usage against whatever's currently on their consignment stock — no PO lookup
   needed, since usage can only ever be logged against stock that was actually shipped to them.
   This creates a "consumption" order behind the scenes.
4. The manager sends that consumption order to Consignment, confirms the exact catalog item/batch,
   and records it — this deducts the hospital's consignment balance and creates a pending invoice.
5. Once invoiced, it closes and rolls into the Dashboard's revenue figures alongside confirmed Tally
   invoices and closed Saleable orders.

## Database

There's no formal migrations folder yet — schema changes are plain `.sql` files run by hand in the
Supabase SQL Editor, kept in the parent directory of this repo. Row Level Security is enabled on
every table the app reads/writes, with two established patterns reused throughout:

- **Account-wide hospital logins** (one login covering every center under an account, e.g. a
  multi-center hospital group): a `profiles.location_id is null` login is allowed through if the
  target row's `location_id` belongs to one of that account's `account_locations` — see the
  `orders`/`order_lines`/`usage_log` policies for the exact shape.
- **`profiles` self-service without recursion**: policies that need "is this user a manager/admin"
  go through a `security definer` helper function (`fn_is_manager_or_admin()`) rather than an inline
  subquery on `profiles` from within a `profiles` policy — the latter causes Postgres error 42P17
  (infinite recursion), since the inner query would itself be subject to the same policy.

Multi-statement SQL Editor runs can silently roll back the *entire* script if any one statement
fails (a known Supabase SQL Editor quirk) — if a later query says a column/enum value is missing
right after you thought a migration ran, re-run it in isolation to confirm.

## Type-checking Supabase queries

`src/lib/supabase/database.types.ts` is hand-written (no real migrations to generate from). Two
things will silently break it if "cleaned up" later — every typed query result collapses to `never`
with no error at the call site until you look at Insert/Update:

1. `Row`/`Insert`/`Update` must be `type` aliases, not `interface`s.
2. `Insert`/`Update` must be spelled out as literal object types, never derived via `Partial<Row>`
   or any other mapped type.

Both are TypeScript/postgrest-js resolution quirks under `strictNullChecks`, not stylistic
preferences.

## Deployment

Deployed on Vercel. Set the same environment variables from `.env.local` in the Vercel project
settings (Production + Preview). `next.config.ts` pins `turbopack.root` explicitly — without it,
Turbopack can walk up past this repo looking for a lockfile and guess the wrong workspace root on
some machines/CI runners.
