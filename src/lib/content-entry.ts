import type { Types } from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import ContentEntry, { type IContentEntry } from "@/models/ContentEntry";
import Problematique from "@/models/Problematique";
import {
  CONTENT_KINDS,
  CONTENT_KIND_PUBLIC_BASE,
  isDateSortedKind,
  type ContentKind,
  type ContentLocale,
  type MediaType,
} from "@/lib/content-kind";

// --- Seed sources ---

type BilingualSeed = {
  slug: string;
  sortOrder: number;
  titleFr: string;
  titleEn: string;
  summaryFr: string;
  summaryEn: string;
  /** Optional: days before "now" for publishedAt (used by date-sorted kinds to stagger dates). */
  daysAgo?: number;
  /** Only for media seeds. */
  mediaType?: MediaType;
  mediaUrl?: string;
};

/** Problématiques — the 8 mental-health topics originally shown on /book. */
export const PROBLEMATIQUE_SEEDS: BilingualSeed[] = [
  {
    slug: "depression",
    sortOrder: 10,
    titleFr: "Dépression",
    titleEn: "Depression",
    summaryFr:
      "Sentiments persistants de tristesse, perte d'intérêt et manque d'énergie affectant la vie quotidienne.",
    summaryEn:
      "Persistent feelings of sadness, loss of interest, and lack of energy affecting daily life.",
  },
  {
    slug: "anxiete",
    sortOrder: 20,
    titleFr: "Anxiété",
    titleEn: "Anxiety",
    summaryFr:
      "Inquiétude et peur excessives qui interfèrent avec les activités quotidiennes et le bien-être.",
    summaryEn:
      "Excessive worry and fear that interferes with daily activities and well-being.",
  },
  {
    slug: "trouble-panique",
    sortOrder: 30,
    titleFr: "Trouble panique",
    titleEn: "Panic Disorder",
    summaryFr:
      "Crises de panique récurrentes avec peur intense et symptômes physiques comme des palpitations.",
    summaryEn:
      "Recurring panic attacks with intense fear and physical symptoms like rapid heartbeat.",
  },
  {
    slug: "anxiete-sociale",
    sortOrder: 40,
    titleFr: "Anxiété sociale",
    titleEn: "Social Anxiety",
    summaryFr:
      "Peur intense des situations sociales et d'être jugé ou scruté par les autres.",
    summaryEn:
      "Intense fear of social situations and being judged or scrutinized by others.",
  },
  {
    slug: "stress-post-traumatique",
    sortOrder: 50,
    titleFr: "État de stress post-traumatique",
    titleEn: "Post-Traumatic Stress",
    summaryFr:
      "Anxiété et flashbacks déclenchés par des événements traumatiques, affectant le fonctionnement quotidien.",
    summaryEn:
      "Anxiety and flashbacks triggered by traumatic events, affecting daily functioning.",
  },
  {
    slug: "tdah",
    sortOrder: 60,
    titleFr: "TDAH",
    titleEn: "ADHD",
    summaryFr:
      "Difficulté à se concentrer, à contrôler les impulsions et hyperactivité affectant le travail et les relations.",
    summaryEn:
      "Difficulty focusing, controlling impulses, and hyperactivity affecting work and relationships.",
  },
  {
    slug: "trouble-obsessionnel-compulsif",
    sortOrder: 70,
    titleFr: "Trouble obsessionnel-compulsif",
    titleEn: "OCD",
    summaryFr:
      "Pensées intrusives et comportements répétitifs qui causent de la détresse et consomment du temps.",
    summaryEn:
      "Intrusive thoughts and repetitive behaviors that cause distress and consume time.",
  },
  {
    slug: "difficultes-apprentissage",
    sortOrder: 80,
    titleFr: "Difficultés d'apprentissage",
    titleEn: "Learning Difficulties",
    summaryFr:
      "Difficultés à acquérir et traiter l'information qui affectent la performance académique.",
    summaryEn:
      "Challenges in acquiring and processing information that affect academic performance.",
  },
];

