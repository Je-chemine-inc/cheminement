"use client";

import { useMemo, useState } from "react";
import {
  BookOpen,
  Download,
  Filter,
  FolderOpen,
  Heart,
  Headphones,
  PlayCircle,
  Search,
  Sparkles,
  Star,
  Timer,
  Video,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

type ResourceType = "video" | "article" | "audio" | "guide" | "meditation";

interface Resource {
  id: number;
  title: string;
  author: string;
  type: ResourceType;
  duration?: string;
  readTime?: string;
  price: string;
  rating: number;
  tags: string[];
  description: string;
  format: string;
  isFree: boolean;
  category: string;
}

const getCategoryLabel = (
  t: (key: string) => string,
  id: ResourceType | "all",
) => {
  const labels: Record<string, string> = {
    all: t("categories.all"),
    video: t("categories.videos"),
    article: t("categories.articles"),
    audio: t("categories.audio"),
    guide: t("categories.guides"),
    meditation: t("categories.meditations"),
  };
  return labels[id] || id;
};

const categories: Array<{ id: ResourceType | "all"; icon: React.ElementType }> =
  [
    { id: "all", icon: Sparkles },
    { id: "video", icon: Video },
    { id: "article", icon: BookOpen },
    { id: "audio", icon: Headphones },
    { id: "meditation", icon: Heart },
    { id: "guide", icon: Filter },
  ];

const resources: Resource[] = [
  {
    id: 1,
    title: "Comprendre l'anxiété",
    author: "Dr. Sophie Martin",
    type: "article",
    readTime: "8 min",
    price: "Gratuit",
    rating: 4.8,
    tags: ["Anxiété", "Psychoéducation", "Bien-être"],
    description:
      "Capsule psychoéducative sur les mécanismes et signes de l'anxiété. Apprenez à reconnaître les symptômes et comprendre ce qui se passe dans votre corps.",
    format: "Article",
    isFree: true,
    category: "Santé mentale",
  },
  {
    id: 2,
    title: "Respiration 4-7-8 pour l'anxiété",
    author: "Alexandre Piché, psychologue",
    type: "audio",
    duration: "6 min",
    price: "Gratuit",
    rating: 4.9,
    tags: ["Anxiété", "Respiration", "Relaxation"],
    description:
      "Exercice guidé pour vous détendre en moins de cinq minutes. Une technique simple et efficace à utiliser n'importe où, n'importe quand.",
    format: "Audio MP3",
    isFree: true,
    category: "Auto-soins",
  },
  {
    id: 3,
    title: "Les approches thérapeutiques expliquées",
    author: "Équipe Je chemine",
    type: "guide",
    readTime: "10 min",
    price: "Gratuit",
    rating: 4.7,
    tags: ["Thérapie", "TCC", "Humaniste", "Systémique"],
    description:
      "Comparatif des approches offertes (TCC, humaniste, systémique...). Découvrez quelle approche pourrait vous convenir le mieux.",
    format: "PDF",
    isFree: true,
    category: "Psychoéducation",
  },
  {
    id: 4,
    title: "Méditation de pleine conscience pour débutants",
    author: "Marie Dubois, psychothérapeute",
    type: "meditation",
    duration: "12 min",
    price: "Gratuit",
    rating: 4.6,
    tags: ["Mindfulness", "Pleine conscience", "Débutant"],
    description:
      "Une introduction douce à la méditation de pleine conscience. Parfait pour ceux qui commencent leur voyage vers le bien-être mental.",
    format: "Audio guidé",
    isFree: true,
    category: "Auto-soins",
  },
  {
    id: 5,
    title: "Programme Anxiété Sereine",
    author: "Dr. Amélie Caron",
    type: "video",
    duration: "4 semaines",
    price: "89 $",
    rating: 4.9,
    tags: ["Anxiété", "Programme", "TCC"],
    description:
      "Parcours guidé de 4 semaines avec vidéos, exercices et journal de suivi. Techniques de TCC appliquées pour gérer l'anxiété au quotidien.",
    format: "Vidéo HD + PDF",
    isFree: false,
    category: "Programmes",
  },
  {
    id: 6,
    title: "Routine de pleine conscience quotidienne",
    author: "Louis-Philippe Bégin",
    type: "guide",
    readTime: "4 pages",
    price: "Gratuit",
    rating: 4.5,
    tags: ["Pleine conscience", "Routine", "Quotidien"],
    description:
      "Mini-programme quotidien pour prendre soin de vous avant la thérapie. Des exercices simples à intégrer dans votre routine.",
    format: "PDF",
    isFree: true,
    category: "Auto-soins",
  },
  {
    id: 7,
    title: "Gérer le stress au travail",
    author: "Noémie Lapierre, psychologue",
    type: "video",
    duration: "18 min",
    price: "12 $",
    rating: 4.7,
    tags: ["Stress", "Travail", "Techniques"],
    description:
      "Vidéo pratique avec des stratégies concrètes pour gérer le stress professionnel. Apprenez à établir des limites saines.",
    format: "Vidéo HD",
    isFree: false,
    category: "Développement",
  },
  {
    id: 8,
    title: "Méditation du soir pour mieux dormir",
    author: "Mélanie Gagnon",
    type: "meditation",
    duration: "15 min",
    price: "Gratuit",
    rating: 4.8,
    tags: ["Sommeil", "Relaxation", "Soir"],
    description:
      "Une méditation guidée pour préparer votre corps et votre esprit au sommeil. Idéal pour ceux qui ont du mal à s'endormir.",
    format: "Audio guidé",
    isFree: true,
    category: "Auto-soins",
  },
  {
    id: 9,
    title: "Capsules Apaiser le sommeil",
    author: "Élise Rochefort",
    type: "audio",
    duration: "6 sessions",
    price: "24 $",
    rating: 4.6,
    tags: ["Sommeil", "Routine", "Audio"],
    description:
      "Série de capsules audio pour instaurer une routine de sommeil stable. Six sessions progressives avec plan d'action personnalisé.",
    format: "Audio MP3",
    isFree: false,
    category: "Programmes",
  },
  {
    id: 10,
    title: "Préparer son premier rendez-vous",
    author: "Équipe Je chemine",
    type: "article",
    readTime: "5 min",
    price: "Gratuit",
    rating: 4.9,
    tags: ["Premier rendez-vous", "Guide", "Préparation"],
    description:
      "Comment préparer son premier rendez-vous thérapeutique. Tout ce que vous devez savoir pour commencer votre démarche en confiance.",
    format: "Article",
    isFree: true,
    category: "Psychoéducation",
  },
  {
    id: 11,
    title: "Prendre soin de soi en période de stress",
    author: "Dr. Sophie Martin",
    type: "article",
    readTime: "7 min",
    price: "Gratuit",
    rating: 4.7,
    tags: ["Stress", "Auto-soins", "Bien-être"],
    description:
      "Conseils pratiques pour maintenir votre bien-être mental pendant les périodes difficiles. Des stratégies simples et efficaces.",
    format: "Article",
    isFree: true,
    category: "Auto-soins",
  },
  {
    id: 12,
    title: "Journal de gratitude guidé",
    author: "Alexandre Piché",
    type: "guide",
    readTime: "30 jours",
    price: "14 $",
    rating: 4.8,
    tags: ["Gratitude", "Journal", "Bien-être"],
    description:
      "Programme de 30 jours de journaling guidé pour cultiver la gratitude. Avec prompts quotidiens et exercices de réflexion.",
    format: "PDF interactif",
    isFree: false,
    category: "Programmes",
  },
];

export default function ClientLibraryPage() {
  const t = useTranslations("Client.library");
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<ResourceType | "all">(
    "all",
  );
  const [showFreeOnly, setShowFreeOnly] = useState(false);

  const filteredResources = useMemo(() => {
    return resources.filter((resource) => {
      const matchesCategory =
        activeCategory === "all" || resource.type === activeCategory;
      const matchesSearch =
        search.trim().length === 0 ||
        [resource.title, resource.author, resource.tags.join(" ")].some(
          (field) => field.toLowerCase().includes(search.toLowerCase()),
        );
      const matchesFree = !showFreeOnly || resource.isFree;
      return matchesCategory && matchesSearch && matchesFree;
    });
  }, [activeCategory, search, showFreeOnly]);

  const freeResourcesCount = resources.filter((r) => r.isFree).length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="rounded-3xl border border-border/20 bg-linear-to-br from-primary/10 via-card to-card/80 p-8 shadow-lg">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground/70">
              {t("badge")}
            </p>
            <h1 className="font-serif text-3xl font-light text-foreground lg:text-4xl">
              {t("title")}
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {t("description")}
            </p>
          </div>

          <div className="rounded-3xl bg-card/70 p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-primary/10 p-3">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t("freeResources")}
                </p>
                <p className="text-2xl font-light text-primary">
                  {freeResourcesCount}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* My Documents */}
      <section className="rounded-3xl border border-border/20 bg-card/80 p-7 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-primary/10 p-3">
            <FolderOpen className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-serif text-2xl font-light text-foreground">
              {t("myDocuments.title")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("myDocuments.subtitle")}
            </p>
          </div>
        </div>
        <div className="mt-6 rounded-2xl border border-dashed border-border/50 bg-muted/20 p-10 text-center">
          <FolderOpen className="mx-auto h-12 w-12 text-muted-foreground/40" />
          <p className="mt-4 text-sm font-medium text-muted-foreground">
            {t("myDocuments.noDocuments")}
          </p>
          <p className="mt-2 text-xs text-muted-foreground/70">
            {t("myDocuments.noDocumentsDesc")}
          </p>
        </div>
      </section>

      {/* Search and Filters */}
      <section className="grid gap-4 rounded-3xl border border-border/20 bg-card/60 p-6 shadow-inner">
        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="relative flex items-center">
            <Search className="absolute left-4 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("searchPlaceholder")}
              className="w-full rounded-full border border-border/40 bg-card/80 py-3 pl-11 pr-4 text-sm text-foreground shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <Button
            variant={showFreeOnly ? "default" : "outline"}
            onClick={() => setShowFreeOnly(!showFreeOnly)}
            className="gap-2 rounded-full"
          >
            <Filter className="h-4 w-4" />
            {t("freeOnly")}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {categories.map(({ id, icon: Icon }) => {
            const isActive = activeCategory === id;
            return (
              <button
                key={id}
                onClick={() => setActiveCategory(id)}
                className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition ${
                  isActive
                    ? "border-primary bg-primary text-primary-foreground shadow-lg"
                    : "border-border/40 bg-card/80 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {getCategoryLabel(t, id)}
              </button>
            );
          })}
        </div>
      </section>

      {/* Resources Grid */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl font-light text-foreground">
            {t("availableResources")}
          </h2>
          <span className="text-sm text-muted-foreground">
            {filteredResources.length}{" "}
            {filteredResources.length > 1
              ? t("resourceCountPlural")
              : t("resourceCount")}
          </span>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          {filteredResources.map((resource) => (
            <article
              key={resource.id}
              className="group relative overflow-hidden rounded-3xl border border-border/20 bg-card/80 p-6 shadow-lg transition duration-300 hover:-translate-y-1 hover:shadow-2xl"
            >
              <div className="absolute inset-0 bg-linear-to-tr from-primary/12 via-transparent to-accent/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

              <div className="relative z-10 flex flex-col gap-5">
                {/* Type, Rating & Meta */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-muted/50 px-3 py-1 text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
                    {resource.type === "video" && <Video className="h-4 w-4" />}
                    {resource.type === "article" && (
                      <BookOpen className="h-4 w-4" />
                    )}
                    {resource.type === "audio" && (
                      <Headphones className="h-4 w-4" />
                    )}
                    {resource.type === "guide" && (
                      <Filter className="h-4 w-4" />
                    )}
                    {resource.type === "meditation" && (
                      <Heart className="h-4 w-4" />
                    )}
                    {resource.type}
                  </div>
                  <div className="flex items-center gap-2 rounded-full bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
                    <Star className="h-3.5 w-3.5 fill-primary text-primary" />
                    {resource.rating.toFixed(1)}
                  </div>
                  {resource.duration && (
                    <div className="flex items-center gap-2 rounded-full bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
                      <Timer className="h-3.5 w-3.5" />
                      {resource.duration}
                    </div>
                  )}
                  {resource.readTime && (
                    <div className="flex items-center gap-2 rounded-full bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
                      <BookOpen className="h-3.5 w-3.5" />
                      {resource.readTime}
                    </div>
                  )}
                  {resource.isFree && (
                    <span className="rounded-full bg-green-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-green-700 dark:text-green-400">
                      {t("free")}
                    </span>
                  )}
                </div>

                {/* Title & Author */}
                <div>
                  <h3 className="font-serif text-xl font-medium text-foreground">
                    {resource.title}
                  </h3>
                  <p className="text-sm font-medium text-muted-foreground/80">
                    {resource.author}
                  </p>
                </div>

                {/* Description */}
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {resource.description}
                </p>

                {/* Tags */}
                <div className="flex flex-wrap gap-2">
                  {resource.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-border/30 bg-card/90 px-3 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>

                {/* Price & Action */}
                <div className="flex items-center justify-between pt-2">
                  <div className="text-sm font-semibold text-foreground">
                    {resource.price}
                  </div>
                  <Button className="gap-2 rounded-full px-4 py-4 text-sm font-medium">
                    {resource.isFree ? (
                      <>
                        <PlayCircle className="h-4 w-4" />
                        {t("access")}
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4" />
                        {t("purchase")}
                      </>
                    )}
                  </Button>
                </div>

                {/* Format Info */}
                <div className="flex items-center justify-between rounded-2xl border border-dashed border-border/50 bg-card/60 px-4 py-3 text-xs text-muted-foreground">
                  <span>
                    {t("format")} : {resource.format}
                  </span>
                  <span>{resource.category}</span>
                </div>
              </div>
            </article>
          ))}
        </div>

        {filteredResources.length === 0 && (
          <div className="rounded-3xl border border-dashed border-border/40 bg-card/60 p-10 text-center text-sm text-muted-foreground">
            {t("noResults")}
          </div>
        )}
      </section>
    </div>
  );
}
