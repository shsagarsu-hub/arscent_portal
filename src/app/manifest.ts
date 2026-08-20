import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Arscent Order Management Portal",
    short_name: "Arscent OM",
    description: "Usage logging, billing, and account management for Arscent hospital partners.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f3ee",
    theme_color: "#2f5fc7",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
