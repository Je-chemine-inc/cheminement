"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import ScrollReveal from "@/components/ui/ScrollReveal";

export default function ClientHeroSection() {
  const t = useTranslations("ClientHero");

  return (
    <section className="relative h-screen flex items-center justify-center bg-accent overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-5"></div>

      <div className="container mx-auto px-6 pt-20 pb-8 relative z-10">
        <div className="max-w-5xl mx-auto text-center">
          {/* Top Tagline */}
          <ScrollReveal variant="fade-down" duration={700}>
            <div className="mb-4">
              <p className="text-sm md:text-base tracking-[0.3em] uppercase text-muted-foreground font-light mb-2">
                {t("tagline")}
              </p>
              <div className="w-32 h-0.5 bg-muted-foreground mx-auto"></div>
            </div>
          </ScrollReveal>

          {/* Main Headline */}
          <ScrollReveal variant="blur-in" delayMs={150} duration={800}>
            <h1 className="text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-serif font-light text-foreground mb-8 leading-tight">
              {t("headline")}
            </h1>
          </ScrollReveal>

          {/* Description */}
          <ScrollReveal variant="fade-up" delayMs={300} duration={700}>
            <p className="text-base md:text-lg lg:text-xl text-muted-foreground max-w-4xl mx-auto mb-8 leading-relaxed font-light">
              {t("description")}
            </p>
          </ScrollReveal>

          {/* CTA Buttons */}
          <ScrollReveal variant="zoom-in" delayMs={450} duration={600}>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/appointment"
                className="group relative px-10 py-5 bg-primary text-primary-foreground rounded-full text-lg font-light tracking-wide overflow-hidden transition-all duration-300 hover:scale-105 hover:shadow-2xl"
              >
                <span className="relative z-10">{t("bookAppointment")}</span>
                <div className="absolute inset-0 bg-primary/80 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"></div>
              </Link>

              <Link
                href="/book#resources"
                className="group flex items-center gap-3 px-8 py-5 text-foreground text-lg font-light tracking-wide transition-all duration-300 hover:gap-4 border border-muted-foreground/20 rounded-full hover:bg-muted/50"
              >
                <span>{t("exploreResources")}</span>
              </Link>
            </div>
          </ScrollReveal>

          {/* Additional Info Tags */}
          <ScrollReveal variant="swing-in" delayMs={600} duration={700}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-accent"></div>
                <span>{t("fastAccess")}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-accent"></div>
                <span>{t("remoteInPerson")}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-accent"></div>
                <span>{t("confidentialSupport")}</span>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}
