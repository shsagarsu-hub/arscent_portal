import Image from "next/image";

const ASPECT = 202 / 95;

export function Wordmark({ size = "md" }: { size?: "md" | "lg" }) {
  const height = size === "lg" ? 56 : 28;
  const width = Math.round(height * ASPECT);
  const pad = size === "lg" ? "p-2" : "p-1";

  return (
    <span className={`inline-flex items-center rounded-[3px] bg-white ${pad}`}>
      <Image
        src="/arscent-logo.jpg"
        alt="Arscent Health Services Pvt Ltd."
        width={width}
        height={height}
        priority
        className="object-contain"
      />
    </span>
  );
}