/** Traitements — clinical approaches that were previously hardcoded on /approaches. */
export const TRAITEMENT_SEEDS: BilingualSeed[] = [
  {
    slug: "tcc",
    sortOrder: 10,
    titleFr: "Thérapies cognitivo-comportementales (TCC)",
    titleEn: "Cognitive-Behavioral Therapies (CBT)",
    summaryFr:
      "Des outils éprouvés pour agir sur les pensées, comportements et émotions qui vous freinent.",
    summaryEn:
      "Proven tools to act on thoughts, behaviors, and emotions that hold you back.",
  },
  {
    slug: "psychodynamique",
    sortOrder: 20,
    titleFr: "Approches psychodynamiques",
    titleEn: "Psychodynamic Approaches",
    summaryFr:
      "Comprendre vos dynamiques profondes et vos schémas relationnels pour transformer durablement.",
    summaryEn:
      "Understand your deep dynamics and relational patterns for lasting transformation.",
  },
  {
    slug: "systemique",
    sortOrder: 30,
    titleFr: "Approches systémiques",
    titleEn: "Systemic Approaches",
    summaryFr:
      "Famille, couple, groupes : intervenir sur les interactions pour rétablir un équilibre collectif.",
    summaryEn:
      "Family, couple, groups: intervene on interactions to restore collective balance.",
  },
  {
    slug: "humaniste",
    sortOrder: 40,
    titleFr: "Approches humanistes",
    titleEn: "Humanistic Approaches",
    summaryFr:
      "Une présence authentique, empathique et non jugeante pour favoriser votre autonomie.",
    summaryEn:
      "An authentic, empathetic, and non-judgmental presence to promote your autonomy.",
  },
  {
    slug: "mindfulness",
    sortOrder: 50,
    titleFr: "Mindfulness / Pleine conscience",
    titleEn: "Mindfulness / Mindful Awareness",
    summaryFr:
      "Renforcer l'attention, la régulation émotionnelle et la connexion à soi par des pratiques guidées.",
    summaryEn:
      "Strengthen attention, emotional regulation, and connection to self through guided practices.",
  },
  {
    slug: "psychoeducation",
    sortOrder: 60,
    titleFr: "Psychoéducation",
    titleEn: "Psychoeducation",
    summaryFr:
      "Un accompagnement structuré pour comprendre, s'outiller et mettre en place des stratégies adaptées.",
    summaryEn:
      "Structured support to understand, equip yourself, and implement adapted strategies.",
  },
  {
    slug: "interventions-scolaires",
    sortOrder: 70,
    titleFr: "Interventions scolaires",
    titleEn: "School and Neuropsychological Interventions",
    summaryFr:
      "Évaluations, plans d'intervention et suivis spécialisés pour soutenir la réussite.",
    summaryEn:
      "Assessments, intervention plans, and specialized follow-ups to support educational success.",
  },
  {
    slug: "coaching-parental",
    sortOrder: 80,
    titleFr: "Coaching parental & Guidance spécialisée",
    titleEn: "Parental Coaching & Specialized Guidance",
    summaryFr:
      "Un soutien concret pour le TDAH, l'anxiété, la gestion des émotions, les comportements opposants, etc.",
    summaryEn:
      "Concrete support for ADHD, anxiety, emotional management, oppositional behaviors, etc.",
  },
  {
    slug: "approche-integrative",
    sortOrder: 90,
    titleFr: "Approche intégrative",
    titleEn: "Integrative Approach",
    summaryFr:
      "Une combinaison de différentes techniques et théories psychologiques adaptées aux besoins uniques de chaque personne.",
    summaryEn:
      "A combination of different psychological techniques and theories adapted to each person's unique needs.",
  },
];

/** Nouveautés — sample announcements shown on /nouveautes. Date-sorted (newest first). */
export const NOUVEAUTE_SEEDS: BilingualSeed[] = [
  {
    slug: "bienvenue-sur-je-chemine",
    sortOrder: 0,
    daysAgo: 0,
    titleFr: "Bienvenue sur Je chemine",
    titleEn: "Welcome to Je chemine",
    summaryFr:
      "Une nouvelle plateforme québécoise pour vous accompagner dans votre cheminement en santé mentale, avec des professionnels qualifiés et des ressources accessibles.",
    summaryEn:
      "A new Quebec platform to support your mental health journey, with qualified professionals and accessible resources.",
  },
  {
    slug: "comprendre-anxiete-au-quotidien",
    sortOrder: 0,
    daysAgo: 7,
    titleFr: "Comprendre l'anxiété au quotidien",
    titleEn: "Understanding Everyday Anxiety",
    summaryFr:
      "Découvrez les signes de l'anxiété, ses causes et des stratégies concrètes pour mieux la gérer dans votre vie de tous les jours.",
    summaryEn:
      "Learn the signs of anxiety, its causes, and practical strategies to better manage it in everyday life.",
  },
  {
    slug: "conseils-pour-mieux-dormir",
    sortOrder: 0,
    daysAgo: 14,
    titleFr: "Conseils pour mieux dormir",
    titleEn: "Tips for Better Sleep",
    summaryFr:
      "Le sommeil joue un rôle clé dans votre santé mentale. Voici quelques habitudes simples pour favoriser un sommeil réparateur.",
    summaryEn:
      "Sleep plays a key role in your mental health. Here are simple habits to promote restorative sleep.",
  },
  {
    slug: "prendre-soin-de-sa-sante-mentale",
    sortOrder: 0,
    daysAgo: 21,
    titleFr: "Prendre soin de sa santé mentale",
    titleEn: "Taking Care of Your Mental Health",
    summaryFr:
      "Quelques gestes simples au quotidien peuvent faire une grande différence pour votre bien-être psychologique.",
    summaryEn:
      "A few simple daily habits can make a big difference for your psychological well-being.",
  },
];

