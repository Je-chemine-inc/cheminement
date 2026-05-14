"use client";

import Script from "next/script";
import { useCookieConsent } from "@/lib/cookie-consent";

/**
 * Renders third-party scripts only after the user has granted consent for
 * the corresponding category. The mapping:
 *
 *   statistics → Google Analytics (gtag.js)
 *   marketing  → reserved for future marketing pixels (none today)
 *
 * Stripe.js and other strictly-necessary scripts are NOT loaded here — they
 * load on demand from the components that need them (payment pages).
 *
 * Enable Google Analytics by setting `NEXT_PUBLIC_GA_MEASUREMENT_ID` in the
 * environment. With no measurement ID configured, this component renders
 * nothing even if the user has accepted statistics cookies.
 */
export function ConsentScripts() {
  const consent = useCookieConsent();
  const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  const allowStatistics = consent?.categories.statistics === true;

  if (!allowStatistics || !gaId) return null;

  return (
    <>
      <Script
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${gaId}', { anonymize_ip: true });
        `}
      </Script>
    </>
  );
}
