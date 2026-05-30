"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Menu,
  X,
  ChevronDown,
  UserCircle,
  Briefcase,
  LogOut,
  Settings,
  User,
} from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { useSession, signOut } from "next-auth/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import Image from "next/image";

export function Header() {
  const pathname = usePathname();
  const t = useTranslations("Header");
  const locale = useLocale();
  const router = useRouter();
  const { data: session, status } = useSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut({ redirect: false });
    router.push("/");
  };

  const aboutDropdownItems = [
    { href: "/who-we-are", label: t("nav.whoWeAre") },
    { href: "/why-us", label: t("nav.whyUs") },
  ];

  const servicesDropdownItems = [
    { href: "/services", label: t("nav.servicesOverview") },
    {
      href: "/services#sentiers",
      label: t("nav.schoolServices"),
      highlight: true,
    },
  ];

  return (
    <header className="fixed top-0 z-50 w-full border-b border-border/20 bg-card">
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="flex h-14 items-center justify-between">
          {/* Logo/Brand */}
          <div className="flex items-center">
            <Link
              href="/"
              tabIndex={-1}
              className="flex items-center hover:opacity-80 transition-opacity"
            >
              <Image
                width={256}
                height={256}
                src="/Logo.png"
                alt="Je chemine"
                className="h-8 w-auto"
              />
            </Link>
          </div>

          {/* Navigation */}
          <nav className="hidden md:flex items-center gap-5">
            {/* Home link */}
            <Link
              href="/"
              className={`text-sm font-semibold transition-all duration-300 ease-in-out ${
                pathname === "/"
                  ? "text-primary font-semibold underline underline-offset-4"
                  : "text-foreground hover:text-primary"
              }`}
            >
              {t("nav.home")}
            </Link>

            {/* About Us Dropdown */}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                className={`inline-flex items-center gap-1 text-sm font-semibold transition-all duration-300 ease-in-out focus-visible:outline-none ${
                  pathname === "/who-we-are" || pathname === "/why-us"
                    ? "text-primary underline underline-offset-4"
                    : "text-foreground hover:text-primary"
                }`}
              >
                {t("nav.aboutUs")}
                <ChevronDown className="w-3.5 h-3.5 transition-transform duration-300 data-[state=open]:rotate-180" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-44">
                {aboutDropdownItems.map((item) => (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-2 cursor-pointer text-sm ${
                        pathname === item.href ? "text-primary font-medium" : ""
                      }`}
                    >
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Services Dropdown */}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                className={`inline-flex items-center gap-1 text-sm font-semibold transition-all duration-300 ease-in-out focus-visible:outline-none ${
                  pathname.startsWith("/services")
                    ? "text-primary underline underline-offset-4"
                    : "text-foreground hover:text-primary"
                }`}
              >
                {t("nav.services")}
                <ChevronDown className="w-3.5 h-3.5 transition-transform duration-300 data-[state=open]:rotate-180" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-44">
                {servicesDropdownItems.map((item) => (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-2 cursor-pointer text-sm ${
                        item.highlight ? "text-primary font-medium" : ""
                      }`}
                    >
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Approaches link */}
            <Link
              href="/approaches"
              className={`text-sm font-semibold transition-all duration-300 ease-in-out ${
                pathname === "/approaches"
                  ? "text-primary font-semibold underline underline-offset-4"
                  : "text-foreground hover:text-primary"
              }`}
            >
              {t("nav.approaches")}
            </Link>

            {/* Nouveautés link */}
            <Link
              href="/nouveautes"
              className={`text-sm font-semibold transition-all duration-300 ease-in-out ${
                pathname === "/nouveautes" ||
                pathname.startsWith("/nouveautes/")
                  ? "text-primary font-semibold underline underline-offset-4"
                  : "text-foreground hover:text-primary"
              }`}
            >
              {t("nav.nouveautes")}
            </Link>

            {/* Contact link */}
            <Link
              href="/contact"
              className={`text-sm font-semibold transition-all duration-300 ease-in-out ${
                pathname === "/contact"
                  ? "text-primary font-semibold underline underline-offset-4"
                  : "text-foreground hover:text-primary"
              }`}
            >
              {t("nav.contact")}
            </Link>

            {/* I'm a Professional link */}
            <Link
              href="/professional"
              className={`text-sm font-semibold transition-all duration-300 ease-in-out ${
                pathname === "/professional"
                  ? "text-primary font-semibold underline underline-offset-4"
                  : "text-foreground hover:text-primary"
              }`}
            >
              {t("nav.professional")}
            </Link>
          </nav>

          {/* CTA Buttons */}
          <div className="flex items-center gap-3">
            <LocaleSwitcher currentLocale={locale} />

            {status === "loading" ? (
              // Loading state
              <div className="hidden sm:flex items-center gap-2">
                <div className="w-18 h-7 bg-muted animate-pulse rounded"></div>
              </div>
            ) : session?.user ? (
              // Authenticated user
              <>
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger className="hidden sm:inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <User className="w-3.5 h-3.5" />
                    {session.user.name || session.user.email}
                    <ChevronDown className="w-3.5 h-3.5 transition-transform duration-300 data-[state=open]:rotate-180" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <div className="px-2 py-1.5 text-sm font-medium text-muted-foreground">
                      {t("userMenu.signedInAs", { email: session.user.email || "" })}
                    </div>
                    <DropdownMenuSeparator />

                    {/* Role-based dashboard links */}
                    {session.user.role === "admin" && (
                      <DropdownMenuItem asChild>
                        <Link
                          href="/admin/dashboard"
                          className="flex items-center gap-2 cursor-pointer text-sm"
                        >
                          <Settings className="w-3.5 h-3.5" />
                          {t("userMenu.adminDashboard")}
                        </Link>
                      </DropdownMenuItem>
                    )}

                    {session.user.role === "professional" && (
                      <DropdownMenuItem asChild>
                        <Link
                          href="/professional/dashboard"
                          className="flex items-center gap-2 cursor-pointer text-sm"
                        >
                          <Briefcase className="w-3.5 h-3.5" />
                          {t("userMenu.professionalDashboard")}
                        </Link>
                      </DropdownMenuItem>
                    )}

                    {session.user.role === "client" && (
                      <DropdownMenuItem asChild>
                        <Link
                          href="/client/dashboard"
                          className="flex items-center gap-2 cursor-pointer text-sm"
                        >
                          <UserCircle className="w-3.5 h-3.5" />
                          {t("userMenu.clientDashboard")}
                        </Link>
                      </DropdownMenuItem>
                    )}

                    {session.user.role === "guest" && (
                      <>
                        <DropdownMenuItem asChild>
                          <Link
                            href="/appointment"
                            className="flex items-center gap-2 cursor-pointer text-sm"
                          >
                            <UserCircle className="w-3.5 h-3.5" />
                            {t("userMenu.bookAppointment")}
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link
                            href="/signup"
                            className="flex items-center gap-2 cursor-pointer text-sm text-primary"
                          >
                            <UserCircle className="w-3.5 h-3.5" />
                            {t("userMenu.createFullAccount")}
                          </Link>
                        </DropdownMenuItem>
                      </>
                    )}

                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => handleSignOut()}
                      className="flex items-center gap-2 cursor-pointer text-sm text-red-600 focus:text-red-600"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      {t("userMenu.logout")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              // Unauthenticated user
              <>
                <Link
                  href="/login"
                  className="hidden sm:inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold text-primary transition-all duration-300 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("login")}
                </Link>
                <Link
                  href="/signup"
                  className="hidden sm:inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("getStarted")}
                </Link>
              </>
            )}

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden inline-flex items-center justify-center rounded-md p-2 text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu panel */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-border/20 bg-card">
          <nav className="container mx-auto px-4 py-4 flex flex-col gap-3">
            <Link
              href="/"
              onClick={() => setMobileMenuOpen(false)}
              className={`text-sm font-semibold py-2 text-primary ${
                pathname === "/" ? "underline underline-offset-4" : ""
              }`}
            >
              {t("nav.home")}
            </Link>

            {/* About Us */}
            <div className="flex flex-col gap-1">
              <span
                className={`text-sm font-semibold text-primary py-2 ${
                  aboutDropdownItems.some((item) => item.href === pathname)
                    ? "underline underline-offset-4"
                    : ""
                }`}
              >
                {t("nav.aboutUs")}
              </span>
              {aboutDropdownItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`text-sm pl-4 py-1.5 ${
                    pathname === item.href
                      ? "text-primary font-medium"
                      : "text-foreground"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>

            {/* Services */}
            <div className="flex flex-col gap-1">
              <span
                className={`text-sm font-semibold text-primary py-2 ${
                  pathname.startsWith("/services")
                    ? "underline underline-offset-4"
                    : ""
                }`}
              >
                {t("nav.services")}
              </span>
              {servicesDropdownItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`text-sm pl-4 py-1.5 ${
                    pathname === item.href
                      ? "text-primary font-medium"
                      : "text-foreground"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>

            <Link
              href="/approaches"
              onClick={() => setMobileMenuOpen(false)}
              className={`text-sm font-semibold py-2 text-primary ${
                pathname === "/approaches" ? "underline underline-offset-4" : ""
              }`}
            >
              {t("nav.approaches")}
            </Link>

            <Link
              href="/nouveautes"
              onClick={() => setMobileMenuOpen(false)}
              className={`text-sm font-semibold py-2 text-primary ${
                pathname === "/nouveautes" ||
                pathname.startsWith("/nouveautes/")
                  ? "underline underline-offset-4"
                  : ""
              }`}
            >
              {t("nav.nouveautes")}
            </Link>

            <Link
              href="/contact"
              onClick={() => setMobileMenuOpen(false)}
              className={`text-sm font-semibold py-2 text-primary ${
                pathname === "/contact" ? "underline underline-offset-4" : ""
              }`}
            >
              {t("nav.contact")}
            </Link>

            <Link
              href="/professional"
              onClick={() => setMobileMenuOpen(false)}
              className={`text-sm font-semibold py-2 text-primary ${
                pathname === "/professional" ? "underline underline-offset-4" : ""
              }`}
            >
              {t("nav.professional")}
            </Link>

            {/* Auth buttons for mobile */}
            <div className="border-t border-border/20 pt-3 mt-1 flex flex-col gap-2">
              {status === "loading" ? (
                <div className="w-full h-9 bg-muted animate-pulse rounded"></div>
              ) : session?.user ? (
                <>
                  <div className="text-sm text-muted-foreground px-1 py-1">
                    {session.user.name || session.user.email}
                  </div>

                  {session.user.role === "admin" && (
                    <Link
                      href="/admin/dashboard"
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center gap-2 text-sm py-2 text-foreground"
                    >
                      <Settings className="w-3.5 h-3.5" />
                      {t("userMenu.adminDashboard")}
                    </Link>
                  )}
                  {session.user.role === "professional" && (
                    <Link
                      href="/professional/dashboard"
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center gap-2 text-sm py-2 text-foreground"
                    >
                      <Briefcase className="w-3.5 h-3.5" />
                      {t("userMenu.professionalDashboard")}
                    </Link>
                  )}
                  {session.user.role === "client" && (
                    <Link
                      href="/client/dashboard"
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center gap-2 text-sm py-2 text-foreground"
                    >
                      <UserCircle className="w-3.5 h-3.5" />
                      {t("userMenu.clientDashboard")}
                    </Link>
                  )}
                  {session.user.role === "guest" && (
                    <>
                      <Link
                        href="/appointment"
                        onClick={() => setMobileMenuOpen(false)}
                        className="flex items-center gap-2 text-sm py-2 text-foreground"
                      >
                        <UserCircle className="w-3.5 h-3.5" />
                        {t("userMenu.bookAppointment")}
                      </Link>
                      <Link
                        href="/signup"
                        onClick={() => setMobileMenuOpen(false)}
                        className="flex items-center gap-2 text-sm py-2 text-primary"
                      >
                        <UserCircle className="w-3.5 h-3.5" />
                        {t("userMenu.createFullAccount")}
                      </Link>
                    </>
                  )}

                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      handleSignOut();
                    }}
                    className="flex items-center gap-2 text-sm py-2 text-red-600"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    {t("userMenu.logout")}
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/login"
                    onClick={() => setMobileMenuOpen(false)}
                    className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-accent"
                  >
                    {t("login")}
                  </Link>
                  <Link
                    href="/signup"
                    onClick={() => setMobileMenuOpen(false)}
                    className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    {t("getStarted")}
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
