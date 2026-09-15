/**
 * The translation messages sent to the browser (spec 003).
 *
 * The site's pages get the whole bundle: client components everywhere read
 * it. A professional's page (www.jechemine.ca/<slug>) renders server
 * components, apart from the global providers (src/components/providers.tsx)
 * and its own few client components, so it gets only their namespaces. With
 * the whole bundle a professional's public page was 417 KB of HTML, most of it
 * messages it never used (debt-map 2026-09-12). A path the middleware marks
 * that turns out to be a 404 renders the root not-found page, which translates
 * on the server only.
 *
 * ⚠ A client component added to the providers, or to a professional's page,
 * must have its namespace listed here — client-messages.spec.ts checks the
 * providers and the showcase client components.
 */
export const SHOWCASE_PAGE_CLIENT_NAMESPACES = [
  "CookieConsent",
  "InactivityGuard",
  "ShowcaseBooking",
  "ShowcaseWaitlist",
] as const;

export function clientMessagesFor<T extends Record<string, unknown>>(messages: T, onShowcasePage: boolean): T {
  if (!onShowcasePage) return messages;
  const picked: Record<string, unknown> = {};
  for (const namespace of SHOWCASE_PAGE_CLIENT_NAMESPACES) {
    if (namespace in messages) picked[namespace] = messages[namespace];
  }
  return picked as T;
}
