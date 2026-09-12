import { jsonLdString } from "@/lib/json-ld";

/**
 * Structured data in a script element, serialized so that text a person wrote
 * cannot close the element (see src/lib/json-ld.ts).
 */
export function JsonLdScript({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}
