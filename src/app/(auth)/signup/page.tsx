"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Users, Briefcase } from "lucide-react";
import { useTranslations } from "next-intl";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      staggerChildren: 0.05,
      staggerDirection: -1,
    },
  },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
};

export default function SignupPage() {
  const t = useTranslations("Auth.signupSelection");

  return (
    <div className="w-full max-w-6xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.4 }}
        className="text-center mb-12"
      >
        <h1 className="text-3xl md:text-4xl font-serif font-light text-foreground mb-3">
          {t("title")}
        </h1>
        <p className="text-muted-foreground text-lg font-light">
          {t("subtitle")}
        </p>
      </motion.div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        exit="exit"
        className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl mx-auto"
      >
        {/* Member Card */}
        <motion.div variants={item}>
          <Link href="/signup/member" className="block group h-full">
            <div className="h-full rounded-xl border border-border/20 bg-card/50 backdrop-blur-sm p-8 shadow-sm transition-all duration-300 hover:shadow-lg hover:border-primary hover:-translate-y-1 hover:bg-card">
              <div className="flex flex-col items-center text-center h-full">
                <div className="mb-6 rounded-full bg-primary/10 p-4 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <Users className="h-8 w-8" />
                </div>
                <h2 className="text-2xl font-serif font-light text-foreground mb-4 group-hover:text-primary transition-colors">
                  {t("member.title")}
                </h2>
                <p className="text-muted-foreground leading-relaxed grow font-light">
                  {t("member.description")}
                </p>
                <div className="mt-6 text-primary font-light group-hover:underline">
                  {t("member.cta")}
                </div>
              </div>
            </div>
          </Link>
        </motion.div>

        {/* Professional Card */}
        <motion.div variants={item}>
          <Link href="/signup/professional" className="block group h-full">
            <div className="h-full rounded-xl border border-border/20 bg-card/50 backdrop-blur-sm p-8 shadow-sm transition-all duration-300 hover:shadow-lg hover:border-primary hover:-translate-y-1 hover:bg-card">
              <div className="flex flex-col items-center text-center h-full">
                <div className="mb-6 rounded-full bg-primary/10 p-4 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <Briefcase className="h-8 w-8" />
                </div>
                <h2 className="text-2xl font-serif font-light text-foreground mb-4 group-hover:text-primary transition-colors">
                  {t("professional.title")}
                </h2>
                <p className="text-muted-foreground leading-relaxed grow font-light">
                  {t("professional.description")}
                </p>
                <div className="mt-6 text-primary font-light group-hover:underline">
                  {t("professional.cta")}
                </div>
              </div>
            </div>
          </Link>
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="mt-8 text-center"
      >
        <p className="text-sm text-muted-foreground font-light">
          {t("hasAccount")}{" "}
          <Link
            href="/login"
            className="text-primary hover:text-primary/80 transition-colors"
          >
            {t("signIn")}
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
