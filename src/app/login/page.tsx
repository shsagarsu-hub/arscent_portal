"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Wordmark } from "@/components/Wordmark";
import { SiteFooter } from "@/components/SiteFooter";

const FEATURES = [
  {
    title: "Log Usage",
    desc: "Center staff record consumption as it happens.",
    icon: (
      <path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round" />
    ),
  },
  {
    title: "Track Commitments",
    desc: "Actual vs committed by SKU, per account, live.",
    icon: (
      <path d="M4 20V10m6 10V4m6 16v-7" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  {
    title: "Manage Orders",
    desc: "Consignment and saleable orders, end to end.",
    icon: (
      <>
        <rect x="4" y="7" width="16" height="13" rx="1" />
        <path d="M8 7V5a4 4 0 0 1 8 0v2" strokeLinecap="round" />
      </>
    ),
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-col bg-cream">
      <div className="flex items-center justify-between border-b border-border bg-white px-6 py-3">
        <Wordmark />
        <span className="text-xs font-semibold text-muted">Account Management Portal</span>
      </div>

      <div className="bg-white px-6 pb-2 pt-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-soft">Arscent Account Portal</h1>
      </div>

      <div
        className="relative overflow-hidden px-6 py-14"
        style={{ background: "linear-gradient(135deg, var(--color-brand) 0%, var(--color-brand-dark) 100%)" }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 15% 20%, white 0%, transparent 45%), radial-gradient(circle at 85% 80%, white 0%, transparent 40%)",
          }}
        />
        <div className="relative mx-auto w-full max-w-[380px] rounded-[14px] bg-card p-7 shadow-[0_24px_60px_rgba(9,15,30,0.35)]">
          <h2 className="mb-1 text-[16px] font-extrabold text-ink">Sign in</h2>
          <p className="mb-5 text-xs text-muted">Enter your account credentials to continue.</p>
          <form onSubmit={handleSubmit}>
            {error && (
              <div className="mb-3.5 rounded-[6px] border-l-4 border-bad-fg bg-bad-bg px-4 py-2.5 text-[12.5px] font-semibold text-bad-fg">
                {error}
              </div>
            )}

            <div className="mb-4">
              <label className="field-label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                className="field-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="mb-5">
              <label className="field-label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                className="field-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? "Signing in…" : "Login"}
            </button>
          </form>
        </div>
      </div>

      <div className="flex-1 px-6 py-12">
        <div className="mx-auto grid max-w-3xl grid-cols-1 gap-10 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="text-center">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-linear-to-br from-ink-soft to-ink shadow-[0_6px_16px_rgba(23,37,68,0.18)]">
                <svg className="h-7 w-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  {f.icon}
                </svg>
              </div>
              <h3 className="mb-1 text-[15px] font-extrabold text-ink-soft">{f.title}</h3>
              <p className="text-xs text-muted">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
