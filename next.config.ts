import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (Tally invoice PDF parsing) resolves its pdf.js worker file
  // via a runtime path relative to its own package directory. Bundling it
  // into the server chunk graph moves that file to a location the worker
  // lookup can't find ("Setting up fake worker failed") -- excluding it
  // keeps it as a native Node require, resolving from node_modules as-is.
  serverExternalPackages: ["pdf-parse"],
  // Without this, Turbopack walks up from the project looking for a
  // lockfile and can land on an unrelated one higher in the user's home
  // directory, which then makes it guess the wrong workspace root.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
