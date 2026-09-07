import ClientHeroSection from "@/components/sections/client/ClientHeroSection";

import ExploreTopicsSection from "@/components/sections/client/ExploreTopicsSection";
import ResourcesSection from "@/components/sections/client/ResourcesSection";
import ClientCTASection from "@/components/sections/client/ClientCTASection";
import ColorTransition from "@/components/ui/ColorTransition";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Seo");
  return {
    title: t("book.title"),
    description: t("book.description"),
    openGraph: {
      title: t("book.title"),
      description: t("book.description"),
    },
  };
}

export default function BookPage() {
  return (
    <main>
      <ClientHeroSection />
      <ColorTransition fromColor="accent" toColor="background" />

      <ColorTransition fromColor="background" toColor="background" />
      <ExploreTopicsSection />
      <ColorTransition fromColor="background" toColor="muted" />
      <ResourcesSection />
      <ColorTransition fromColor="muted" toColor="accent" />
      <ClientCTASection />
    </main>
  );
}
