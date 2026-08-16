import type { OrderType } from "@/lib/supabase/database.types";

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
