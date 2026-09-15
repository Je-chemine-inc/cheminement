import { notFound } from "next/navigation";
import { findShowcaseCity } from "@/lib/showcase-cities";
import { ShowcaseFooter, ShowcaseHeader } from "@/components/showcase/ShowcaseChrome";
import { vitrineSans, vitrineSerif } from "@/components/showcase/vitrine/fonts";

/**
 * The city's own pages (its landing, expertise pages, unknown paths) inside
 * Je chemine's header and footer for the city. A professional's page, beside
 * this group, carries its own header and footer (the « vitrine » design).
 */
type Params = { params: Promise<{ cityKey: string }> };

export default async function ShowcaseCityPagesLayout({ children, params }: Params & { children: React.ReactNode }) {
  const { cityKey } = await params;
  const city = findShowcaseCity(cityKey);
  if (!city) notFound();
  return (
    // The « Ville » design: the professionals' pages' fonts, with `font-serif` pointing at the rounded serif.
    <div
      className={`${vitrineSerif.variable} ${vitrineSans.variable} flex min-h-screen flex-col bg-[#FAF7F2] font-[family-name:var(--font-vitrine-sans)] text-[#414E4B] antialiased [--font-serif:var(--font-vitrine-serif)]`}
    >
      <ShowcaseHeader city={city} />
      <main className="flex-1">{children}</main>
      <ShowcaseFooter />
    </div>
  );
}
