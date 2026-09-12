"use client";

import { useTranslations } from "next-intl";
import { SHOWCASE_BADGE_CLASSES, type ShowcaseBadge } from "@/lib/showcase-badges";

/** Where a page stands, as the admin screens show it. */
export function ShowcaseStatusBadge({ badge }: { badge: ShowcaseBadge }) {
  const t = useTranslations("ShowcaseAdmin");
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs ${SHOWCASE_BADGE_CLASSES[badge]}`}
    >
      {t(`badges.${badge}`)}
    </span>
  );
}
