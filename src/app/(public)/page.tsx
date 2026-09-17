import HeroSection from "@/components/sections/HeroSection";
import ColorTransition from "@/components/ui/ColorTransition";
import ValueSection from "@/components/sections/ValueSection";
import ClientAdvantagesSection from "@/components/sections/ClientAdvantagesSection";
import HowItWorksSection from "@/components/sections/HowItWorksSection";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import WebSiteJsonLd from "@/components/seo/WebSiteJsonLd";
import { SITE_OPEN_GRAPH } from "@/lib/site-metadata";
import { SITE_URL } from "@/lib/site-url";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Seo");
  return {
    title: { absolute: t("home.title") },
    description: t("home.description"),
    openGraph: {
      ...SITE_OPEN_GRAPH,
      url: `${SITE_URL}/`,
      title: t("home.title"),
      description: t("home.description"),
    },
  };
}

export default function Home() {
  return (
    <main>
      {/* The site's name for Google's results; the home page is the only page it is read on. */}
      <WebSiteJsonLd />
      <HeroSection />
      <ColorTransition fromColor="accent" toColor="background" />
      <ValueSection />
      <ColorTransition fromColor="accent" toColor="muted" />
      <ClientAdvantagesSection />
      <ColorTransition fromColor="muted" toColor="background" />
      <HowItWorksSection />
    </main>
  );
}
