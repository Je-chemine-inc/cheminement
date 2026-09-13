import { Suspense } from "react";
import type { Metadata } from "next";
import { LeaveWaitlist } from "./LeaveWaitlist";

/**
 * www/liste-attente/quitter?t= — the link in the waitlist confirmation email
 * (spec 003 phase 4). Nothing happens on load, so a mail scanner opening the
 * link cannot use it: the person confirms with a button.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function LeaveWaitlistPage() {
  return (
    <Suspense fallback={null}>
      <LeaveWaitlist />
    </Suspense>
  );
}
