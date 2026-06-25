import type { Metadata } from "next";
import "./globals.css";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "@/components/providers";

const SITE_URL = "https://www.jechemine.ca";
const SITE_TITLE = "Je chemine - Soins en santé mentale";
const SITE_DESCRIPTION =
  "Plateforme de santé mentale du Québec : jumelage avec des professionnels qualifiés, prise de rendez-vous et accompagnement bilingue, en personne ou en ligne.";

export const metadata: Metadata = {
  // Resolves relative URLs (incl. the auto-generated og:image) to absolute, which
  // social/link-preview scrapers require.
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
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
        <NextIntlClientProvider messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
