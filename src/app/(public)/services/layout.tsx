import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/**
 * Metadata only. The page in this segment is a client component, which
 * cannot export metadata itself, so the segment layout carries it.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Seo");
  return {
    title: t("services.title"),
    description: t("services.description"),
    openGraph: {
      title: t("services.title"),
      description: t("services.description"),
    },
  };
}

export default function SegmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
