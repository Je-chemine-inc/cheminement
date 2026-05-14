"use client";

import { SessionProvider } from "next-auth/react";
import { InactivityGuard } from "@/components/InactivityGuard";
import { CookieConsentBanner } from "@/components/CookieConsentBanner";
import { ConsentScripts } from "@/components/ConsentScripts";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <InactivityGuard />
      {children}
      <CookieConsentBanner />
      <ConsentScripts />
    </SessionProvider>
  );
}
