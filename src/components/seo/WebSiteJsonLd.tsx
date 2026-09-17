import { jsonLdString } from "@/lib/json-ld";
import { websiteJsonLd } from "@/lib/site-metadata";

/**
 * The site's own name, for Google's « site name » in the results.
 *
 * Belongs on the **home page only**: Google reads `WebSite` structured data at the root of a domain
 * and ignores it elsewhere. `OrganizationJsonLd` is the other half and sits on every page — that one
 * is the business as an entity (logo, address, contact), this one is what the site is called.
 */
export default function WebSiteJsonLd() {
  return (
    <script
      type="application/ld+json"
      // A constant; jsonLdString escapes "<" so nothing can close the element early.
      dangerouslySetInnerHTML={{ __html: jsonLdString(websiteJsonLd()) }}
    />
  );
}
