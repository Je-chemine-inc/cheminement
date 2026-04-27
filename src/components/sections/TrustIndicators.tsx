"use client";

import { useTranslations } from "next-intl";
import { ShieldCheck, Globe, Lock, Fingerprint } from "lucide-react";
import ScrollReveal from "@/components/ui/ScrollReveal";

export default function TrustIndicators() {
  const t = useTranslations("HeroSection.trustIcons");

  const indicators = [
    {
      icon: ShieldCheck,
      text: t("bill25"),
    },
    {
      icon: Globe,
      text: t("canadaHosting"),
    },
    {
      icon: Lock,
      text: t("encryption"),
    },
    {
      icon: Fingerprint,
      text: t("twoFactor"),
    },
  ];

  return (
    <section className="bg-background py-12 border-y border-muted/30">
      <div className="container mx-auto px-6 max-w-7xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {indicators.map((item, index) => (
            <ScrollReveal 
              key={index} 
              variant="fade-up" 
              delayMs={index * 100} 
              duration={600}
            >
              <div className="flex items-center gap-4 group justify-center sm:justify-start">
                <div className="p-3 rounded-2xl bg-muted/50 border border-muted-foreground/10 group-hover:bg-primary/5 group-hover:border-primary/20 transition-all duration-300">
                  <item.icon className="h-6 w-6 text-primary" strokeWidth={1.5} />
                </div>
                <p className="text-sm md:text-base font-light text-muted-foreground leading-snug group-hover:text-foreground transition-colors duration-300">
                  {item.text}
                </p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
