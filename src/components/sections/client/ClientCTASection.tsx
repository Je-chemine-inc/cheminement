"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";

const fadeInUp = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
  },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
      delayChildren: 0.2,
    },
  },
};

export default function ClientCTASection() {
  const t = useTranslations("ClientCTA");
  const locale = useLocale();

  const quickFacts = [
    { en: "Personalized matching", fr: "Jumelage personnalisé" },
    { en: "Flexible scheduling", fr: "Horaire flexible" },
    { en: "Secure & confidential", fr: "Sécurisé et confidentiel" },
    {
      en: "Remote & in-person options",
      fr: "Options à distance et en personne",
    },
  ];

  return (
    <section className="py-20 bg-accent relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 opacity-5"></div>

      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-100px" }}
        variants={staggerContainer}
        className="container mx-auto px-6 relative z-10"
      >
        <div className="max-w-4xl mx-auto text-center">
          {/* Main CTA Content */}
          <motion.div
            variants={fadeInUp}
            transition={{ duration: 0.6 }}
            className="mb-4"
          >
            <p className="text-sm md:text-base tracking-[0.3em] uppercase text-muted-foreground font-light mb-2">
              {t("badge")}
            </p>
            <div className="w-32 h-0.5 bg-muted-foreground mx-auto"></div>
          </motion.div>

          <motion.h2
            variants={fadeInUp}
            transition={{ duration: 0.6 }}
            className="text-3xl md:text-4xl lg:text-5xl font-serif font-light text-foreground mb-6"
          >
            {t("title")}
          </motion.h2>

          <motion.p
            variants={fadeInUp}
            transition={{ duration: 0.6 }}
            className="text-base md:text-lg lg:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto font-light leading-relaxed"
          >
            {t("description")}
          </motion.p>

          {/* Quick Facts */}
          <motion.div
            variants={staggerContainer}
            className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10"
          >
            {quickFacts.map((fact, index) => (
              <motion.div
                key={index}
                variants={fadeInUp}
                transition={{ duration: 0.6 }}
                className="flex items-center justify-center gap-2 text-sm md:text-base text-foreground font-light"
              >
                <div className="w-2 h-2 rounded-full bg-accent shrink-0"></div>
                <span>{locale === "fr" ? fact.fr : fact.en}</span>
              </motion.div>
            ))}
          </motion.div>

          {/* CTA Buttons */}
          <motion.div
            variants={fadeInUp}
            transition={{ duration: 0.6 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
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
              <span>{t("browseResources")}</span>
            </Link>
          </motion.div>

          {/* Additional Info */}
          <motion.p
            variants={fadeInUp}
            transition={{ duration: 0.6 }}
            className="mt-8 text-sm text-muted-foreground font-light"
          >
            {t("helpText")}
          </motion.p>
        </div>
      </motion.div>
    </section>
  );
}
