import Link from "next/link";

const ORDER_LINKS = [
  { slug: "saleable", label: "Saleable Order" },
  { slug: "capital-sales", label: "Capital Sales Order" },
  { slug: "direct-ship", label: "Direct Ship Order" },
  { slug: "export", label: "Export Order" },
  { slug: "sales-return", label: "Sales Return Order" },
  { slug: "long-term-consignment", label: "Long Term Consignment Order" },
  { slug: "consignment-consumption", label: "Long Term Consignment Consumption Order" },
  { slug: "short-term-consignment", label: "Short Term Consignment Order Entry" },
];

export function OrdersHome({ base }: { base: string }) {
  return (
    <div>
      <h1 className="mb-6 text-xl font-extrabold text-ink">Order Management</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {ORDER_LINKS.map((o) => (
          <Link
            key={o.slug}
            href={`${base}/${o.slug}`}
            className="card block transition-colors hover:border-brand/50"
          >
            <h3 className="text-[14.5px] font-extrabold text-ink">{o.label}</h3>
          </Link>
        ))}
        <Link
          href={`${base}/enquiry`}
          className="card block transition-colors hover:border-brand/50"
        >
          <h3 className="text-[14.5px] font-extrabold text-ink">Order Enquiry</h3>
        </Link>
      </div>
    </div>
  );
}