/**
 * Médias — sample resources shown on /medias. Date-sorted (newest first).
 * Seeded as articles (self-contained, no external URL); admins add videos &
 * podcasts (with a YouTube/Vimeo/Spotify link) from the dashboard.
 */
export const MEDIA_SEEDS: BilingualSeed[] = [
  {
    slug: "apaiser-anxiete-au-quotidien",
    sortOrder: 0,
    daysAgo: 2,
    mediaType: "article",
    titleFr: "5 stratégies pour apaiser l'anxiété au quotidien",
    titleEn: "5 strategies to ease everyday anxiety",
    summaryFr:
      "Des outils simples et concrets, validés par nos professionnels, pour retrouver un peu de calme dans les moments de tension.",
    summaryEn:
      "Simple, practical tools validated by our professionals to find some calm in tense moments.",
  },
  {
    slug: "comprendre-la-therapie-cognitivo-comportementale",
    sortOrder: 0,
    daysAgo: 12,
    mediaType: "article",
    titleFr: "Comprendre la thérapie cognitivo-comportementale (TCC)",
    titleEn: "Understanding cognitive-behavioral therapy (CBT)",
    summaryFr:
      "Comment fonctionne l'une des approches les plus étudiées en santé mentale, et à qui elle s'adresse.",
    summaryEn:
      "How one of the most-studied approaches in mental health works, and who it's for.",
  },
  {
    slug: "prendre-soin-de-sa-sante-mentale-au-travail",
    sortOrder: 0,
    daysAgo: 26,
    mediaType: "article",
    titleFr: "Prendre soin de sa santé mentale au travail",
    titleEn: "Caring for your mental health at work",
    summaryFr:
      "Reconnaître les signes d'épuisement et poser des limites saines pour préserver son équilibre professionnel.",
    summaryEn:
      "Recognize the signs of burnout and set healthy boundaries to protect your professional balance.",
  },
];

// --- DTOs ---

export interface ContentEntryDTO {
  id: string;
  kind: ContentKind;
  slug: string;
  locale: ContentLocale;
  title: string;
  summary: string;
  iconUrl?: string;
  contentHtml: string;
  mediaType?: MediaType;
  mediaUrl?: string;
  status: "draft" | "published";
  sortOrder: number;
  publishedAt?: string;
  updatedAt: string;
  createdAt: string;
}

export interface ContentEntryPairDTO {
  kind: ContentKind;
  slug: string;
  sortOrder: number;
  publishedAt?: string;
  fr: ContentEntryDTO;
  en: ContentEntryDTO;
}

function toDTO(doc: IContentEntry): ContentEntryDTO {
  return {
    id: (doc._id as Types.ObjectId).toString(),
    kind: doc.kind,
    slug: doc.slug,
    locale: doc.locale,
    title: doc.title,
    summary: doc.summary ?? "",
    iconUrl: doc.iconUrl,
    contentHtml: doc.contentHtml ?? "",
    mediaType: doc.mediaType,
    mediaUrl: doc.mediaUrl,
    status: doc.status,
    sortOrder: doc.sortOrder ?? 100,
    publishedAt: doc.publishedAt?.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    createdAt: doc.createdAt.toISOString(),
  };
}

