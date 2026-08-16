export function ComingSoon({ title, note }: { title: string; note: string }) {
  return (
    <div>
      <h1 className="mb-6 text-xl font-extrabold text-ink">{title}</h1>
      <div className="card max-w-xl">
        <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">Not built yet</h3>
        <p className="text-xs text-muted">{note}</p>
      </div>
    </div>
  );
}
