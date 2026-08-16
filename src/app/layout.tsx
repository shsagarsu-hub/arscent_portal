import type { Metadata } from "next";
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
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full antialiased ${inter.variable}`}>
      <body className="min-h-full flex flex-col bg-cream">{children}</body>
    </html>
  );
}
