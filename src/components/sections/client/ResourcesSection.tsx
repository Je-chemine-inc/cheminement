"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, BookOpen, Lock, PlayCircle, Podcast, Unlock } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { formatCad } from "@/lib/format-currency";
import type { MediaType } from "@/lib/content-kind";

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
  mediaType?: MediaType;
  isPremium?: boolean;
  priceCents?: number;
}

const MEDIA_ICON: Record<MediaType, typeof BookOpen> = {
  article: BookOpen,
  video: PlayCircle,
  podcast: Podcast,
};

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

  const free = items?.filter((i) => !i.isPremium) ?? [];
  const premium = items?.filter((i) => i.isPremium) ?? [];

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
              className="text-base md:text-lg lg:text-xl text-muted-foreground max-w-3xl mx-auto font-light leading-relaxed"
            >
              {t("subtitle")}
            </motion.p>
          </div>

          {/* Free Resources */}
          {free.length > 0 ? (
            <motion.div
              variants={fadeInUp}
              transition={{ duration: 0.6 }}
              className="mb-16"
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
                {free.map((resource) => (
                  <motion.div
                    key={resource.slug}
                    variants={scaleIn}
                    transition={{ duration: 0.5 }}
                    whileHover={{ y: -5, transition: { duration: 0.2 } }}
                  >
                    <Link
                      href={`/book/${resource.slug}`}
                      className="flex h-full flex-col p-6 rounded-xl bg-card/50 backdrop-blur-sm hover:bg-card transition-all duration-300"
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
                      <span className="mt-4 inline-flex items-center gap-1 text-sm text-primary">
                        {t("readMore")}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                    </Link>
                  </motion.div>
                ))}
              </motion.div>
            </motion.div>
          ) : null}

          {/* Premium Resources */}
          {items === null ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-80 animate-pulse rounded-2xl border border-primary/20 bg-card/50"
                />
              ))}
            </div>
          ) : premium.length > 0 ? (
            <motion.div variants={fadeInUp} transition={{ duration: 0.6 }}>
              <div className="flex items-center justify-center gap-2 mb-4">
                <Lock className="w-5 h-5 text-primary" />
                <h3 className="text-2xl font-serif font-light text-foreground">
                  {t("premiumAccessTitle")}
                </h3>
              </div>
              <p className="mx-auto mb-10 max-w-2xl text-center text-sm md:text-base font-light text-muted-foreground">
                {t("premiumIntro")}
              </p>

              <motion.div
                variants={staggerContainer}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
              >
                {premium.map((resource) => {
                  const Icon = MEDIA_ICON[resource.mediaType ?? "article"];
                  return (
                    <motion.div
                      key={resource.slug}
                      variants={scaleIn}
                      transition={{ duration: 0.5 }}
                      whileHover={{ y: -5, transition: { duration: 0.2 } }}
                    >
                      <Link
                        href={`/book/${resource.slug}`}
                        className="group flex h-full flex-col overflow-hidden rounded-2xl border border-primary/20 bg-card shadow-sm transition-all duration-300 hover:shadow-md"
                      >
                        <div className="relative aspect-video w-full overflow-hidden">
                          {resource.iconUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={resource.iconUrl}
                              alt=""
                              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-primary/10 to-accent/10">
                              <Icon className="h-10 w-10 text-primary/60" />
                            </div>
                          )}
                          <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-amber-300/60 bg-amber-100/60 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                            <Lock className="h-3 w-3" />
                            {t("premiumTag")}
                          </span>
                        </div>

                        <div className="flex-1 p-6">
                          <h4 className="text-lg font-light text-foreground mb-3">
                            {resource.title}
                          </h4>
                          <p className="line-clamp-3 text-sm leading-relaxed font-light text-muted-foreground">
                            {resource.summary}
                          </p>
                        </div>

                        <div className="mt-auto flex items-center justify-between border-t border-border/40 px-6 py-4">
                          <span className="font-serif text-xl font-light text-foreground">
                            {formatCad(resource.priceCents ?? 0, locale)}
                          </span>
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                            {t("unlockCta")}
                            <ArrowRight className="h-4 w-4" />
                          </span>
                        </div>
                      </Link>
                    </motion.div>
                  );
                })}
              </motion.div>

              <p className="mt-8 text-center text-xs font-light text-muted-foreground">
                {t("benefitsNote")}
              </p>
            </motion.div>
          ) : (
            /* Nothing for sale yet — keep the shell, drop the dead badge. */
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
                  <p className="text-base md:text-lg text-muted-foreground leading-relaxed font-light mb-4">
                    {t("premiumDesc")}
                  </p>
                  <p className="text-sm font-light text-muted-foreground">
                    {t("premiumEmptyNote")}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </motion.div>
      </div>
    </section>
  );
}
