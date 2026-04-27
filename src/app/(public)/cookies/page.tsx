import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import LegalPage from "@/components/legal/LegalPage";
import { getLegalDocument } from "@/lib/legal-content";
import type { LegalDocumentLocale } from "@/models/LegalDocument";

export const dynamic = "force-dynamic";

async function getDoc() {
  const locale = (await getLocale()) as LegalDocumentLocale;
  return getLegalDocument("cookies", locale === "fr" ? "fr" : "en");
}

export async function generateMetadata(): Promise<Metadata> {
  const doc = await getDoc();
  return {
    title: doc.title,
    description: doc.subtitle,
  };
}

export default async function CookiesPage() {
  const doc = await getDoc();
  return (
    <main>
      <LegalPage doc={doc} />
    </main>
  );
}
