export function SaleablePlaceholder() {
  return (
    <div>
      <h1 className="mb-1 text-xl font-extrabold text-ink">Saleable Order</h1>
      <p className="mb-6 text-sm text-muted">Shipment Detail</p>
      <div className="card max-w-xl">
        <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">Not built yet</h3>
        <p className="text-xs text-muted">
          The Consignment Order screen is the working preview for this pass — Saleable Order will
          follow the same Shipment Detail + Add Product pattern once we confirm it against a real
          orders data model.
        </p>
      </div>
    </div>
  );
}
