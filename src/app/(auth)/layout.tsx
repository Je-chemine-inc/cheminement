import Image from "next/image";
import Link from "next/link";
import { getTranslations, getLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import SiteMessages from "@/components/SiteMessages";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (session?.user) {
    const role = session.user.role as string;
    const dashboardMap: Record<string, string> = {
      client: "/client/dashboard",
      professional: "/professional/dashboard",
      admin: "/admin/dashboard",
    };
    const dashboardUrl = dashboardMap[role] || "/";
    redirect(dashboardUrl);
  }

  const t = await getTranslations("Auth.layout");
  const locale = await getLocale();

  return (
    <main className="min-h-screen flex items-center justify-center px-4 sm:px-6 lg:px-8 pt-32 pb-12 sm:py-12 bg-linear-to-br from-background via-muted to-accent relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-5"></div>

      {/* Logo/Brand - Top Left */}
      <Link
        href="/"
        className="absolute top-6 left-6 text-4xl font-semibold text-primary hover:text-primary/80 transition-colors z-20"
      >
        <Image
          src="/Logo.png"
          alt={t("logoAlt")}
          width={175}
          height={100}
          className="h-14 w-auto sm:h-auto sm:w-[175px]"
        />
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
