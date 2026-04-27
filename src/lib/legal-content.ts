import type { Types } from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import LegalDocument, {
  ILegalDocument,
  LegalDocumentKey,
  LegalDocumentLocale,
} from "@/models/LegalDocument";
import frMessages from "../../messages/fr.json";
import enMessages from "../../messages/en.json";
import { LEGAL_VERSIONS } from "@/lib/legal";

type Bullet = { term?: string; text: string };
type Block =
  | { paragraph: string }
  | { bullets: Bullet[] }
  | { callout: string };
type Section = { title: string; blocks: Block[] };

type LegalSeedShape = {
  title: string;
  subtitle?: string;
  lastUpdated: string;
  intro?: string;
  sections: Section[];
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function bulletsToHtml(bullets: Bullet[]): string {
  const items = bullets
    .map((b) => {
      if (b.term) {
        return `<li><strong>${escapeHtml(b.term)}</strong> : ${escapeHtml(b.text)}</li>`;
      }
      return `<li>${escapeHtml(b.text)}</li>`;
    })
    .join("");
  return `<ul>${items}</ul>`;
}

function blocksToHtml(blocks: Block[]): string {
  return blocks
    .map((block) => {
      if ("paragraph" in block && block.paragraph) {
        return `<p>${escapeHtml(block.paragraph)}</p>`;
      }
      if ("bullets" in block && Array.isArray(block.bullets)) {
        return bulletsToHtml(block.bullets);
      }
      if ("callout" in block && block.callout) {
        return `<blockquote class="legal-callout"><p>${escapeHtml(block.callout)}</p></blockquote>`;
      }
      return "";
    })
    .join("");
}

function buildContentHtml(doc: LegalSeedShape): string {
  const parts: string[] = [];
  if (doc.intro) {
    parts.push(`<p>${escapeHtml(doc.intro)}</p>`);
  }
  for (const section of doc.sections) {
    parts.push(`<h2>${escapeHtml(section.title)}</h2>`);
    parts.push(blocksToHtml(section.blocks));
  }
  return parts.join("\n");
}

function getSeedSource(
  key: LegalDocumentKey,
  locale: LegalDocumentLocale,
): LegalSeedShape {
  const messages = locale === "fr" ? frMessages : enMessages;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const legal = (messages as any).Legal as Record<string, LegalSeedShape>;
  return legal[key];
}

export async function ensureLegalDocumentSeeded(
  key: LegalDocumentKey,
  locale: LegalDocumentLocale,
): Promise<ILegalDocument> {
  await connectToDatabase();

  const existing = await LegalDocument.findOne({ documentKey: key, locale });
  if (existing) return existing;

  const seed = getSeedSource(key, locale);
  if (!seed) {
    throw new Error(
      `No seed source for legal document "${key}" in locale "${locale}"`,
    );
  }

  const data = {
    title: seed.title,
    subtitle: seed.subtitle,
    lastUpdated: seed.lastUpdated,
    version: LEGAL_VERSIONS[key],
    contentHtml: buildContentHtml(seed),
  };

  // Use upsert to avoid duplicate key errors under concurrent requests
  const doc = await LegalDocument.findOneAndUpdate(
    { documentKey: key, locale },
    { $setOnInsert: { documentKey: key, locale, ...data } },
    { upsert: true, new: true },
  );

  return doc!;
}

export async function getLegalDocument(
  key: LegalDocumentKey,
  locale: LegalDocumentLocale,
) {
  const doc = await ensureLegalDocumentSeeded(key, locale);
  return {
    id: (doc._id as Types.ObjectId).toString(),
    documentKey: doc.documentKey,
    locale: doc.locale,
    title: doc.title,
    subtitle: doc.subtitle,
    lastUpdated: doc.lastUpdated,
    version: doc.version,
    contentHtml: doc.contentHtml,
    updatedAt: doc.updatedAt,
  };
}

export async function listLegalDocuments() {
  await connectToDatabase();

  const keys: LegalDocumentKey[] = ["terms", "privacy", "professionalTerms", "cookies"];
  const locales: LegalDocumentLocale[] = ["fr", "en"];

  const results = [];
  for (const key of keys) {
    for (const locale of locales) {
      const doc = await ensureLegalDocumentSeeded(key, locale);
      results.push({
        id: (doc._id as Types.ObjectId).toString(),
        documentKey: doc.documentKey,
        locale: doc.locale,
        title: doc.title,
        subtitle: doc.subtitle,
        lastUpdated: doc.lastUpdated,
        version: doc.version,
        updatedAt: doc.updatedAt,
      });
    }
  }

  return results;
}

export type LegalDocumentDTO = Awaited<ReturnType<typeof getLegalDocument>>;

/** Lightweight titles (used by footer, nav). Direct read; rely on layout revalidation. */
export async function getLegalTitles(locale: LegalDocumentLocale) {
  const keys: LegalDocumentKey[] = [
    "terms",
    "privacy",
    "professionalTerms",
    "cookies",
  ];
  const titles: Record<LegalDocumentKey, string> = {
    terms: "",
    privacy: "",
    professionalTerms: "",
    cookies: "",
  };
  await Promise.all(
    keys.map(async (key) => {
      const doc = await ensureLegalDocumentSeeded(key, locale);
      titles[key] = doc.title;
    }),
  );
  return titles;
}
