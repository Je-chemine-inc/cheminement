"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ResourcePaymentModal from "@/components/payments/ResourcePaymentModal";
import { formatCad } from "@/lib/format-currency";

/**
 * The buy CTA on /book/[slug].
 *
 * Exists only so the reader page can stay a server component: the paywall
 * decision, and therefore the paid content, is resolved on the server, and
 * this island carries nothing but the price and the slug.
 */
export default function ResourceBuyButton({
  slug,
  title,
  priceCents,
  isSignedIn,
  signedInEmail,
}: {
  slug: string;
  title: string;
  priceCents: number;
  isSignedIn: boolean;
  signedInEmail?: string;
}) {
  const t = useTranslations("BookResource");
  const locale = useLocale();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        {t("buyCta", { price: formatCad(priceCents, locale) })}
      </button>

      {/* Mounted lazily so Stripe.js is not pulled in for a visitor who never buys. */}
      {open ? (
        <ResourcePaymentModal
          open={open}
          onOpenChange={setOpen}
          slug={slug}
          title={title}
          priceCents={priceCents}
          isSignedIn={isSignedIn}
          signedInEmail={signedInEmail}
        />
      ) : null}
    </>
  );
}
