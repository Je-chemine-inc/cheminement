import type { Metadata } from "next";
import "./globals.css";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "@/components/providers";
import OrganizationJsonLd from "@/components/seo/OrganizationJsonLd";
import { clientMessagesFor } from "@/lib/client-messages";
import { SHOWCASE_PAGE_HEADER } from "@/lib/showcase-hosts";
import { SITE_OPEN_GRAPH, SITE_NAME } from "@/lib/site-metadata";
import { SITE_URL } from "@/lib/site-url";

const SITE_TITLE = `${SITE_NAME} - Soins en santé mentale`;
const SITE_DESCRIPTION =
  "Plateforme de santé mentale du Québec : jumelage avec des professionnels qualifiés, prise de rendez-vous et accompagnement bilingue, en personne ou en ligne.";

export const metadata: Metadata = {
  // Resolves relative URLs (incl. the auto-generated og:image) to absolute, which
  // social/link-preview scrapers require.
  metadataBase: new URL(SITE_URL),
  // Self-referencing canonical on every route. The site was reachable on four
  // addresses (apex/www × http/https); the middleware now redirects them, but
  // this is the belt to that braces — it also collapses any tracking query
  // string a visitor arrives with into a single indexable URL.
  alternates: {
    canonical: "./",
  },
  title: {
    default: SITE_TITLE,
    // Pages set only their own name; the brand is appended here so every
    // title is distinct without repeating it in each file.
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  icons: {
    icon: "/favicon.png",
  },
  // og:image / twitter:image are auto-injected from src/app/opengraph-image.tsx.
  // No url here: it would make every page that inherits this claim the home page's address.
  // The home page sets its own; everywhere else the canonical is the address.
  openGraph: {
    ...SITE_OPEN_GRAPH,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  // A professional's page gets only the messages its client components read
  // (the middleware sets this header; see src/lib/client-messages.ts).
  const onShowcasePage = Boolean((await headers()).get(SHOWCASE_PAGE_HEADER));

  return (
    <html lang={locale}>
      <body className="antialiased" suppressHydrationWarning>
        {/* Identifies the business to search engines. Built from the
            admin-configured contact settings, so it cannot drift from what the
            site actually says. */}
        <OrganizationJsonLd />
        <NextIntlClientProvider messages={clientMessagesFor(messages, onShowcasePage)}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
