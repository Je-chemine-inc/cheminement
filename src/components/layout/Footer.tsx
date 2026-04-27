import Link from "next/link";
import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import { Instagram, Linkedin, Facebook } from "lucide-react";
import { XLogoIcon } from "@/components/icons/XLogoIcon";
import { getLegalTitles } from "@/lib/legal-content";
import type { LegalDocumentLocale } from "@/models/LegalDocument";

export async function Footer() {
  const currentYear = new Date().getFullYear();
  const t = await getTranslations("Footer");
  const tNav = await getTranslations("Header.nav");
  const rawLocale = await getLocale();
  const locale: LegalDocumentLocale = rawLocale === "fr" ? "fr" : "en";
  const legalTitles = await getLegalTitles(locale);

  return (
    <footer className="bg-primary text-primary-foreground pt-16 pb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
          {/* Brand */}
          <div className="col-span-1">
            <Link href="/" className="inline-block mb-6">
              <Image
                width={256}
                height={256}
                src="/Logo.png"
                alt="Je Chemine"
                className="h-8 w-auto"
              />
            </Link>
          </div>

          {/* Plateforme */}
          <div>
            <h4 className="font-bold text-primary-foreground mb-6 text-sm uppercase tracking-wide">
              {t("platform")}
            </h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/appointment" className="text-primary-foreground/70 hover:text-primary-foreground transition-colors">
                  {t("bookAppointment")}
                </Link>
              </li>
              <li>
                <Link href="/services" className="text-primary-foreground/70 hover:text-primary-foreground transition-colors">
                  {tNav("services")}
                </Link>
              </li>
              <li>
                <Link href="/why-us" className="text-primary-foreground/70 hover:text-primary-foreground transition-colors">
                  {tNav("whyUs")}
                </Link>
              </li>
              <li>
                <Link href="/explore" className="text-primary-foreground/70 hover:text-primary-foreground transition-colors">
                  {t("exploreResources")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="font-bold text-primary-foreground mb-6 text-sm uppercase tracking-wide">
              {t("contact")}
            </h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/press" className="text-primary-foreground/70 hover:text-primary-foreground transition-colors">
                  {t("press")}
                </Link>
              </li>
              <li>
                <Link href="/contact" className="text-primary-foreground/70 hover:text-primary-foreground transition-colors">
                  {t("contactUs")}
                </Link>
              </li>
              <li>
                <Link
                  href="/school-manager"
                  className="text-primary-foreground/70 hover:text-primary-foreground transition-colors"
                >
                  {t("linkSchoolManagerForm")}
                </Link>
              </li>
              <li>
                <Link
                  href="/services/contact-direct"
                  className="text-primary-foreground/70 hover:text-primary-foreground transition-colors"
                >
                  {t("linkEnterpriseForm")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Partenaires - logo clinique partenaire + réseaux */}
          <div>
            <h4 className="font-bold text-primary-foreground mb-6 text-sm uppercase tracking-wide">
              {t("partners")}
            </h4>
            <div className="space-y-4">
              <div className="inline-flex rounded-lg bg-primary-foreground px-1.5 py-0 shadow-sm ring-1 ring-black/10">
                <Image
                  src="/logocln.png"
                  alt="Clinique partenaire"
                  width={240}
                  height={96}
                  className="h-24 w-auto object-contain"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="https://linkedin.com/company/jechemine"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-primary-foreground/30 text-primary-foreground/70 transition-all hover:border-primary-foreground hover:text-primary-foreground"
                >
                  <Linkedin size={18} />
                </Link>
                <Link
                  href="https://x.com/jechemine"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t("socialX")}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-primary-foreground/30 text-primary-foreground/70 transition-all hover:border-primary-foreground hover:text-primary-foreground"
                >
                  <XLogoIcon size={18} />
                </Link>
                <Link
                  href="https://facebook.com/jechemine"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-primary-foreground/30 text-primary-foreground/70 transition-all hover:border-primary-foreground hover:text-primary-foreground"
                >
                  <Facebook size={18} />
                </Link>
                <Link
                  href="https://instagram.com/jechemine"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-primary-foreground/30 text-primary-foreground/70 transition-all hover:border-primary-foreground hover:text-primary-foreground"
                >
                  <Instagram size={18} />
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-primary-foreground/10 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs text-primary-foreground/50 font-semibold uppercase tracking-widest">
            {t("copyright", { year: currentYear })}
          </p>
          <div className="flex flex-wrap gap-6 text-xs text-primary-foreground/50 font-semibold justify-center">
            <Link href="/privacy" className="hover:text-primary-foreground transition-colors uppercase">
              {legalTitles.privacy || t("privacyPolicy")}
            </Link>
            <Link href="/terms" className="hover:text-primary-foreground transition-colors uppercase">
              {legalTitles.terms || t("termsOfUse")}
            </Link>
            <Link href="/professional-terms" className="hover:text-primary-foreground transition-colors uppercase">
              {legalTitles.professionalTerms || t("professionalTerms")}
            </Link>
            <Link href="/cookies" className="hover:text-primary-foreground transition-colors uppercase">
              {legalTitles.cookies || t("cookiePolicy")}
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
