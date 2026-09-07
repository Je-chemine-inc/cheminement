import {
  ApproachesHeroSection,
  ApproachesCTASection,
  ClinicalApproachesSection,
  FlexibilitySection,
  MatchingSection,
  PersonCenteredSection,
} from "@/components/sections/approaches";
import ColorTransition from "@/components/ui/ColorTransition";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Seo");
  return {
    title: t("approaches.title"),
    description: t("approaches.description"),
    openGraph: {
      title: t("approaches.title"),
      description: t("approaches.description"),
    },
  };
}

export default function ApproachesPage() {
  return (
    <main>
      <ApproachesHeroSection />
      <ColorTransition fromColor="accent" toColor="background" />
      <PersonCenteredSection />
      <ColorTransition fromColor="background" toColor="muted" />
      <ClinicalApproachesSection />
      <ColorTransition fromColor="muted" toColor="background" />
      <ColorTransition fromColor="background" toColor="muted" />
      <FlexibilitySection />
      <ColorTransition fromColor="muted" toColor="background" />
      <MatchingSection />
      <ColorTransition fromColor="background" toColor="muted" />
      <ApproachesCTASection />
    </main>
  );
}
