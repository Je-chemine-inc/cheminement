"use client";

import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Shown in place of a billing screen to an admin without « Gérer la
 * facturation » — when the menu hid it but the URL was typed, or when the
 * right was taken away while the page was open.
 */
export function BillingAccessRequired() {
  const t = useTranslations("AdminDashboard.billingAccess");
  return (
    <div className="mx-auto mt-10 max-w-lg rounded-xl border border-border/40 bg-card p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Lock className="h-6 w-6 text-muted-foreground" />
      </div>
      <h1 className="mb-2 font-serif text-xl font-light text-foreground">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("body")}</p>
    </div>
  );
}

/** The billing API refused this admin (signed out, or no billing right). */
export function isAccessDenied(status: number): boolean {
  return status === 401 || status === 403;
}

export class AccessDeniedError extends Error {}
