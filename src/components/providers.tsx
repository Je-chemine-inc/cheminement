"use client";

import { SessionProvider } from "next-auth/react";
import { InactivityGuard } from "@/components/InactivityGuard";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <InactivityGuard />
      {children}
    </SessionProvider>
  );
}
