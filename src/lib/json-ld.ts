/**
 * Serializes structured data for a `<script type="application/ld+json">`.
 *
 * JSON.stringify leaves "<" as is, so text a person wrote — a professional's
 * name or headline on a showcase page — could close the script element and
 * inject markup. Every "<" becomes its JSON escape, which parses back to the
 * same value. (The escape is built from char codes on purpose.)
 */
const LESS_THAN_ESCAPE = `${String.fromCharCode(92)}u003c`;

export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, LESS_THAN_ESCAPE);
}
