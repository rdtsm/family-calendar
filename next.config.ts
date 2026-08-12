import type { NextConfig } from "next";

/**
 * The app loads nothing from anywhere else — no CDN, no web fonts, no icon
 * library, no analytics — so a restrictive policy costs nothing and blocks
 * both the loading of foreign script and the exfiltration of anything to a
 * foreign host. `unsafe-inline` for script is Next.js's hydration payload;
 * removing it needs per-request nonces, which is a separate change.
 */
// Next.js's development bundler evaluates modules with eval() for hot reload.
// Production builds do not, so the relaxation is scoped to development only —
// otherwise the client bundle never runs and nothing on the page is interactive.
const devEval = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${devEval}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // A child's token lives in the URL path, so it must never travel off-site in
  // a Referer header. Not `no-referrer`: that makes browsers send `Origin: null`,
  // which breaks Next.js server actions, since they validate the origin.
  // `same-origin` sends nothing cross-origin, which is the property we need.
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  // Deliberately without includeSubDomains: this app should not dictate
  // transport policy for any other host on the domain it sits under.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  // Neither app should ever be indexed: one is a login, the others are tokens.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const config: NextConfig = {
  // Next advertises itself by default; there is no reason to.
  poweredByHeader: false,

  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/sw.js",
        headers: [
          ...securityHeaders,
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default config;
