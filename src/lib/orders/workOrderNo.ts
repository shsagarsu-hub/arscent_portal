/**
 * A human-shareable work order number, derived purely from the order's own
 * id + created_at -- no dedicated database column or sequence needed. Same
 * inputs always produce the same number, so it's safe to compute wherever
 * an order is displayed (list views, emails) without persisting anything.
 * Format: WO-YYYYMMDD-XXXXXX (last 6 hex chars of the uuid, uppercased).
 */
export function workOrderNo(orderId: string, createdAt: string): string {
  const d = new Date(createdAt);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const suffix = orderId.replace(/-/g, "").slice(-6).toUpperCase();
  return `WO-${yyyy}${mm}${dd}-${suffix}`;
}
