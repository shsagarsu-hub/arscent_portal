import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Replaces the previous Tahoma/Verdana system-font stack -- that read as an
// unstyled OS default rather than a designed product. Inter is loaded once
// here and referenced by --font-sans in globals.css so every component
// picks it up without individual changes.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Arscent — Account Management Portal",
  description: "Usage logging, billing, and account management for Arscent hospital partners.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  // Makes "Add to Home Screen" open as a standalone app on iOS -- Safari
  // ignores the manifest's display:"standalone" and only respects this.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Arscent OM",
  },
};

export const viewport: Viewport = {
  themeColor: "#2f5fc7",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full antialiased ${inter.variable}`}>
      <body className="min-h-full flex flex-col bg-cream">{children}</body>
    </html>
  );
}
