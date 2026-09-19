import ColorTransition from "@/components/ui/ColorTransition";
import {
  AboutHeroSection,
  AccessibilitySection,
  CommitmentSection,
  ExpertiseSection,
  PersonalizedJourneySection,
} from "@/components/sections/about";
import { EthicsSection } from "@/components/sections/approaches";
import ShowcaseProfessionalsSection from "@/components/sections/ShowcaseProfessionalsSection";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SITE_OPEN_GRAPH } from "@/lib/site-metadata";

// Read per request: a professional's page published or taken down shows at once.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Seo");
  return {
    title: t("whoWeAre.title"),
    description: t("whoWeAre.description"),
    openGraph: {
      ...SITE_OPEN_GRAPH,
      title: t("whoWeAre.title"),
      description: t("whoWeAre.description"),
    },
  };
}

export default function WhoWeArePage() {
  return (
    <main>
      <AboutHeroSection />
      <ColorTransition fromColor="accent" toColor="background" />
      <PersonalizedJourneySection />
      <ColorTransition fromColor="background" toColor="muted" />
      <ExpertiseSection />
      <ShowcaseProfessionalsSection context="about" />
      <ColorTransition fromColor="muted" toColor="background" />
      <EthicsSection />
      <ColorTransition fromColor="background" toColor="background" />
      <AccessibilitySection />
      <ColorTransition fromColor="background" toColor="accent" />
      <CommitmentSection />
    </main>
  );
}
