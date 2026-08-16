import Link from "next/link";

const ORDER_LINKS = [
  { slug: "saleable", label: "Saleable Order", desc: "Outright purchase, not tied to a consignment commitment." },
  { slug: "capital-sales", label: "Capital Sales Order", desc: "Capital equipment purchases (lasers, VISUMAX, etc.)." },
  { slug: "direct-ship", label: "Direct Ship Order", desc: "Ship straight from a third party rather than Arscent stock." },
  { slug: "export", label: "Export Order", desc: "Orders shipping outside India." },
  { slug: "sales-return", label: "Sales Return Order", desc: "Returned product against a prior order." },
  {
    slug: "long-term-consignment",
    label: "Long Term Consignment Order",
    desc: "Ship product against an account's consignment commitment — matches the NN1 / LVPEI agreements on file.",
  },
  {
    slug: "consignment-consumption",
    label: "Long Term Consignment Consumption Order",
    desc: "Retrieve consigned stock at a location and bill what's been consumed.",
  },
  {
    slug: "short-term-consignment",
    label: "Short Term Consignment Order Entry",
    desc: "Short-term consignment shipment, tracked separately from long-term commitments.",
  },
];

export function OrdersHome({ base }: { base: string }) {
  return (
    <div>
      <h1 className="mb-1 text-xl font-extrabold text-ink">Order Management</h1>
      <p className="mb-6 text-sm text-muted">
        Place and track orders against hospital accounts — consignment shipments and outright
        (saleable) purchases.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {ORDER_LINKS.map((o) => (
          <Link
            key={o.slug}
            href={`${base}/${o.slug}`}
            className="card block transition-colors hover:border-brand/50"
          >
            <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">{o.label}</h3>
            <p className="text-xs text-muted">{o.desc}</p>
          </Link>
        ))}
        <Link
          href={`${base}/enquiry`}
          className="card block transition-colors hover:border-brand/50"
        >
          <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">Order Enquiry</h3>
          <p className="text-xs text-muted">See every order that&apos;s been submitted.</p>
        </Link>
      </div>
    </div>
  );
}
