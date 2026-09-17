import Image from "next/image";
import Link from "next/link";
import { getTranslations, getLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import SiteMessages from "@/components/SiteMessages";

export default async function VerifyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("Auth.layout");
  const locale = await getLocale();

  return (
    <main className="min-h-screen flex items-center justify-center px-4 sm:px-6 lg:px-8 py-12 bg-linear-to-br from-background via-muted to-accent relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-5"></div>

      {/* Logo/Brand - Top Left */}
      <Link
        href="/"
        className="absolute top-6 left-6 text-4xl font-semibold text-primary hover:text-primary/80 transition-colors z-20"
      >
        <Image src="/Logo.png" alt={t("logoAlt")} width={175} height={100} />
      </Link>

      {/* Language Switcher - Top Right */}
      <div className="absolute top-6 right-6 z-20">
        <LocaleSwitcher currentLocale={locale} />
      </div>

      {/* Content */}
      <div className="relative z-10 w-full">
        <SiteMessages>{children}</SiteMessages>
      </div>
    </main>
  );
}
