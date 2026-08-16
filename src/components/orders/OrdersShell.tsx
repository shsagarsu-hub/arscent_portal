"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Wordmark } from "@/components/Wordmark";
import { SiteFooter } from "@/components/SiteFooter";

export interface NavLeaf {
  label: string;
  href: string;
}
export interface NavSection {
  label: string;
  leaves: NavLeaf[];
}

export function defaultOrdersSections(basePath: string): NavSection[] {
  return [
    {
      label: "Order Management",
      leaves: [
        { label: "Saleable Order", href: `${basePath}/saleable` },
        { label: "Consignment Order", href: `${basePath}/consignment` },
      ],
    },
    { label: "Reports", leaves: [] },
    { label: "Self Service", leaves: [] },
  ];
}

export function OrdersShell({
  userName,
  basePath = "/manager/orders",
  showSignOut = true,
  sections,
  children,
}: {
  userName: string;
  basePath?: string;
  showSignOut?: boolean;
  sections?: NavSection[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const resolvedSections = sections ?? defaultOrdersSections(basePath);
  const [openSections, setOpenSections] = useState<Set<string>>(
    () =>
      new Set(
        resolvedSections.filter((s) => s.leaves.some((l) => pathname.startsWith(l.href))).map((s) => s.label)
      )
  );

  function toggle(label: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-cream">
      <div className="flex items-center justify-between border-b border-border bg-white px-6 py-3">
        <Wordmark />
        <span className="text-xs font-semibold text-muted">Order Portal</span>
      </div>
      <div className="bg-linear-to-r from-brand to-brand-dark px-6 py-2.5 text-sm font-bold tracking-wide text-white">
        ARSCENT ORDER PORTAL
      </div>

      <div className="flex">
        <aside className="w-64 shrink-0 border-r border-border bg-white">
          <div className="bg-ink px-4 py-4 text-white">
            <div className="text-sm font-bold">{userName}</div>
            {showSignOut && (
              <form action="/auth/sign-out" method="post">
                <button type="submit" className="mt-1 text-xs font-semibold text-neutral-bg hover:underline">
                  Sign out ▸
                </button>
              </form>
            )}
          </div>

          <nav className="py-2">
            <Link
              href={basePath}
              className={`block px-4 py-2.5 text-sm font-bold ${
                pathname === basePath ? "bg-header text-brand" : "text-ink-soft hover:bg-cream"
              }`}
            >
              HOME
            </Link>

            {resolvedSections.map((section) => {
              const isOpen = openSections.has(section.label);
              const hasLeaves = section.leaves.length > 0;
              return (
                <div key={section.label} className="border-t border-border">
                  <button
                    onClick={() => hasLeaves && toggle(section.label)}
                    className="flex w-full items-center justify-between bg-[#eef1f7] px-4 py-2.5 text-left text-[12.5px] font-bold uppercase tracking-wide text-ink-soft hover:bg-[#e4e9f2]"
                  >
                    {section.label}
                    {hasLeaves && <span className="text-muted">{isOpen ? "−" : "+"}</span>}
                  </button>
                  {hasLeaves && isOpen && (
                    <div className="pb-1">
                      {section.leaves.map((leaf) => (
                        <Link
                          key={leaf.href}
                          href={leaf.href}
                          className={`block px-7 py-1.5 text-[13px] font-semibold ${
                            pathname === leaf.href ? "text-brand" : "text-brand/80 hover:text-brand"
                          }`}
                        >
                          {leaf.label} ▸
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>

      <SiteFooter />
    </div>
  );
}
