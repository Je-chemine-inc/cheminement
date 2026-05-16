"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Layers, ArrowRight } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import ScrollReveal from "@/components/ui/ScrollReveal";
import type { AnimationVariant } from "@/components/ui/ScrollReveal";

interface TraitementDTO {
  slug: string;
  title: string;
  summary: string;
  iconUrl?: string;
}

export default function ClinicalApproachesSection() {
  const t = useTranslations("Approaches.clinicalApproaches");
  const locale = useLocale();
  const [traitements, setTraitements] = useState<TraitementDTO[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/content/traitement?locale=${locale}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { items: TraitementDTO[] };
        if (!cancelled) setTraitements(data.items);
      } catch (err) {
        console.error("Failed to load traitements:", err);
        if (!cancelled) setTraitements([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const cardAnimations: AnimationVariant[] = [
    "fade-right",
    "zoom-in",
    "fade-left",
    "slide-up",
    "rotate-in",
    "blur-in",
    "swing-in",
    "bounce-in",
  ];

  const otherItems = (() => {
    try {
      return t.raw("otherApproaches.items") as string[];
    } catch {
      return [];
    }
  })();

  return (
    <section className="relative overflow-hidden bg-linear-to-b from-muted via-muted to-muted py-24">
      <div className="absolute inset-0 opacity-[0.08]">
        <div className="absolute left-0 top-24 h-72 w-72 -translate-x-1/3 rounded-full bg-primary blur-3xl animate-float" />
        <div className="absolute right-0 bottom-0 h-104 w-104 translate-x-1/3 translate-y-1/3 rounded-full bg-accent blur-3xl" />
      </div>

      <div className="container relative z-10 mx-auto px-6">
        <ScrollReveal variant="blur-in" duration={700}>
          <div className="mx-auto max-w-5xl text-center">
            <p className="text-sm uppercase tracking-[0.35em] text-muted-foreground/70">
              {t("badge")}
            </p>
            <h2 className="mt-4 font-serif text-3xl font-medium leading-tight text-foreground md:text-4xl">
              {t("title")}
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
              {t("description")}
            </p>
          </div>
        </ScrollReveal>

        <ScrollReveal variant="zoom-in" delayMs={200} duration={800}>
          <div className="mt-12 mx-auto max-w-4xl">
            <div className="relative aspect-21/9 rounded-3xl overflow-hidden shadow-xl">
              <Image
                src="/CognitiveBehavioralTherapy.jpg?v=2"
                alt={t("imageAlt")}
                fill
                className="object-cover"
                unoptimized
              />
            </div>
          </div>
        </ScrollReveal>

        {traitements && traitements.length > 0 ? (
          <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3 items-stretch">
            {traitements.map((traitement, index) => (
              <ScrollReveal
                key={traitement.slug}
                variant={cardAnimations[index % cardAnimations.length]}
                delayMs={400 + index * 100}
                duration={700}
              >
                <Link
                  href={`/approaches/${traitement.slug}`}
                  className="group relative flex h-full min-h-[260px] flex-col overflow-hidden rounded-4xl border border-border/15 bg-card/85 p-6 text-left shadow-lg transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl"
                >
                  <div className="absolute inset-0 bg-linear-to-tr from-primary/15 via-transparent to-accent/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                  <div className="relative z-10 flex h-full flex-col space-y-4">
                    {traitement.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={traitement.iconUrl}
                        alt=""
                        className="h-11 w-11 rounded-2xl object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-foreground text-card">
                        <Layers className="h-5 w-5" />
                      </div>
                    )}
                    <h3 className="font-serif text-lg font-medium text-foreground line-clamp-2">
                      {traitement.title}
                    </h3>
                    <p className="flex-1 text-sm leading-relaxed text-muted-foreground line-clamp-4">
                      {traitement.summary}
                    </p>
                    <span className="inline-flex items-center gap-1 text-sm font-light text-primary transition-colors group-hover:text-primary/80">
                      {t("learnMore")}
                      <ArrowRight className="h-4 w-4" />
                    </span>
                  </div>
                </Link>
              </ScrollReveal>
            ))}
          </div>
        ) : null}

        {otherItems.length > 0 ? (
          <ScrollReveal variant="swing-in" delayMs={1100} duration={700}>
            <div className="mx-auto mt-10 max-w-4xl rounded-4xl border border-dashed border-primary/30 bg-card/70 p-8 text-center shadow-inner">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                {t("otherApproaches.title")}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground">
                {otherItems.map((item: string) => (
                  <span
                    key={item}
                    className="rounded-full border border-border/30 bg-muted/40 px-4 py-2"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </ScrollReveal>
        ) : null}
      </div>
    </section>
  );
}
