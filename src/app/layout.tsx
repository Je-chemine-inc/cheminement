import type { Metadata } from "next";
import "./globals.css";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "@/components/providers";
import OrganizationJsonLd from "@/components/seo/OrganizationJsonLd";
import { SITE_URL } from "@/lib/site-url";

const SITE_TITLE = "Je chemine - Soins en santé mentale";
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
    // title is distinct without repeating "Je chemine" in each file.
    template: "%s | Je chemine",
  },
  description: SITE_DESCRIPTION,
  icons: {
    icon: "/favicon.png",
  },
  // og:image / twitter:image are auto-injected from src/app/opengraph-image.tsx.
  openGraph: {
    type: "website",
    siteName: "Je chemine",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "fr_CA",
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

  return (
    <html lang={locale}>
      <body className="antialiased" suppressHydrationWarning>
        {/* Identifies the business to search engines. Built from the
            admin-configured contact settings, so it cannot drift from what the
            site actually says. */}
        <OrganizationJsonLd />
        <NextIntlClientProvider messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
