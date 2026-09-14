import { notFound } from "next/navigation";
import { findShowcaseCity } from "@/lib/showcase-cities";
import { ShowcaseFooter, ShowcaseHeader } from "@/components/showcase/ShowcaseChrome";

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
    <div className="flex min-h-screen flex-col bg-background">
      <ShowcaseHeader city={city} />
      <main className="flex-1">{children}</main>
      <ShowcaseFooter />
    </div>
  );
}
