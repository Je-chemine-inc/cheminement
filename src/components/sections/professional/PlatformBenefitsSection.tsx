"use client";

import { motion } from "framer-motion";
import {
  Clock,
  TrendingUp,
  BookOpen,
  Award,
  Video,
  Users,
  DollarSign,
  Shield,
  Heart,
  Lightbulb,
  Calendar,
  FileText,
  MapPin,
} from "lucide-react";
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
  hidden: { opacity: 0, scale: 0.8 },
  visible: {
    opacity: 1,
    scale: 1,
  },
};

export default function PlatformBenefitsSection() {
  const t = useTranslations("PlatformBenefits");
  const locale = useLocale();

  const benefits = [
    {
      icon: Clock,
      titleEn: "Simple & Efficient Management",
      titleFr: "Gestion simple et efficace",
      descriptionEn:
        "Provide us with your available time slots, meet your clients, and we handle the rest—scheduling, billing, and administrative tasks.",
      descriptionFr:
        "Fournissez-nous vos plages horaires disponibles, rencontrez vos clients et nous nous occupons du reste—planification, facturation et tâches administratives.",
    },
    {
      icon: TrendingUp,
      titleEn: "Stabilize Your Practice",
      titleFr: "Stabilisez votre pratique",
      descriptionEn:
        "Maintain a consistent client base and steady revenue stream. Focus on growth without worrying about fluctuating income.",
      descriptionFr:
        "Maintenez une clientèle constante et un flux de revenus stable. Concentrez-vous sur la croissance sans vous soucier des revenus fluctuants.",
    },
    {
      icon: BookOpen,
      titleEn: "Optimize Your Time",
      titleFr: "Optimisez votre temps",
      descriptionEn:
        "Concentrate on clinical aspects of your practice and free up time for your personal life. We handle the business side.",
      descriptionFr:
        "Concentrez-vous sur les aspects cliniques de votre pratique et libérez du temps pour votre vie personnelle.",
    },
    {
      icon: Calendar,
      titleEn: "Practice Management Tools*",
      titleFr: "Outils de gestion de la pratique*",
      descriptionEn:
        "Access OWL Practice-style features including record keeping, scheduling, billing, and payroll management—all in one place.",
      descriptionFr:
        "Accédez à des outils pour faciliter la tenue de dossiers et la planification.",
    },
    {
      icon: FileText,
      titleEn: "Virtual Library Access*",
      titleFr: "Accès à la bibliothèque virtuelle*",
      descriptionEn:
        "Unlimited access to PDF books, research articles, psychological tests, and test correction platforms when needed.",
      descriptionFr:
        "Accès à des articles de recherche et du contenu. Accès à des tests psychologiques et plateformes de correction de tests au besoin.",
    },
    {
      icon: Video,
      titleEn: "Content Development Support",
      titleFr: "Soutien au développement de contenu",
      descriptionEn:
        "Get help creating podcasts, videos, and articles to expand your reach and generate additional revenue streams.",
      descriptionFr:
        "Obtenez de l'aide pour créer des podcasts, des vidéos et des articles afin d'élargir votre portée et de générer des flux de revenus supplémentaires.",
    },
    {
      icon: Award,
      titleEn: "Professional Development*",
      titleFr: "Développement professionnel*",
      descriptionEn:
        "Free training programs and receive a note-taking tablet after completing a certain number of sessions.",
      descriptionFr:
        "Programmes de formation gratuits et recevez une tablette de prise de notes après avoir complété un certain nombre de séances.",
    },
    {
      icon: Lightbulb,
      titleEn: "Startup Kit & Mentorship",
      titleFr: "Kit de démarrage et mentorat",
      descriptionEn:
        "New psychologists receive comprehensive startup assistance and mentorship from experienced professionals.",
      descriptionFr:
        "Les nouveaux psychologues reçoivent une assistance complète au démarrage et un mentorat de professionnels expérimentés.",
    },
    {
      icon: Users,
      titleEn: "Free Supervision Access*",
      titleFr: "Accès gratuit à la supervision*",
      descriptionEn:
        "Get access to professional supervision when you need it, included in your membership at no extra cost.",
      descriptionFr:
        "Accédez à une supervision professionnelle lorsque vous en avez besoin, incluse dans votre adhésion sans frais supplémentaires.",
    },
    {
      icon: Heart,
      titleEn: "Support Community",
      titleFr: "Communauté de soutien",
      descriptionEn:
        "Join support groups for mutual aid, reflection, clinical discussions, and professional community building.",
      descriptionFr:
        "Rejoignez des groupes de soutien pour l'entraide, la réflexion, les discussions cliniques et la construction d'une communauté professionnelle.",
    },
    {
      icon: Shield,
      titleEn: "Psychiatry Collaboration",
      titleFr: "Collaboration en psychiatrie",
      descriptionEn:
        "Access discussions with psychiatrists through our partnership with Averroes for comprehensive patient care.",
      descriptionFr:
        "Accédez à des discussions avec des psychiatres grâce à notre partenariat avec Averroès pour des soins complets aux patients.",
    },
    {
      icon: DollarSign,
      titleEn: "Financial Benefits*",
      titleFr: "Avantages financiers*",
      descriptionEn:
        "Preferential rates with accountants, OPQ membership fee support based on sessions, and investment fund opportunities.",
      descriptionFr:
        "Tarifs préférentiels avec les comptables, soutien des frais d'adhésion à l'OPQ selon les séances et opportunités de fonds d'investissement.",
    },
    {
      icon: MapPin,
      titleEn: "Social Mission",
      titleFr: "Mission sociale",
      descriptionEn:
        "Priority support for remote-region clients and reduced rates for family/child cases with space support.",
      descriptionFr:
        "Soutien prioritaire pour les clients des régions éloignées et tarifs réduits pour les cas famille/enfant avec soutien conjoint de l'espace.",
    },
  ];

  const additionalPerks = [
    {
      en: "Become a shareholder and collectively benefit from our success",
      fr: "Devenez actionnaire et bénéficiez collectivement de notre succès",
    },
    {
      en: "Optional contribution to a group RRSP",
      fr: "Possibilité de contribution à un REER collectif",
    },
  ];

  return (
    <section className="py-20 bg-muted">
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

          {/* Benefits Grid */}
          <motion.div
            variants={staggerContainer}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12"
          >
            {benefits.map((benefit, index) => (
              <motion.div
                key={index}
                variants={scaleIn}
                transition={{ duration: 0.5 }}
                whileHover={{ y: -5, transition: { duration: 0.2 } }}
                className="p-6 rounded-xl bg-card/50 backdrop-blur-sm hover:bg-card transition-all duration-300"
              >
                <div className="mb-4">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <benefit.icon className="w-6 h-6" />
                  </div>
                </div>
                <h3 className="text-lg font-light text-foreground mb-3">
                  {locale === "fr" ? benefit.titleFr : benefit.titleEn}
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed font-light">
                  {locale === "fr"
                    ? benefit.descriptionFr
                    : benefit.descriptionEn}
                </p>
              </motion.div>
            ))}
          </motion.div>

          {/* Disclaimer */}
          <motion.p
            variants={fadeInUp}
            transition={{ duration: 0.6 }}
            className="text-sm text-muted-foreground text-center italic mb-12 max-w-3xl mx-auto"
          >
            {t("disclaimer")}
          </motion.p>

          {/* Additional Perks */}
          <motion.div
            variants={fadeInUp}
            transition={{ duration: 0.6 }}
            className="bg-linear-to-br from-muted/30 to-accent/10 rounded-2xl p-8 md:p-12"
          >
            <h3 className="text-2xl font-serif font-light text-foreground mb-6 text-center">
              {t("additionalPerksTitle")}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mx-auto">
              {additionalPerks.map((perk, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1, duration: 0.5 }}
                  className="flex items-start gap-3"
                >
                  <div className="shrink-0 w-6 h-6 rounded-full bg-primary flex items-center justify-center mt-0.5">
                    <svg
                      className="w-4 h-4 text-primary-foreground"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path d="M5 13l4 4L19 7"></path>
                    </svg>
                  </div>
                  <p className="text-foreground leading-relaxed font-light">
                    {locale === "fr" ? perk.fr : perk.en}
                  </p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
