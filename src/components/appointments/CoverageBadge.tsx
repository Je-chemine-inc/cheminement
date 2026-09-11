"use client";

/**
 * Spec 002 — "PAE · 3/6": a third party pays for this person's sessions, and
 * how many covered sessions are used. Shown to professionals; carries no
 * organization name and no amount.
 */
import { useTranslations } from "next-intl";

export type CoverageBadgeValue = {
  kind: string;
  used: number;
  max: number | null;
};

const KNOWN_KINDS = new Set(["eap", "employer", "school", "person", "other"]);

export function CoverageBadge({ badge }: { badge?: CoverageBadgeValue | null }) {
  const t = useTranslations("CoverageBadge");
  if (!badge) return null;
  const kind = KNOWN_KINDS.has(badge.kind) ? badge.kind : "other";
  const count = badge.max
    ? t("usedOf", { used: badge.used, max: badge.max })
    : t("used", { used: badge.used });
  const full = badge.max !== null && badge.used >= badge.max;
  return (
    <span
      title={t("title")}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        full ? "bg-amber-100 text-amber-800" : "bg-teal-50 text-teal-700"
      }`}
    >
      {t(`kinds.${kind}`)} · {count}
    </span>
  );
}
