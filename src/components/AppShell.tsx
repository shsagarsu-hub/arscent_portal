"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Wordmark } from "./Wordmark";
import { createClient } from "@/lib/supabase/client";

export interface AppTab {
  id: string;
  label: string;
  content: ReactNode;
  icon?: ReactNode;
}

export function StatBox({
  value,
  label,
  accentColor,
}: {
  value: string | number;
  label: string;
  accentColor?: string;
}) {
  return (
    <div
      className="rounded-[8px] border border-border bg-card p-2.5 text-center shadow-[0_1px_3px_rgba(23,37,68,0.05)]"
      style={{ borderTop: `2px solid ${accentColor ?? "var(--color-accent)"}` }}
    >
      <div
        className="truncate bg-clip-text text-[15px] font-extrabold text-transparent sm:text-[19px]"
        style={{
          backgroundImage: `linear-gradient(135deg, ${accentColor ?? "var(--color-accent)"}, var(--color-accent-2))`,
        }}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[9.5px] font-bold uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

function DefaultTabIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px] shrink-0">
      <circle cx="10" cy="10" r="4" fill="currentColor" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-[18px] w-[18px] shrink-0">
      <path d="M7.5 3H4.5A1.5 1.5 0 0 0 3 4.5v11A1.5 1.5 0 0 0 4.5 17h3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 14l4-4-4-4M17 10H7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AppShell({
  ctx,
  stats,
  tabs,
  extraNav,
  showSignOut = true,
  maxWidthClass = "max-w-[640px]",
  accentColor,
  showUserName = false,
}: {
  ctx: string;
  stats: { value: string | number; label: string }[];
  tabs: AppTab[];
  extraNav?: { href: string; label: string; icon?: ReactNode }[];
  showSignOut?: boolean;
  /** Shows the logged-in user's own name above `ctx` in the sidebar (e.g.
   * "Sagar" / "Account Manager-Zeiss") instead of just `ctx` alone --
   * opt-in because the hospital portal already uses `ctx` for something
   * else entirely (the hospital's own location/account name), not a role
   * label, so this can't just always turn on. */
  showUserName?: boolean;
  /** The hospital portal's forms are simple and stay comfortably narrow at
   * the default. The account manager's tables (Inventory especially — 10
   * columns of batch/expiry/movement data) need real desktop width, so it
   * passes something wider. */
  maxWidthClass?: string;
  /** Distinguishes portal identity by color -- the account manager side
   * stays on the default brand blue, the hospital side passes its own
   * accent (teal) so the two don't read as the exact same product skinned
   * twice. Drives the active-tab highlight and the header stat cards' top
   * border/number gradient; everything else (cards, buttons, inputs) stays
   * on the shared neutral palette. */
  accentColor?: string;
}) {
  const [active, setActive] = useState(tabs[0]?.id);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);

  useEffect(() => {
    if (!showUserName) return;
    const supabase = createClient();
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
      setUserName(profile?.full_name ?? null);
    })();
  }, [showUserName]);

  // Callers commonly render a one-tab "loading" AppShell first, then swap in
  // the real tabs once data arrives (see ManagerPortal/HospitalPortal). Since
  // it's the same component at the same position, React reuses this instance
  // rather than remounting it, so the useState initializer above only ever
  // ran once, against that first "loading" tab id — active would get stuck
  // on it forever, matching none of the real tabs, leaving every one of them
  // rendered hidden. Re-sync whenever the actual set of tab ids changes,
  // during render rather than an effect so there's no extra frame of
  // everything-hidden in between.
  const tabIds = tabs.map((t) => t.id).join("|");
  const [prevTabIds, setPrevTabIds] = useState(tabIds);
  if (tabIds !== prevTabIds) {
    setPrevTabIds(tabIds);
    setActive(tabs[0]?.id);
  }

  function selectTab(id: string) {
    setActive(id);
    setSidebarOpen(false);
  }

  return (
    <div className="flex min-h-screen">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col bg-linear-to-b from-ink to-[#0e1830] shadow-[2px_0_12px_rgba(9,15,30,0.15)] transition-transform duration-200 md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-4">
          <Wordmark />
          <button
            type="button"
            className="text-white/70 hover:text-white md:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="border-b border-white/10 px-4 py-3">
          {showUserName && userName ? (
            <>
              <div className="truncate text-[13.5px] font-extrabold text-white">{userName}</div>
              <div className="truncate text-[11px] font-semibold text-white/60">{ctx}-Zeiss</div>
            </>
          ) : (
            <div className="truncate text-[12.5px] font-semibold text-white/80">{ctx}</div>
          )}
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => selectTab(t.id)}
              className={`flex w-full items-center gap-2.5 rounded-[6px] border-l-[3px] px-3 py-2.5 text-left text-[13px] font-bold transition-all ${
                active === t.id
                  ? "bg-linear-to-r from-white/15 to-white/[0.03] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
                  : "border-transparent text-white/65 hover:bg-white/5 hover:text-white"
              }`}
              style={active === t.id ? { borderLeftColor: accentColor ?? "var(--color-accent)" } : undefined}
            >
              {t.icon ?? <DefaultTabIcon />}
              {t.label}
            </button>
          ))}
          {extraNav && extraNav.length > 0 && (
            <div className="mt-3 border-t border-white/10 pt-3">
              {extraNav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="flex w-full items-center gap-2.5 rounded-[6px] border-l-[3px] border-transparent px-3 py-2.5 text-left text-[13px] font-bold text-white/65 transition-colors hover:bg-white/5 hover:text-white"
                >
                  {n.icon ?? <DefaultTabIcon />}
                  {n.label}
                </Link>
              ))}
            </div>
          )}
        </nav>

        {showSignOut && (
          <form action="/auth/sign-out" method="post" className="border-t border-white/10 p-3">
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 rounded-[6px] px-3 py-2.5 text-left text-[13px] font-bold text-white/65 transition-colors hover:bg-white/5 hover:text-white"
            >
              <SignOutIcon />
              Sign out
            </button>
          </form>
        )}
      </aside>

      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-30 border-b border-header-border bg-header px-4 py-3.5 shadow-[0_1px_4px_rgba(23,37,68,0.05)]">
          <div className="mb-3 flex items-center gap-2.5">
            <button
              type="button"
              className="shrink-0 text-ink-soft md:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <MenuIcon />
            </button>
            <span className="min-w-0 truncate text-[13px] font-semibold text-muted-strong md:hidden">{ctx}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {stats.map((s) => (
              <StatBox key={s.label} {...s} accentColor={accentColor} />
            ))}
          </div>
        </div>

        <div className={`mx-auto ${maxWidthClass} p-4 pb-24 sm:p-6`}>
          {tabs.map((t) => (
            <div
              key={t.id}
              className={active === t.id ? "block animate-[tabFadeIn_180ms_ease-out]" : "hidden"}
            >
              {t.content}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="py-11 text-center text-muted">
      <h4 className="mb-1 text-[15px] font-extrabold text-ink-soft">{title}</h4>
      <p className="text-[12.5px]">{body}</p>
    </div>
  );
}

export function Loading() {
  return <div className="py-6 text-center text-[12.5px] text-muted">Loading…</div>;
}
