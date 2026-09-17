import ProfessionalHeroSection from "@/components/sections/professional/ProfessionalHeroSection";
import MatchingSystemSection from "@/components/sections/professional/MatchingSystemSection";
import PlatformBenefitsSection from "@/components/sections/professional/PlatformBenefitsSection";
import ProfessionalCTASection from "@/components/sections/professional/ProfessionalCTASection";
import ColorTransition from "@/components/ui/ColorTransition";
import ProfessionalCollaborationSection from "@/components/sections/professional/ProfessionalCollaborationSection";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SITE_OPEN_GRAPH } from "@/lib/site-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Seo");
  return {
    title: t("professional.title"),
    description: t("professional.description"),
    openGraph: {
      ...SITE_OPEN_GRAPH,
      title: t("professional.title"),
      description: t("professional.description"),
    },
  };
}

export default function ProfessionalPage() {
  return (
    <main>
      <ProfessionalHeroSection />
      <ColorTransition fromColor="accent" toColor="background" />
      <ProfessionalCollaborationSection />
      <ColorTransition fromColor="background" toColor="background" />
      <MatchingSystemSection />
      <ColorTransition fromColor="background" toColor="muted" />
      <PlatformBenefitsSection />
      <ColorTransition fromColor="muted" toColor="accent" />
      <ProfessionalCTASection />
    </main>
  );
}
