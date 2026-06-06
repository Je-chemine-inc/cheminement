import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ProfessionalSidebar } from "@/components/layout/ProfessionalSidebar";
import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import { getLocale } from "next-intl/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import { LEGAL_VERSIONS } from "@/lib/legal";
import ProfessionalTermsGate from "@/components/legal/ProfessionalTermsGate";

export default async function ProfessionalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  const headerList = await headers();
  const pathname = headerList.get("x-pathname") || "";

  if (!session || session.user?.role !== "professional") {
    // Preserve the intended destination so email deep-links (e.g. the "Voir la
    // demande" CTA) land on /login and then resume to the requested page after
    // sign-in instead of dropping the pro on a blank/404 screen.
    const callback =
      pathname && pathname.startsWith("/professional")
        ? `?callbackUrl=${encodeURIComponent(pathname)}`
        : "";
    redirect(`/login${callback}`);
  }

  await connectToDatabase();
  const dbUser = await User.findById(session.user.id).select(
    "status adminApproved professionalTermsVersion privacyPolicyVersion",
  );

  // A professional is considered "not ready for the dashboard" if status is
  // pending OR admin hasn't approved yet. This double-gate catches legacy
  // accounts where status was bumped to "active" without adminApproved being
  // flipped — those pros must stay on the account-pending screen.
  const isAwaitingApproval =
    dbUser?.status === "pending" || dbUser?.adminApproved !== true;

  if (
    isAwaitingApproval &&
    !pathname.startsWith("/professional/account-pending")
  ) {
    redirect("/professional/account-pending");
  }
  if (
    !isAwaitingApproval &&
    pathname.startsWith("/professional/account-pending")
  ) {
    redirect("/professional/dashboard");
  }

  const locale = await getLocale();

  // Pros awaiting approval only see the thank-you page — no sidebar / no
  // dashboard chrome, and no terms-acceptance modal (consents are captured
  // during signup).
  if (isAwaitingApproval) {
    return (
      <div className="flex min-h-screen w-full flex-col bg-background">
        <div className="flex h-14 items-center justify-end gap-4 border-b border-border/40 px-4 sm:px-6">
          <LocaleSwitcher currentLocale={locale} />
        </div>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    );
  }

  // Re-acceptance gate: triggered when either the professional terms OR the
  // privacy policy version changes. The modal captures both at once.
  const needsTermsAcceptance =
    dbUser?.professionalTermsVersion !== LEGAL_VERSIONS.professionalTerms ||
    dbUser?.privacyPolicyVersion !== LEGAL_VERSIONS.privacy;

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <ProfessionalSidebar />
        <main className="flex-1 overflow-y-auto">
          <div className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b border-border/40 bg-background px-4 sm:px-6">
            <SidebarTrigger />
            <div className="flex-1" />
            <LocaleSwitcher currentLocale={locale} />
          </div>
          <div className="p-4 sm:p-6 w-full">{children}</div>
        </main>
      </div>
      <ProfessionalTermsGate needsAcceptance={needsTermsAcceptance} />
    </SidebarProvider>
  );
}
