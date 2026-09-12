import { getTranslations } from "next-intl/server";
import type { ShowcaseLanguageKey, ShowcasePublicProfile } from "@/lib/showcase-public";
import { absoluteShowcaseUrl } from "@/lib/showcase-hosts";
import { jsonLdString } from "@/lib/json-ld";
import { SITE_URL } from "@/lib/site-url";

const LANGUAGE_TAGS: Record<ShowcaseLanguageKey, string> = {
  french: "fr",
  english: "en",
  arabic: "ar",
  spanish: "es",
  mandarin: "zh",
};

/**
 * Structured data of a professional's page: the Person and the way back to
 * the city page. Built from the public data object only; serialized so that
 * text the professional wrote cannot close the script element.
 */
export async function ShowcaseProfileJsonLd({ profile }: { profile: ShowcasePublicProfile }) {
  const t = await getTranslations("Showcase");
  const title = profile.title.key ? t(`titles.${profile.title.key}`) : profile.title.label;
  const orderName = profile.order
    ? profile.order.code === "other"
      ? profile.order.label
      : t(`orders.${profile.order.code}`)
    : null;

  const person: Record<string, unknown> = {
    "@type": "Person",
    "@id": `${profile.url}#person`,
    name: profile.displayName,
    url: profile.url,
    address: {
      "@type": "PostalAddress",
      addressLocality: profile.officeCity ?? profile.city.name,
      addressRegion: profile.city.region,
      addressCountry: "CA",
    },
    worksFor: { "@type": "Organization", name: "Je chemine", url: SITE_URL },
  };
  if (title) person.jobTitle = title;
  if (profile.photoUrl) person.image = absoluteShowcaseUrl(profile.city.key, profile.photoUrl);
  if (profile.languages.length > 0) {
    person.knowsLanguage = profile.languages.map((language) => LANGUAGE_TAGS[language]);
  }
  if (profile.expertises.length > 0) {
    person.knowsAbout = profile.expertises.map((expertise) => expertise.label);
  }
  if (orderName) person.memberOf = { "@type": "Organization", name: orderName };

  const data = {
    "@context": "https://schema.org",
    "@graph": [
      person,
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: t("city.title", { city: profile.city.name }),
            item: absoluteShowcaseUrl(profile.city.key, "/"),
          },
          { "@type": "ListItem", position: 2, name: profile.displayName, item: profile.url },
        ],
      },
    ],
  };

  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />
  );
}
