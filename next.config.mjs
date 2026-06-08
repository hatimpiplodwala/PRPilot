import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === "production";

/**
 * Content Security Policy.
 *
 * 'unsafe-inline' in script-src/style-src is here because Next.js inlines its
 * runtime <script>/<style> tags and Tailwind ships inline styles. Migrating to
 * a nonce-based CSP is a worthwhile next step but requires plumbing the nonce
 * through every server component — out of scope here. This still blocks the
 * majority of XSS sinks (external eval, untrusted hosts, framing).
 *
 * Dev mode skips CSP entirely: Next's dev server needs 'unsafe-eval' for React
 * Refresh and emits debug WebSocket connections that a strict policy would
 * block.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // GitHub avatars (next-auth profile image), data: for inline SVG icons.
  "img-src 'self' data: https://avatars.githubusercontent.com https://github.com",
  "font-src 'self' data:",
  // Same-origin XHR/fetch only — Supabase/Gemini/GitHub are called server-side.
  "connect-src 'self'",
  // The sign-in form action posts to /api/auth/signin, which then 302s to
  // github.com for the OAuth dance. Form-action must include both.
  "form-action 'self' https://github.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  ...(isProd ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // HSTS only in prod: HSTS on localhost would brick local HTTP dev.
  ...(isProd
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
  // CSP only in prod (see comment on `csp` above).
  ...(isProd ? [{ key: "Content-Security-Policy", value: csp }] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Hide the Next.js dev indicator widget (bottom-corner logo).
  devIndicators: false,
  // Pin the workspace root (a stray lockfile in the home dir confuses inference).
  outputFileTracingRoot: __dirname,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
