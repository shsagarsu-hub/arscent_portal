import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrdersShell, type NavSection } from "@/components/orders/OrdersShell";

const BASE = "/manager/orders";

const SECTIONS: NavSection[] = [
  {
    label: "Order Management",
    leaves: [
      { label: "Saleable Order", href: `${BASE}/saleable` },
      { label: "Capital Sales Order", href: `${BASE}/capital-sales` },
      { label: "Direct Ship Order", href: `${BASE}/direct-ship` },
      { label: "Export Order", href: `${BASE}/export` },
      { label: "Sales Return Order", href: `${BASE}/sales-return` },
      { label: "Long Term Consignment Order", href: `${BASE}/long-term-consignment` },
      { label: "Long Term Consignment Consumption Order", href: `${BASE}/consignment-consumption` },
      { label: "Order Enquiry", href: `${BASE}/enquiry` },
      { label: "Draft Manager", href: `${BASE}/drafts` },
      { label: "Template Manager", href: `${BASE}/templates` },
    ],
  },
  {
    label: "Short Term Consignment Management",
    leaves: [
      { label: "Short Term Consignment Order Entry", href: `${BASE}/short-term-consignment` },
      { label: "Short Term Consignment Order Enquiry", href: `${BASE}/short-term-consignment/enquiry` },
    ],
  },
  { label: "Reports", leaves: [{ label: "Reports", href: `${BASE}/reports` }] },
  {
    label: "Secondary Sales Reporting",
    leaves: [{ label: "Secondary Sales Reporting", href: `${BASE}/secondary-sales` }],
  },
  { label: "Self Service", leaves: [{ label: "Self Service", href: `${BASE}/self-service` }] },
];

export default async function OrdersLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.role === "hospital") redirect("/");

  return (
    <OrdersShell userName={profile.full_name || user.email || "Account Manager"} basePath={BASE} sections={SECTIONS}>
      {children}
    </OrdersShell>
  );
}
