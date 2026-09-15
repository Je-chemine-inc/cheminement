import { Suspense } from "react";
import type { Metadata } from "next";
import { RerouteDirectRequest } from "./RerouteDirectRequest";

/**
 * www/demande-directe/rejumeler?t= — where the client lands from the email sent
 * when a professional declined their showcase request, or did not answer in
 * time (spec 003 phase 3). Nothing happens on load, so a mail scanner opening
 * the link cannot use it: the client confirms with a button.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function RerouteDirectRequestPage() {
  return (
    <Suspense fallback={null}>
      <RerouteDirectRequest />
    </Suspense>
  );
}
