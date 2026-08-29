import type { OrderStatus, OrderType } from "@/lib/supabase/database.types";

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  saleable: "Saleable",
  capital_sales: "Capital Sales",
  direct_ship: "Direct Ship",
  export: "Export",
  sales_return: "Sales Return",
  long_term_consignment: "Long Term Consignment",
  long_term_consignment_consumption: "LT Consignment Consumption",
  short_term_consignment: "Short Term Consignment",
  short_term_consignment_consumption: "ST Consignment Consumption",
};

// "confirmed"/"shipped" are the older two-step lifecycle (PO Raised / In
// Transit) kept only so historical orders still render a real label --
// every order placed since the lifecycle expanded uses the newer, more
// granular statuses below instead.
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  submitted: "Submitted",
  confirmed: "PO Raised",
  shipped: "In Transit",
  ordered: "Ordered",
  received_to_arscent: "Received to Arscent",
  sent_to_hospital: "Sent to Hospital",
  delivered: "Delivered",
  closed: "Closed",
  cancelled: "Cancelled",
};

// The manually-settable subset for the status dropdown -- "closed" is
// reached automatically (an invoice attached, or every consignment usage
// line billed), never picked directly, so it's excluded here on purpose.
export const SETTABLE_ORDER_STATUSES: OrderStatus[] = [
  "submitted",
  "ordered",
  "received_to_arscent",
  "sent_to_hospital",
  "delivered",
  "cancelled",
];
