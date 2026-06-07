"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BookOpen, Lock, Unlock } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";

const fadeInUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0 },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.15, delayChildren: 0.2 },
  },
};

const scaleIn = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: { opacity: 1, scale: 1 },
};

interface ResourceItem {
  slug: string;
  title: string;
  summary: string;
  iconUrl?: string;
}

export default function ResourcesSection() {
  const t = useTranslations("Resources");
  const locale = useLocale();
  const [items, setItems] = useState<ResourceItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/content/resource?locale=${locale}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { items: ResourceItem[] };
        if (!cancelled) setItems(data.items);
      } catch (err) {
        console.error("Failed to load resources:", err);
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  return (
    <section id="resources" className="py-20 bg-muted">
      <div className="container mx-auto px-6">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={staggerContainer}
          className="max-w-7xl mx-auto"
        >
          {/* Section Header */}
          <div className="text-center mb-16">
            <motion.div
              variants={fadeInUp}
              transition={{ duration: 0.6 }}
              className="mb-4 flex flex-col items-center gap-3"
            >
              <p className="text-sm md:text-base tracking-[0.3em] uppercase text-muted-foreground font-light mb-2">
                {t("badge")}
              </p>
              <span className="rounded-full border border-amber-300/60 bg-amber-100/60 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                {t("comingSoon")}
              </span>
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
              className="text-base md:text-lg lg:text-xl text-muted-foreground max-w-3xl mx-auto font-light leading-relaxed"
            >
              {t("subtitle")}
            </motion.p>
          </div>

          {/* Free Resources */}
          {items && items.length > 0 ? (
            <motion.div
              variants={fadeInUp}
              transition={{ duration: 0.6 }}
              className="mb-12"
            >
              <div className="flex items-center justify-center gap-2 mb-8">
                <Unlock className="w-5 h-5 text-primary" />
                <h3 className="text-2xl font-serif font-light text-foreground">
                  {t("freeAccessTitle")}
                </h3>
              </div>

              <motion.div
                variants={staggerContainer}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"
              >
                {items.map((resource) => (
                  <motion.div
                    key={resource.slug}
                    variants={scaleIn}
                    transition={{ duration: 0.5 }}
                    whileHover={{ y: -5, transition: { duration: 0.2 } }}
                    className="p-6 rounded-xl bg-card/50 backdrop-blur-sm hover:bg-card transition-all duration-300"
                  >
                    <div className="mb-4">
                      {resource.iconUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={resource.iconUrl}
                          alt=""
                          className="w-12 h-12 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                          <BookOpen className="w-6 h-6" />
                        </div>
                      )}
                    </div>
                    <h4 className="text-lg font-light text-foreground mb-3">
                      {resource.title}
                    </h4>
                    <p className="text-muted-foreground text-sm leading-relaxed font-light">
                      {resource.summary}
                    </p>
                  </motion.div>
                ))}
              </motion.div>
            </motion.div>
          ) : null}

          {/* Premium Resources CTA */}
          <motion.div
            variants={fadeInUp}
            transition={{ duration: 0.6 }}
            className="bg-linear-to-br from-primary/10 to-accent/10 rounded-2xl p-8 md:p-12"
          >
            <div className="flex flex-col md:flex-row items-center gap-6">
              <div className="shrink-0">
                <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
                  <Lock className="w-10 h-10 text-primary" />
                </div>
              </div>
              <div className="flex-1 text-center md:text-left">
                <h3 className="text-2xl font-serif font-light text-foreground mb-3">
                  {t("premiumTitle")}
                </h3>
                <p className="text-base md:text-lg text-muted-foreground leading-relaxed font-light mb-6">
                  {t("premiumDesc")}
                </p>
                <span className="inline-flex items-center rounded-full border border-amber-300/60 bg-amber-100/60 px-4 py-2 text-sm font-semibold uppercase tracking-wider text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                  {t("comingSoon")}
                </span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
