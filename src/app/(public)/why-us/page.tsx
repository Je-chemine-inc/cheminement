import {
  AccessExperienceSection,
  FamilySupportSection,
  ReasonsTimelineSection,
  SupportCommitmentSection,
  WhyHeroSection,
} from "@/components/sections/why";
import ColorTransition from "@/components/ui/ColorTransition";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Seo");
  return {
    title: t("whyUs.title"),
    description: t("whyUs.description"),
    openGraph: {
      title: t("whyUs.title"),
      description: t("whyUs.description"),
    },
  };
}

export default function WhyUsPage() {
  return (
    <main>
      <WhyHeroSection />
      <ColorTransition fromColor="accent" toColor="background" />
      <ReasonsTimelineSection />
      <ColorTransition fromColor="background" toColor="muted" />
      <AccessExperienceSection />
      <ColorTransition fromColor="muted" toColor="accent" />
      <FamilySupportSection />
      <ColorTransition fromColor="accent" toColor="background" />
      <SupportCommitmentSection />
    </main>
  );
}
