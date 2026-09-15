"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { PROFESSIONAL_TITLES } from "@/data/professionalTitles";
import type { ShowcaseEditorJson } from "@/lib/showcase-editor-types";

const TITLE_KEYS = new Set<string>(PROFESSIONAL_TITLES.map((title) => title.value));

/**
 * What the page shows from the professional's profile (title, permit,
 * modalities, languages, office city) and its address. Read-only here: the
 * profile is the one place these facts change, so the page never disagrees
 * with what the platform uses.
 */
export function ShowcaseFactsCard({
  view,
  profileHref,
  profileLabel,
}: {
  view: ShowcaseEditorJson;
  profileHref: string;
  /** Defaults to « Modifier mon profil ». */
  profileLabel?: string;
}) {
  const t = useTranslations("ShowcasePro");
  const tLabels = useTranslations("Showcase");
  const facts = view.profileFacts;
  const none = t("facts.none");
  const title = facts.title
    ? TITLE_KEYS.has(facts.title)
      ? tLabels(`titles.${facts.title}`)
      : facts.title
    : none;

  const rows: Array<[string, string]> = [
    [t("facts.titleLabel"), title],
    [t("facts.license"), facts.license || none],
    [
      t("facts.modalities"),
      facts.modalities.length ? facts.modalities.map((key) => tLabels(`modalities.${key}`)).join(", ") : none,
    ],
    [
      t("facts.languages"),
      facts.languages.length ? facts.languages.map((key) => tLabels(`languages.${key}`)).join(", ") : none,
    ],
    [t("facts.officeCity"), facts.officeCity || none],
  ];

  return (
    <section className="rounded-xl bg-card p-6" aria-labelledby="showcase-facts-title">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="showcase-facts-title" className="font-serif text-xl font-light text-foreground">
          {t("facts.title")}
        </h2>
        <Link href={profileHref} className="text-sm text-primary hover:underline">
          {profileLabel ?? t("facts.editProfile")}
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t("facts.hint")}</p>
      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
            <dd className="text-sm text-foreground">{value}</dd>
          </div>
        ))}
        <div className="sm:col-span-2">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("facts.pageAddress")}</dt>
          <dd className="break-all text-sm text-foreground">{view.page.publicUrl}</dd>
        </div>
      </dl>
    </section>
  );
}
