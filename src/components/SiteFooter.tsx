export function SiteFooter() {
  return (
    <div className="flex flex-col items-center justify-between gap-2 bg-ink px-6 py-3.5 text-[11px] text-white/60 sm:flex-row">
      <span>© {new Date().getFullYear()} Arscent Health Services Pvt Ltd.</span>
      <div className="flex gap-4">
        <span className="hover:text-white/90">Privacy Policy</span>
        <span className="hover:text-white/90">Terms Of Use</span>
      </div>
    </div>
  );
}
