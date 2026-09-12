import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ShowcaseCard } from "@/lib/showcase-public";

/**
 * Professionals presented on a city, expertise or region page (spec 003).
 * On a city host the links stay relative; on www (`absolute`) they go to each
 * professional's city host, and the card names the city.
 */
export async function ShowcaseCardList({
  cards,
  absolute = false,
}: {
  cards: ShowcaseCard[];
  absolute?: boolean;
}) {
  const t = await getTranslations("Showcase");
  return (
    <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => {
        const title = card.title.key ? t(`titles.${card.title.key}`) : card.title.label;
        const body = (
          <>
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
              <h3 className="font-serif text-xl font-light text-foreground">{card.displayName}</h3>
              {title ? <p className="text-sm text-muted-foreground">{title}</p> : null}
              {absolute ? <p className="text-xs uppercase tracking-wide text-muted-foreground">{card.city.name}</p> : null}
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
          </>
        );
        const className =
          "group flex h-full flex-col overflow-hidden rounded-2xl border border-border/60 bg-card transition-shadow hover:shadow-md";
        return (
          <li key={card.url}>
            {absolute ? (
              <a href={card.url} className={className}>
                {body}
              </a>
            ) : (
              <Link href={`/${card.slug}`} className={className}>
                {body}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
