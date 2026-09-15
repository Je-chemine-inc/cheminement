import { Suspense } from "react";
import type { Metadata } from "next";
import { ClaimWaitlistOffer } from "./ClaimWaitlistOffer";

/**
 * www/liste-attente/reclamer?t= — where a waitlist offer's email and text
 * message lead (spec 003 phase 4). Opening it only reads the offer, so a mail
 * scanner cannot use it; the person books with a button, within 15 minutes.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function ClaimWaitlistOfferPage() {
  return (
    <Suspense fallback={null}>
      <ClaimWaitlistOffer />
    </Suspense>
  );
}
