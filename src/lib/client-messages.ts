/**
 * The translation messages sent to the browser (spec 003).
 *
 * www pages get the whole bundle: client components everywhere read it. A
 * showcase city host renders server components, apart from the global
 * providers (src/components/providers.tsx), so it gets only their namespaces.
 * With the whole bundle a professional's public page was 417 KB of HTML, most
 * of it messages it never used (debt-map 2026-09-12).
 *
 * ⚠ A client component added to the providers, or to the city pages, must
 * have its namespace listed here — client-messages.spec.ts checks the
 * providers and the showcase client components rendered on city hosts.
 */
export const CITY_HOST_CLIENT_NAMESPACES = [
  "CookieConsent",
  "InactivityGuard",
  "ShowcaseBooking",
  "ShowcaseDirectory",
  "ShowcaseWaitlist",
] as const;

export function clientMessagesFor<T extends Record<string, unknown>>(messages: T, onCityHost: boolean): T {
  if (!onCityHost) return messages;
  const picked: Record<string, unknown> = {};
  for (const namespace of CITY_HOST_CLIENT_NAMESPACES) {
    if (namespace in messages) picked[namespace] = messages[namespace];
  }
  return picked as T;
}
