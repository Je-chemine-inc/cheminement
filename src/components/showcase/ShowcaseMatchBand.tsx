import { getTranslations } from "next-intl/server";

/** « Vous ne savez pas qui choisir ? » — the way to the matching request on www (spec 003). */
export async function ShowcaseMatchBand({ href }: { href: string }) {
  const t = await getTranslations("Showcase.match");
  return (
    <section className="border-t border-border/60 bg-primary/5">
      <div className="container mx-auto flex max-w-6xl flex-col items-start gap-4 px-4 py-12 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-serif text-2xl font-light text-foreground">{t("title")}</h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">{t("body")}</p>
        </div>
        <a
          href={href}
          data-showcase-cta=""
          className="inline-flex shrink-0 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t("button")}
        </a>
      </div>
    </section>
  );
}
