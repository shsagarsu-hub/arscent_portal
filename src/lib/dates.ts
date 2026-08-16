export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function thisMonthISO() {
  return new Date().toISOString().slice(0, 7);
}

/** [start, exclusiveEnd) ISO date bounds for the given YYYY-MM month string. */
export function monthBounds(monthISO: string) {
  const [y, m] = monthISO.split("-").map(Number);
  const start = `${monthISO}-01`;
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { start, end: `${nextMonth}-01` };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return "";
  const p = iso.split("-");
  if (p.length !== 3) return iso;
  return `${p[2]}-${MONTHS[parseInt(p[1], 10) - 1]}-${p[0].slice(2)}`;
}
