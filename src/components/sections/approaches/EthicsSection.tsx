"use client";

import {
  ShieldCheck,
  LockKeyhole,
  ClipboardCheck,
  Scale,
  Server,
  MapPin,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import ScrollReveal from "@/components/ui/ScrollReveal";
import type { AnimationVariant } from "@/components/ui/ScrollReveal";

export default function EthicsSection() {
  const t = useTranslations("Approaches.ethics");

  const commitments = [
    {
      icon: ShieldCheck,
      title: t("commitments.ethics.title"),
      description: t("commitments.ethics.description"),
    },
    {
      icon: ClipboardCheck,
      title: t("commitments.law25.title"),
      description: t("commitments.law25.description"),
    },
    {
      icon: LockKeyhole,
      title: t("commitments.security.title"),
      description: t("commitments.security.description"),
    },
    {
      icon: Scale,
      title: t("commitments.confidentiality.title"),
      description: t("commitments.confidentiality.description"),
    },
  ];

  const securityHighlights = [
    {
      icon: MapPin,
      title: t("securityHighlights.canadianHosting.title"),
      description: t("securityHighlights.canadianHosting.description"),
    },
    {
      icon: Server,
      title: t("securityHighlights.encryption.title"),
      description: t("securityHighlights.encryption.description"),
    },
  ];

  return (
    <section className="relative overflow-hidden bg-background py-24">
      <div className="absolute inset-0 opacity-[0.06]">
        <div className="absolute left-0 top-10 h-72 w-72 -translate-x-1/3 rounded-full bg-primary blur-3xl" />
        <div className="absolute right-0 bottom-0 h-112 w-md translate-x-1/4 translate-y-1/3 rounded-full bg-accent blur-3xl" />
      </div>

      <div className="container relative z-10 mx-auto px-6">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <ScrollReveal variant="slide-right" duration={800}>
            <div className="space-y-6">
              <p className="text-sm uppercase tracking-[0.35em] text-muted-foreground/70">
                {t("badge")}
              </p>
              <h2 className="font-serif text-3xl font-medium leading-tight text-foreground md:text-4xl">
                {t("title")}
              </h2>
              <p className="text-base leading-relaxed text-muted-foreground">
                {t("description")}
              </p>
              <div className="rounded-3xl bg-muted/40 p-6 text-sm leading-relaxed text-muted-foreground">
                {t("note")}
              </div>

              {/* Canadian Hosting & Security Highlights */}
              <div className="space-y-4 pt-4">
                {securityHighlights.map(
                  ({ icon: Icon, title, description }, index) => (
                    <ScrollReveal
                      key={title}
                      variant="zoom-in"
                      delayMs={200 + index * 100}
                      duration={600}
                    >
                      <div className="flex items-start gap-4 rounded-2xl border border-primary/20 bg-primary/5 p-4">
                        <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="font-serif text-base font-medium text-foreground">
                            {title}
                          </h4>
                          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                            {description}
                          </p>
                        </div>
                      </div>
                    </ScrollReveal>
                  ),
                )}
              </div>
            </div>
          </ScrollReveal>

          <div className="grid gap-6 sm:grid-cols-2 items-stretch">
            {commitments.map(({ icon: Icon, title, description }, index) => {
              const cardAnimations: AnimationVariant[] = [
                "fade-right",
                "zoom-in",
                "fade-left",
                "slide-up",
              ];
              return (
                <ScrollReveal
                  key={title}
                  variant={cardAnimations[index % cardAnimations.length]}
                  delayMs={400 + index * 100}
                  duration={700}
                  className="flex h-full"
                >
                  <div className="flex h-full w-full flex-col rounded-4xl border border-border/15 bg-card/85 p-6 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl">
                    <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-foreground text-card">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="mt-4 font-serif text-lg font-medium text-foreground">
                      {title}
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {description}
                    </p>
                  </div>
                </ScrollReveal>
              );
            })}
          </div>
        </div>
        <ScrollReveal variant="bounce-in" delayMs={800} duration={700}>
          <div className="mx-auto mt-12 flex max-w-4xl flex-col items-center justify-center gap-4 text-center sm:flex-row">
            <Link
              href="/appointment"
              className="inline-flex items-center justify-center rounded-full bg-foreground px-8 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary-foreground transition-all duration-300 hover:bg-primary hover:text-primary-foreground"
            >
              Prendre rendez-vous
            </Link>
            <Link
              href="/professional"
              className="inline-flex items-center justify-center rounded-full border border-border px-8 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-foreground transition-all duration-300 hover:border-primary hover:text-primary"
            >
              Rejoindre l'espace
            </Link>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
