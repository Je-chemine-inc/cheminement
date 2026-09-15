import type { ShowcaseSlotDay } from "@/lib/showcase-booking-types";
import { buildDirectoryItems } from "@/lib/showcase-directory-items";
import type { ShowcaseCard } from "@/lib/showcase-public";
import { ShowcaseDirectoryCard } from "@/components/showcase/ShowcaseDirectoryCard";

/**
 * Professionals presented on an expertise or region page (spec 003), as the
 * city page's directory shows them, without its filters. On a city host the
 * links stay relative; on www (`absolute`) they go to each professional's city
 * host, and the card names the city. `nextSlots` adds their next free times.
 */
export async function ShowcaseCardList({
  cards,
  absolute = false,
  nextSlots,
}: {
  cards: ShowcaseCard[];
  absolute?: boolean;
  nextSlots?: Readonly<Record<string, readonly ShowcaseSlotDay[]>>;
}) {
  const items = await buildDirectoryItems(cards, { absolute, nextSlots });
  return (
    <ul className="flex flex-col gap-3.5">
      {items.map((item) => (
        <li key={item.key}>
          <ShowcaseDirectoryCard {...item.card} />
        </li>
      ))}
    </ul>
  );
}
