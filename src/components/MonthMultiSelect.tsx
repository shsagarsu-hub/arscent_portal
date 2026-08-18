"use client";

import { useEffect, useRef, useState } from "react";
import { thisMonthISO } from "@/lib/dates";

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

/** Ascending, oldest to newest -- `monthsBack`/`monthsForward` months either
 * side of the current month. */
function buildMonthOptions(monthsBack: number, monthsForward: number) {
  const now = new Date();
  const opts: string[] = [];
  for (let i = -monthsBack; i <= monthsForward; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    opts.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return opts;
}

/**
 * Multi-select month picker -- replaces a single `<input type="month">` or a
 * fixed set of trailing-window presets with an arbitrary set of specific
 * months. `months` is the source of truth (sorted YYYY-MM strings); an empty
 * array means "all time" when `allowAllTime` is set, otherwise at least one
 * month is always kept selected.
 */
export function MonthMultiSelect({
  months,
  onChange,
  dark = false,
  allowAllTime = false,
  monthsBack = 23,
  monthsForward = 5,
}: {
  months: string[];
  onChange: (months: string[]) => void;
  dark?: boolean;
  allowAllTime?: boolean;
  monthsBack?: number;
  monthsForward?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const options = buildMonthOptions(monthsBack, monthsForward);
  const selected = new Set(months);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function toggle(key: string) {
    const next = new Set(selected);
    if (next.has(key)) {
      if (!allowAllTime && next.size === 1) return; // always keep at least one month selected
      next.delete(key);
    } else {
      next.add(key);
    }
    onChange(Array.from(next).sort());
  }

  const label =
    months.length === 0 ? "All time" : months.length === 1 ? monthLabel(months[0]) : `${months.length} months selected`;

  const btnClass = dark
    ? "rounded-[6px] border-0 bg-white/15 px-2.5 py-1.5 text-[12px] font-semibold text-white outline-none [color-scheme:dark]"
    : "field-input !w-auto cursor-pointer !py-1.5 text-[12.5px] font-semibold";

  return (
    <div className="relative inline-block" ref={ref}>
      <button type="button" className={btnClass} onClick={() => setOpen((o) => !o)}>
        {label} <span className="opacity-70">▾</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 max-h-72 w-56 overflow-y-auto rounded-[6px] border border-border bg-card p-1.5 text-ink shadow-[0_8px_24px_rgba(23,37,68,0.16)]">
          <div className="mb-1 flex items-center gap-2 border-b border-border pb-1.5">
            <button
              type="button"
              className="rounded-[4px] px-1.5 py-1 text-[10.5px] font-bold text-brand hover:bg-cream"
              onClick={() => onChange([thisMonthISO()])}
            >
              This month only
            </button>
            {allowAllTime && (
              <button
                type="button"
                className={`rounded-[4px] px-1.5 py-1 text-[10.5px] font-bold hover:bg-cream ${
                  months.length === 0 ? "text-brand" : "text-ink-soft"
                }`}
                onClick={() => onChange([])}
              >
                All time
              </button>
            )}
          </div>
          {options.map((key) => (
            <label key={key} className="flex cursor-pointer items-center gap-2 rounded-[4px] px-2 py-1.5 text-[12px] hover:bg-cream">
              <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} />
              {monthLabel(key)}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
