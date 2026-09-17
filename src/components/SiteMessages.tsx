import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

/**
 * The whole message bundle, for the browser.
 *
 * The root layout sends only what the global providers read (`SHOWCASE_PAGE_CLIENT_NAMESPACES`),
 * because a professional's page needs nothing more and the bundle is ~480 KB. **Every other area of
 * the site must wrap its pages in this**, and that is not an optimisation detail — it is what keeps
 * the site readable:
 *
 * Next does not re-render a shared layout on a client-side navigation. The root layout used to
 * choose the bundle from the request's path, so a visitor who arrived on a professional's page and
 * then clicked into the site kept its five namespaces: every client component after that printed its
 * key — « HeroSection.headline », « Dashboard.sidebar.overview » — while the server-rendered parts
 * around them read fine. It was live for a day before a client reported it (2026-09-17), because a
 * direct load of any page is always correct and only navigation *from* a professional's page is not.
 *
 * `client-messages.spec.ts` fails if an area under `src/app` renders pages without it.
 */
export default async function SiteMessages({ children }: { children: React.ReactNode }) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
