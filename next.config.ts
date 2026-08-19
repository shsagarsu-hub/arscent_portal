import path from "node:path";
import type { NextConfig } from "next";

// Every fetch this app makes client-side goes to Supabase's REST/Auth API,
// same origin for every project (https://<ref>.supabase.co) -- allowing it
// here, not '*', keeps connect-src meaningful.
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : "";

// 'unsafe-inline' on script/style is broader than ideal -- Next.js injects
// inline hydration data via <script> tags (avoiding that needs a nonce
// wired through proxy.ts, a bigger change than a hardening pass warrants
// right now) and a handful of components use inline style={{}} props. Still
// meaningfully blocks the common XSS payload shape (loading a *remote*
// script/stylesheet from an attacker's domain), since only 'self' plus
// inline is allowed -- nothing external.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // pdf-parse (Tally invoice PDF parsing) resolves its pdf.js worker file
  // via a runtime path relative to its own package directory. Bundling it
  // into the server chunk graph moves that file to a location the worker
  // lookup can't find ("Setting up fake worker failed") -- excluding it
  // keeps it as a native Node require, resolving from node_modules as-is.
  // pdfkit's ESM entrypoint pulls in fontkit (custom-font embedding), which
  // imports an @swc/helpers export Turbopack's bundled version doesn't
  // provide ("applyDecoratedDescriptor doesn't exist") -- confirmed to break
  // the build. Excluding it from bundling, same fix as pdf-parse above,
  // resolves it as a plain Node require instead of going through Turbopack's
  // transform.
  serverExternalPackages: ["pdf-parse", "pdfkit"],
  // serverExternalPackages keeps pdf-parse un-bundled, but Vercel's own
  // file tracer still decides which files actually ship with the deployed
  // function, and it doesn't follow pdfjs-dist's (pdf-parse's own internal
  // dependency) dynamic worker import. Confirmed live in production:
  // "Setting up fake worker failed: Cannot find module
  // '/var/task/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
  // imported from .../pdfjs-dist/legacy/build/pdf.mjs" -- an earlier,
  // narrower version of this only included pdf-parse's own dist folder,
  // which doesn't contain pdfjs-dist at all (it's pdf-parse's dependency,
  // not pdf-parse itself), so the actual missing file was never covered.
  // pdfkit (Purchase Order PDF attachment) reads its standard-14 font
  // metrics via `fs.readFileSync(__dirname + '/data/*.afm')` at render time
  // -- a statically-concatenated path nft usually traces fine, but this repo
  // has already hit one nft miss on a sibling PDF library above, so this is
  // cheap insurance rather than a confirmed-necessary fix. The submitting
  // action isn't its own route (it's a "use server" action reached via
  // whatever page calls it), so '/*' -- the pattern Next's own docs give for
  // exactly this native/runtime-asset case -- covers it regardless of which
  // page that ends up being.
  outputFileTracingIncludes: {
    "/api/tally/parse": ["./node_modules/pdf-parse/dist/**/*", "./node_modules/pdfjs-dist/legacy/**/*"],
    "/*": ["./node_modules/pdfkit/js/data/**/*"],
  },
  // Without this, Turbopack walks up from the project looking for a
  // lockfile and can land on an unrelated one higher in the user's home
  // directory, which then makes it guess the wrong workspace root.
  turbopack: {
    root: path.join(__dirname),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