function groupPairs(docs: IContentEntry[]): ContentEntryPairDTO[] {
  const map = new Map<
    string,
    {
      kind: ContentKind;
      slug: string;
      sortOrder: number;
      publishedAt?: string;
      fr?: ContentEntryDTO;
      en?: ContentEntryDTO;
    }
  >();
  for (const doc of docs) {
    const dto = toDTO(doc);
    const key = `${doc.kind}::${doc.slug}`;
    const entry = map.get(key) ?? {
      kind: doc.kind,
      slug: doc.slug,
      sortOrder: dto.sortOrder,
      publishedAt: dto.publishedAt,
    };
    entry[doc.locale] = dto;
    entry.sortOrder = Math.min(entry.sortOrder, dto.sortOrder);
    if (dto.publishedAt && (!entry.publishedAt || dto.publishedAt > entry.publishedAt)) {
      entry.publishedAt = dto.publishedAt;
    }
    map.set(key, entry);
  }
  const items: ContentEntryPairDTO[] = [];
  for (const v of map.values()) {
    if (!v.fr || !v.en) continue;
    items.push({
      kind: v.kind,
      slug: v.slug,
      sortOrder: v.sortOrder,
      publishedAt: v.publishedAt,
      fr: v.fr,
      en: v.en,
    });
  }
  return items;
}

// --- Seeding & one-time migration from the old Problematique collection ---

async function seedKind(kind: ContentKind, seeds: BilingualSeed[]) {
  if (seeds.length === 0) return;
  const now = Date.now();
  const ops = seeds.flatMap((s) => {
    const publishedAt = new Date(
      now - (s.daysAgo ?? 0) * 24 * 60 * 60 * 1000,
    );
    return [
      {
        kind,
        slug: s.slug,
        locale: "fr" as const,
        title: s.titleFr,
        summary: s.summaryFr,
        contentHtml: "",
        mediaType: s.mediaType,
        mediaUrl: s.mediaUrl,
        status: "published" as const,
        sortOrder: s.sortOrder,
        publishedAt,
      },
      {
        kind,
        slug: s.slug,
        locale: "en" as const,
        title: s.titleEn,
        summary: s.summaryEn,
        contentHtml: "",
        mediaType: s.mediaType,
        mediaUrl: s.mediaUrl,
        status: "published" as const,
        sortOrder: s.sortOrder,
        publishedAt,
      },
    ];
  });
  try {
    const res = await ContentEntry.insertMany(ops, { ordered: false });
    console.log(`[seedKind] ${kind}: inserted ${res.length} docs`);
  } catch (e) {
    // Duplicate-key errors on retry are expected and benign; surface anything else.
    const err = e as { code?: number; writeErrors?: unknown[]; message?: string };
    const allDupes =
      err.code === 11000 ||
      (Array.isArray(err.writeErrors) &&
        err.writeErrors.every(
          (w) => (w as { code?: number })?.code === 11000,
        ));
    if (!allDupes) {
      console.error(`[seedKind] ${kind} failed:`, err.message ?? e);
    }
  }
}

/**
 * Backfill: rows seeded by an earlier build started life as draft, which left
 * every public surface empty. Promote any seed row that has never been published
 * (no `publishedAt`) to "published". Admin-initiated unpublishes are preserved
 * because they carry a `publishedAt` from their original publish.
 */
async function publishUntouchedSeeds(
  kind: ContentKind,
  seeds: BilingualSeed[],
) {
  if (seeds.length === 0) return;
  const slugs = seeds.map((s) => s.slug);
  await ContentEntry.updateMany(
    {
      kind,
      slug: { $in: slugs },
      status: "draft",
      publishedAt: { $exists: false },
    },
    { $set: { status: "published", publishedAt: new Date() } },
  );
}

/** Migrate from the legacy Problematique collection if it has rows. Idempotent. */
async function migrateLegacyProblematiques(): Promise<boolean> {
  try {
    const legacy = await Problematique.find().lean();
    if (legacy.length === 0) return false;
    const ops = legacy.map((d) => ({
      kind: "problematique" as const,
      slug: d.slug,
      locale: d.locale,
      title: d.title,
      summary: d.summary ?? "",
      iconUrl: d.iconUrl,
      contentHtml: d.contentHtml ?? "",
      status: d.status ?? "draft",
      sortOrder: d.sortOrder ?? 100,
      publishedAt: d.publishedAt,
      updatedBy: d.updatedBy,
    }));
    try {
      const res = await ContentEntry.insertMany(ops, { ordered: false });
      console.log(`[migrateLegacyProblematiques] inserted ${res.length} docs`);
    } catch (e) {
      const err = e as { code?: number; writeErrors?: unknown[]; message?: string };
      const allDupes =
        err.code === 11000 ||
        (Array.isArray(err.writeErrors) &&
          err.writeErrors.every(
            (w) => (w as { code?: number })?.code === 11000,
          ));
      if (!allDupes) {
        console.error("[migrateLegacyProblematiques] failed:", err.message ?? e);
      }
    }
    return true;
  } catch (e) {
    console.warn("Legacy Problematique migration skipped:", e);
    return false;
  }
}

