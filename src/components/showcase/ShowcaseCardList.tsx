import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ShowcaseCard } from "@/lib/showcase-public";

/** The professionals presented on a city's page (spec 003). */
export async function ShowcaseCardList({ cards }: { cards: ShowcaseCard[] }) {
  const t = await getTranslations("Showcase");
  return (
    <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => {
        const title = card.title.key ? t(`titles.${card.title.key}`) : card.title.label;
        return (
          <li key={card.slug}>
            <Link
              href={`/${card.slug}`}
              className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border/60 bg-card transition-shadow hover:shadow-md"
            >
              <div className="relative aspect-[4/3] bg-muted">
                {card.photoUrl ? (
                  <Image
                    src={card.photoUrl}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="object-cover"
                  />
                ) : null}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-5">
                <h2 className="font-serif text-xl font-light text-foreground">{card.displayName}</h2>
                {title ? <p className="text-sm text-muted-foreground">{title}</p> : null}
                {card.headline ? <p className="text-sm text-foreground/80">{card.headline}</p> : null}
                {card.expertises.length > 0 ? (
                  <ul className="flex flex-wrap gap-1.5 pt-1">
                    {card.expertises.map((expertise) => (
                      <li key={expertise} className="rounded-full bg-accent px-2.5 py-0.5 text-xs text-foreground">
                        {expertise}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <span className="mt-auto pt-3 text-sm font-medium text-primary group-hover:underline">
                  {t("card.viewProfile")}
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
