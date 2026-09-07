import { getPlatformContactInfo, getSocialLinks } from "@/lib/platform-contact";
import { DEFAULT_SOCIAL_LINKS } from "@/models/PlatformSettings";

const SITE_URL = "https://www.jechemine.ca";

/**
 * Organization structured data, emitted once on every page.
 *
 * This is what lets Google show the business name, logo and contact details as
 * an entity rather than guessing them from page text.
 *
 * Everything here comes from the admin-configured platform settings, never from
 * hardcoded guesses, and any field the admin has not filled in is OMITTED
 * rather than emitted empty. Structured data that contradicts the page is worse
 * than none: Google treats mismatches as a quality signal against the site.
 */
export default async function OrganizationJsonLd() {
  const [contact, social] = await Promise.all([
    getPlatformContactInfo().catch(() => null),
    getSocialLinks().catch(() => null),
  ]);

  const address = contact?.physicalAddress;
  const hasAddress = Boolean(address?.city && address?.province);

  // `sameAs` tells Google "these profiles are also us", so it must only contain
  // profiles that exist. The social defaults in PlatformSettings are guessed
  // placeholders — https://x.com/jechemine is a 404 — so anything still equal
  // to its default is treated as "not configured" and left out. Once an admin
  // sets a real URL in the platform settings it appears here automatically.
  const sameAs = Object.entries(social ?? {})
    .filter(([key, value]) => {
      const url = typeof value === "string" ? value.trim() : "";
      if (!url.startsWith("http")) return false;
      return url !== DEFAULT_SOCIAL_LINKS[key as keyof typeof DEFAULT_SOCIAL_LINKS];
    })
    .map(([, value]) => (value as string).trim());

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: contact?.companyName?.trim() || "Je chemine",
    url: SITE_URL,
    logo: `${SITE_URL}/Logo.png`,
    description:
      "Plateforme québécoise de santé mentale : jumelage avec des professionnels qualifiés, prise de rendez-vous et accompagnement bilingue.",
    areaServed: {
      "@type": "AdministrativeArea",
      name: "Québec, Canada",
    },
    knowsLanguage: ["fr-CA", "en-CA"],
  };

  if (hasAddress) {
    data.address = {
      "@type": "PostalAddress",
      ...(address!.street ? { streetAddress: [address!.street, address!.suite].filter(Boolean).join(", ") } : {}),
      addressLocality: address!.city,
      addressRegion: address!.province,
      ...(address!.postalCode ? { postalCode: address!.postalCode } : {}),
      addressCountry: address!.country || "CA",
    };
  }

  const contactPoint: Record<string, unknown> = {
    "@type": "ContactPoint",
    contactType: "customer support",
    availableLanguage: ["French", "English"],
  };
  if (contact?.phoneNumber?.trim()) contactPoint.telephone = contact.phoneNumber.trim();
  if (contact?.supportEmail?.trim()) contactPoint.email = contact.supportEmail.trim();
  // Only worth emitting if there is actually a way to make contact.
  if (contactPoint.telephone || contactPoint.email) data.contactPoint = contactPoint;

  if (sameAs.length > 0) data.sameAs = sameAs;

  return (
    <script
      type="application/ld+json"
      // Values come from our own database, and JSON.stringify escapes them.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
