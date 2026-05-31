"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { MessageCircle, Mail, Phone } from "lucide-react";
import { formatCanadianPhone } from "@/lib/format-platform-contact";

type PlatformContact = {
  physicalAddress: {
    street?: string;
    suite?: string;
    city?: string;
    province?: string;
    postalCode?: string;
    country?: string;
  };
  phoneNumber: string;
  supportEmail: string;
  interacDepositEmail: string;
};

/**
 * Support contact card grid (chat / email / phone) shared by the client and
 * professional help centers. Reads the canonical platform contact info from
 * /api/platform-contact and live-updates via SSE. Strings come from the
 * Dashboard.helpCenter namespace.
 */
export default function ContactSupportSection() {
  const t = useTranslations("Dashboard.helpCenter");
  const [contact, setContact] = useState<PlatformContact | null>(null);

  useEffect(() => {
    let active = true;

    const fetchOnce = () => {
      fetch("/api/platform-contact", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: PlatformContact | null) => {
          if (active && data) setContact(data);
        })
        .catch(() => {});
    };

    fetchOnce();

    let es: EventSource | null = null;
    if (typeof window !== "undefined" && "EventSource" in window) {
      es = new EventSource("/api/platform-contact/stream");
      es.addEventListener("contact", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data);
          if (active && data) setContact(data);
        } catch {
          /* ignore malformed payload */
        }
      });
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") fetchOnce();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      active = false;
      es?.close();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const supportEmail = contact?.supportEmail?.trim() || "support@jechemine.ca";
  const phoneNumber = formatCanadianPhone(contact?.phoneNumber);

  return (
    <section className="rounded-3xl border border-border/20 bg-card/80 p-8 shadow-lg">
      <h2 className="font-serif text-xl font-medium text-foreground mb-2">
        {t("contactTitle")}
      </h2>
      <p className="text-sm text-muted-foreground mb-6">
        {t("contactDescription")}
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        <div
          aria-disabled="true"
          className="flex items-center gap-3 rounded-2xl border border-border/20 bg-card/60 p-4 opacity-60 pointer-events-none"
        >
          <MessageCircle className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-foreground">{t("chat")}</p>
              <span className="rounded-full border border-amber-300/60 bg-amber-100/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                {t("chatComingSoon")}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{t("chatDesc")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-border/20 bg-card/60 p-4">
          <Mail className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-medium text-foreground">{t("email")}</p>
            <p className="text-xs text-muted-foreground break-all">
              {supportEmail}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-border/20 bg-card/60 p-4">
          <Phone className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-medium text-foreground">{t("phone")}</p>
            <p className="text-xs text-muted-foreground">
              {phoneNumber || t("phoneFallback")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
