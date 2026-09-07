import HeroSection from "@/components/sections/HeroSection";
import ColorTransition from "@/components/ui/ColorTransition";
import ValueSection from "@/components/sections/ValueSection";
import ClientAdvantagesSection from "@/components/sections/ClientAdvantagesSection";
import HowItWorksSection from "@/components/sections/HowItWorksSection";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Seo");
  return {
    title: { absolute: t("home.title") },
    description: t("home.description"),
    openGraph: {
      title: t("home.title"),
      description: t("home.description"),
    },
  };
}

export default function Home() {
  return (
    <main>
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
