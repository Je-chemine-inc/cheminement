"use client";

import Link from "next/link";
import { ArrowRight, UserPlus, CalendarCheck, FileText, ShieldCheck, Globe, Lock, Fingerprint } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import ScrollReveal from "@/components/ui/ScrollReveal";
import type { AnimationVariant } from "@/components/ui/ScrollReveal";

export default function HowItWorksSection() {
  const t = useTranslations("HowItWorksSection");
  const locale = useLocale();

  const clientJourneySteps = [
    {
      icon: UserPlus,
      titleEn: "Create your profile",
      titleFr: "Créez votre profil",
      descriptionEn:
        "Sign up and tell us about your needs. Your information is secure and confidential.",
      descriptionFr:
        "Inscrivez-vous et parlez-nous de vos besoins. Vos informations sont sécurisées et confidentielles.",
      step: "01",
    },
    {
      icon: CalendarCheck,
      titleEn: "Get an appointment",
      titleFr: "Obtenez un rendez-vous",
      descriptionEn:
        "We match you with the right professional and schedule a session at a time that works for you.",
      descriptionFr:
        "Nous vous jumelons avec le bon professionnel et planifions une séance au moment qui vous convient.",
      step: "02",
    },
    {
      icon: FileText,
      titleEn: "Access content",
      titleFr: "Accédez au contenu",
      descriptionEn:
        "Explore educational resources on anxiety, stress, burnout and more while you wait for your first session.",
      descriptionFr:
        "Explorez des ressources éducatives sur l'anxiété, le stress, l'épuisement et plus encore en attendant votre première séance.",
      step: "03",
    },
  ];
  const cardAnimations: AnimationVariant[] = [
    "fade-right",
    "zoom-in",
    "fade-left",
  ];

  return (
    <section className="relative py-24 bg-linear-to-b from-background to-muted overflow-hidden">
      <div className="relative max-w-7xl mx-auto px-6">
        {/* Background decorative elements */}
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute top-0 left-1/4 w-72 h-72 bg-accent rounded-full opacity-5 blur-3xl animate-float"></div>
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-primary rounded-full opacity-5 blur-3xl"></div>
        </div>

        <ScrollReveal variant="fade-down" duration={700}>
          <div className="text-center mb-20">
            <div className="inline-block mb-6">
              <span className="text-sm font-bold text-primary uppercase tracking-widest">
                {t("badge")}
              </span>
            </div>
            <h3 className="text-4xl md:text-5xl font-serif font-bold text-foreground mb-6">
              {t("title")}
            </h3>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              {t("subtitle")}
            </p>
          </div>
        </ScrollReveal>

        <div className="relative">
          {/* Animated flowing line for desktop */}
          <div className="hidden lg:block absolute top-32 left-0 right-0 h-1 z-0">
            <div className="absolute inset-0 bg-linear-to-r from-transparent via-accent/20 to-transparent"></div>
            <div className="absolute left-[12.5%] right-[12.5%] h-full">
              <svg className="w-full h-full" preserveAspectRatio="none">
                <path
                  d="M 0 0.5 Q 25 0.5 50 0.5 T 100 0.5"
                  stroke="oklch(0.92 0.015 75)"
                  strokeWidth="2"
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                  strokeOpacity="0.7"
                />
              </svg>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-6">
            {clientJourneySteps.map((step, index) => (
              <ScrollReveal
                key={index}
                variant={cardAnimations[index % cardAnimations.length]}
                delayMs={index * 150}
                duration={700}
              >
                <div className="relative group">
                  {/* Card */}
                  <div className="relative bg-card rounded-3xl p-8 shadow-lg hover:shadow-2xl transition-all duration-500 hover:-translate-y-3 border border-border overflow-hidden group-hover:border-accent/30">
                    {/* Gradient overlay on hover */}
                    <div className="absolute inset-0 bg-linear-to-br from-accent/0 to-accent/0 group-hover:from-accent/5 group-hover:to-transparent transition-all duration-500 rounded-3xl"></div>

                    {/* Step Number - Large Background */}
                    <div className="absolute -top-6 -right-6 text-[120px] font-bold text-muted group-hover:text-accent transition-colors duration-500 select-none">
                      {step.step}
                    </div>

                    {/* Icon with no background */}
                    <div className="relative mb-6">
                      <div className="relative inline-flex">
                        <step.icon
                          className="w-16 h-16 text-primary group-hover:text-primary/80 group-hover:scale-110 transition-all duration-500"
                          strokeWidth={1.5}
                        />
                      </div>
                    </div>

                    {/* Content */}
                    <div className="relative">
                      <h4 className="text-xl md:text-2xl font-serif font-bold text-foreground mb-4 group-hover:text-primary transition-colors duration-300">
                        {locale === "fr" ? step.titleFr : step.titleEn}
                      </h4>
                      <p className="text-base text-muted-foreground leading-relaxed">
                        {locale === "fr"
                          ? step.descriptionFr
                          : step.descriptionEn}
                      </p>
                    </div>

                    {/* Arrow indicator for next step */}
                    {index < clientJourneySteps.length - 1 && (
                      <div className="hidden lg:flex absolute -right-8 top-1/2 -translate-y-1/2 z-20">
                        <div className="w-6 h-6 text-primary group-hover:translate-x-1 transition-transform duration-300">
                          <ArrowRight className="w-6 h-6" strokeWidth={2.5} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>

        {/* Bottom CTA */}
        <ScrollReveal variant="bounce-in" delayMs={600} duration={700}>
          <div className="text-center mt-16 pb-16 border-b border-muted-foreground/10">
            <p className="text-muted-foreground mb-6">{t("cta.question")}</p>
            <Link
              href="/signup"
              className="inline-flex items-center gap-3 bg-foreground text-primary-foreground px-8 py-4 rounded-full font-semibold hover:bg-primary transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 group"
            >
              <span>{t("cta.button")}</span>
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </ScrollReveal>

        {/* Trust Indicators moved here */}
        <div className="mt-16">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 max-w-xs mx-auto lg:max-w-none">
            <ScrollReveal variant="fade-up" delayMs={700} duration={600}>
              <div className="flex items-center gap-3">
                <div className="shrink-0 p-2.5 rounded-xl bg-primary/10 border border-primary/20">
                  <ShieldCheck className="h-5 w-5 text-primary" strokeWidth={1.5} />
                </div>
                <p className="text-sm font-light text-muted-foreground leading-snug">
                  {t("trustIcons.bill25")}
                </p>
              </div>
            </ScrollReveal>
            <ScrollReveal variant="fade-up" delayMs={800} duration={600}>
              <div className="flex items-center gap-3">
                <div className="shrink-0 p-2.5 rounded-xl bg-primary/10 border border-primary/20">
                  <Globe className="h-5 w-5 text-primary" strokeWidth={1.5} />
                </div>
                <p className="text-sm font-light text-muted-foreground leading-snug">
                  {t("trustIcons.canadaHosting")}
                </p>
              </div>
            </ScrollReveal>
            <ScrollReveal variant="fade-up" delayMs={900} duration={600}>
              <div className="flex items-center gap-3">
                <div className="shrink-0 p-2.5 rounded-xl bg-primary/10 border border-primary/20">
                  <Lock className="h-5 w-5 text-primary" strokeWidth={1.5} />
                </div>
                <p className="text-sm font-light text-muted-foreground leading-snug">
                  {t("trustIcons.encryption")}
                </p>
              </div>
            </ScrollReveal>
            <ScrollReveal variant="fade-up" delayMs={1000} duration={600}>
              <div className="flex items-center gap-3">
                <div className="shrink-0 p-2.5 rounded-xl bg-primary/10 border border-primary/20">
                  <Fingerprint className="h-5 w-5 text-primary" strokeWidth={1.5} />
                </div>
                <p className="text-sm font-light text-muted-foreground leading-snug">
                  {t("trustIcons.twoFactor")}
                </p>
              </div>
            </ScrollReveal>
          </div>
        </div>
      </div>
    </section>
  );
}
