import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  /* config options here */
  // The WHC CI build ships a standalone server (STANDALONE_BUILD=1); a plain
  // local `pnpm build` skips it. Production is self-hosted — there is no Vercel.
  output: process.env.STANDALONE_BUILD === "1" ? "standalone" : undefined,
  reactCompiler: true,
  /** TLS 1.2+ is terminated by Apache on the WHC VPS, which reverse-proxies to
   *  127.0.0.1:3000. Headers below enforce browser-side protections. */
  async headers() {
    const securityHeaders = [
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      },
      {
        key: "X-Frame-Options",
        value: "DENY",
      },
      {
        key: "X-Content-Type-Options",
        value: "nosniff",
      },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=(self)",
      },
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://maps.googleapis.com",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' data: blob: https://images.unsplash.com https://api.dicebear.com",
          // The embedded players of /medias and of products (the list in
          // PRODUCT_FRAME_HOSTS, src/lib/product-rules.ts — keep them together).
          // Without them production blocked every video and podcast embed.
          "frame-src https://js.stripe.com https://hooks.stripe.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.dailymotion.com https://www.loom.com https://open.spotify.com https://embed.podcasts.apple.com https://w.soundcloud.com",
          "connect-src 'self' https://api.stripe.com https://maps.googleapis.com",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "upgrade-insecure-requests",
        ].join("; "),
      },
    ];

    if (process.env.NODE_ENV !== "production") {
      return [
        {
          source: "/:path*",
          headers: securityHeaders.filter(
            (h) =>
              h.key !== "Strict-Transport-Security" &&
              h.key !== "Content-Security-Policy",
          ),
        },
      ];
    }

    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  images: {
    // Next 16 only serves the qualities named here. 75 is its default; 90 is for a professional's
    // portrait on their page, where the photo has a cut-out edge that a harder re-encode frays.
    qualities: [75, 90],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "api.dicebear.com",
        port: "",
        pathname: "/**",
      },
    ],
  },
};

export default withNextIntl(nextConfig);
