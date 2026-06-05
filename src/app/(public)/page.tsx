import HeroSection from "@/components/sections/HeroSection";
import ColorTransition from "@/components/ui/ColorTransition";
import ValueSection from "@/components/sections/ValueSection";
import ClientAdvantagesSection from "@/components/sections/ClientAdvantagesSection";
import HowItWorksSection from "@/components/sections/HowItWorksSection";

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
