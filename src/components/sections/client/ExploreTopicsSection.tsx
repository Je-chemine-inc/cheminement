"use client";

import { useEffect, useState } from "react";
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
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

const scaleIn = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
  },
};

interface TopicDTO {
  slug: string;
  title: string;
  summary: string;
  iconUrl?: string;
}

export default function ExploreTopicsSection() {
  const t = useTranslations("ExploreTopics");
  const locale = useLocale();
  const [topics, setTopics] = useState<TopicDTO[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/content/problematique?locale=${locale}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { items: TopicDTO[] };
        if (!cancelled) setTopics(data.items);
      } catch (err) {
        console.error("Failed to load topics:", err);
        if (!cancelled) setTopics([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  // Hide the section entirely if there are no published topics yet.
  if (topics !== null && topics.length === 0) {
    return null;
  }

  return (
    <section className="py-20 bg-background">
      <div className="container mx-auto px-6">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={staggerContainer}
          className="max-w-6xl mx-auto"
        >
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

          {topics && topics.length > 0 ? (
            <motion.div
              initial="hidden"
              animate="visible"
              variants={staggerContainer}
              className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 items-stretch"
            >
              {topics.map((topic) => (
                <motion.div
                  key={topic.slug}
                  variants={scaleIn}
                  transition={{ duration: 0.5 }}
                  whileHover={{ y: -5, transition: { duration: 0.2 } }}
                  className="p-6 rounded-xl bg-card/50 backdrop-blur-sm hover:bg-card transition-all duration-300 flex flex-col h-full min-h-[240px]"
                >
                  {topic.iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={topic.iconUrl}
                      alt=""
                      className="mb-4 h-12 w-12 rounded-lg object-cover"
                      loading="lazy"
                    />
                  ) : null}
                  <h4 className="text-lg font-light text-foreground mb-3 line-clamp-2">
                    {topic.title}
                  </h4>
                  <p className="text-muted-foreground text-sm leading-relaxed font-light mb-4 flex-1 line-clamp-4">
                    {topic.summary}
                  </p>
                  <Link
                    href={`/explore/${topic.slug}`}
                    className="inline-flex items-center text-sm text-primary hover:text-primary/80 transition-colors font-light"
                  >
                    {t("learnMore")}
                    <svg
                      className="w-4 h-4 ml-1"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </Link>
                </motion.div>
              ))}
            </motion.div>
          ) : null}
        </motion.div>
      </div>
    </section>
  );
}
