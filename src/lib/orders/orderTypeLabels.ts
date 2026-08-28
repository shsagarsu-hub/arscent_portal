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

// The five OrderStatus values are the same for every order type, but
// "confirmed"/"shipped" read as jargon on their own -- for a consignment
// order specifically they mark the two real milestones between placing the
// order and DC'ing it (raising a PO with Zeiss, then the shipment actually
// being in transit), so labeling them that way here beats leaving the raw
// enum value on screen.
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  submitted: "Submitted",
  confirmed: "PO Raised",
  shipped: "In Transit",
  closed: "Closed",
  cancelled: "Cancelled",
};
