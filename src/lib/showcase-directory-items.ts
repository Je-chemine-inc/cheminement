import { getLocale, getTranslations } from "next-intl/server";
import type { ShowcaseSlotDay } from "@/lib/showcase-booking-types";
import { nextSlotLabels, type DirectoryCardProps, type DirectoryItem } from "@/lib/showcase-directory";
import type { ShowcaseCard } from "@/lib/showcase-public";
import { initialsOf } from "@/lib/showcase-vitrine";

/**
 * The cards of a city, expertise or region page (spec 003), with every string
 * in the page's language, so the directory can filter them in the browser
 * without its own copy of the messages. `absolute` (www) links each card to
 * its city host and names the city.
 */
export async function buildDirectoryItems(
  cards: readonly ShowcaseCard[],
  options: { absolute?: boolean; nextSlots?: Readonly<Record<string, readonly ShowcaseSlotDay[]>> } = {},
): Promise<DirectoryItem[]> {
  const t = await getTranslations("Showcase");
  const locale = (await getLocale()) === "en" ? "en" : "fr";
  return cards.map((card) => {
    const title = card.title.key ? t(`titles.${card.title.key}`) : card.title.label;
    const years = card.yearsOfExperience;
    const subtitle =
      years !== null && years > 0
        ? title
          ? t("card.experience", { title, years })
          : t("card.experienceNoTitle", { years })
        : title;
    const place = card.officeCity ?? card.city.name;
    const videoOnly = card.modalities.length === 1 && card.modalities[0] === "video";
    const modes: DirectoryCardProps["modes"] = [];
    for (const modality of card.modalities) {
      if (modality === "inPerson") modes.push({ icon: "inPerson", label: t("card.inPersonAt", { city: place }) });
      else if (modality === "video") modes.push({ icon: "video", label: videoOnly ? t("card.onlineOnly") : t("card.online") });
      else if (modality === "phone") modes.push({ icon: "phone", label: t("card.phone") });
    }
    return {
      key: card.url,
      card: {
        href: options.absolute ? card.url : `/${card.slug}`,
        external: Boolean(options.absolute),
        displayName: card.displayName,
        subtitle,
        cityLine: options.absolute ? card.city.name : null,
        photoUrl: card.photoUrl,
        initials: initialsOf(card.displayName),
        expertises: card.expertises,
        modes,
        nextSlotsTitle: t("card.nextSlots"),
        nextSlots: nextSlotLabels(options.nextSlots?.[card.slug] ?? [], locale),
        viewProfile: t("card.viewProfile"),
      },
      filter: {
        displayName: card.displayName,
        title,
        expertises: card.expertises,
        modalities: card.modalities,
        offersQuick: card.offersQuick,
      },
    };
  });
}
