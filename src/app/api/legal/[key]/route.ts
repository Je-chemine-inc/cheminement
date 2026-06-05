import { NextRequest, NextResponse } from "next/server";
import { getLocale } from "next-intl/server";
import { getLegalDocument } from "@/lib/legal-content";
import type {
  LegalDocumentKey,
  LegalDocumentLocale,
} from "@/models/LegalDocument";

const VALID_KEYS: LegalDocumentKey[] = [
  "terms",
  "privacy",
  "professionalTerms",
  "cookies",
  "emergencyConditions",
];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const { key } = await params;
    if (!VALID_KEYS.includes(key as LegalDocumentKey)) {
      return NextResponse.json(
        { error: "Unknown legal document" },
        { status: 404 },
      );
    }

    const url = new URL(req.url);
    const qLocale = url.searchParams.get("locale");
    const locale: LegalDocumentLocale =
      qLocale === "fr" || qLocale === "en"
        ? qLocale
        : ((await getLocale()) as LegalDocumentLocale) === "fr"
          ? "fr"
          : "en";

    const doc = await getLegalDocument(key as LegalDocumentKey, locale);
    return NextResponse.json(doc);
  } catch (error) {
    console.error("Get legal document error:", error);
    return NextResponse.json(
      { error: "Failed to load legal document" },
      { status: 500 },
    );
  }
}