/** Ensure each kind has its initial seed data. Idempotent and lazy. */
export async function ensureSeeded(): Promise<void> {
  await connectToDatabase();
  // Problématique — try to import legacy data first, fall back to seeds.
  const problematiqueCount = await ContentEntry.countDocuments({
    kind: "problematique",
  });
  if (problematiqueCount === 0) {
    const migrated = await migrateLegacyProblematiques();
    if (!migrated) await seedKind("problematique", PROBLEMATIQUE_SEEDS);
  } else {
    await publishUntouchedSeeds("problematique", PROBLEMATIQUE_SEEDS);
  }
  // Traitement — seed clinical approaches.
  const traitementCount = await ContentEntry.countDocuments({
    kind: "traitement",
  });
  if (traitementCount === 0) {
    await seedKind("traitement", TRAITEMENT_SEEDS);
  } else {
    await publishUntouchedSeeds("traitement", TRAITEMENT_SEEDS);
  }
  // Nouveauté — seed sample announcements; admins can edit or add more.
  const nouveauteCount = await ContentEntry.countDocuments({
    kind: "nouveaute",
  });
  if (nouveauteCount === 0) {
    await seedKind("nouveaute", NOUVEAUTE_SEEDS);
  } else {
    await publishUntouchedSeeds("nouveaute", NOUVEAUTE_SEEDS);
  }
  // Médias — seed sample articles; admins add videos & podcasts.
  const mediaCount = await ContentEntry.countDocuments({ kind: "media" });
  if (mediaCount === 0) {
    await seedKind("media", MEDIA_SEEDS);
  } else {
    await publishUntouchedSeeds("media", MEDIA_SEEDS);
  }
}

// --- Queries ---

export async function listContentAdmin(
  kind: ContentKind,
): Promise<ContentEntryPairDTO[]> {
  await connectToDatabase();
  await ensureSeeded();
  const dateSorted = isDateSortedKind(kind);
  const sort: Record<string, 1 | -1> = dateSorted
    ? { publishedAt: -1, createdAt: -1 }
    : { sortOrder: 1, slug: 1 };
  const docs = await ContentEntry.find({ kind }).sort(sort);
  const pairs = groupPairs(docs);
  pairs.sort((a, b) => {
    if (dateSorted) {
      const da = a.publishedAt ?? "";
      const db = b.publishedAt ?? "";
      if (da !== db) return db.localeCompare(da);
      return a.slug.localeCompare(b.slug);
    }
    return a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug);
  });
  return pairs;
}

export async function getContentPair(
  kind: ContentKind,
  slug: string,
): Promise<ContentEntryPairDTO | null> {
  await connectToDatabase();
  const docs = await ContentEntry.find({ kind, slug });
  const pairs = groupPairs(docs);
  return pairs[0] ?? null;
}

export async function listPublishedContent(
  kind: ContentKind,
  locale: ContentLocale,
): Promise<ContentEntryDTO[]> {
  await connectToDatabase();
  await ensureSeeded();
  const sort: Record<string, 1 | -1> = isDateSortedKind(kind)
    ? { publishedAt: -1, createdAt: -1 }
    : { sortOrder: 1, title: 1 };
  const docs = await ContentEntry.find({
    kind,
    locale,
    status: "published",
  }).sort(sort);
  return docs.map(toDTO);
}

export async function getPublishedContent(
  kind: ContentKind,
  slug: string,
  locale: ContentLocale,
): Promise<ContentEntryDTO | null> {
  await connectToDatabase();
  const doc = await ContentEntry.findOne({
    kind,
    slug,
    locale,
    status: "published",
  });
  return doc ? toDTO(doc) : null;
}

// --- Helpers (re-exported for backward compat with existing importers) ---

export { CONTENT_KINDS, CONTENT_KIND_PUBLIC_BASE };
export type { ContentKind, ContentLocale };
export { isContentKind, slugify } from "@/lib/content-kind";
