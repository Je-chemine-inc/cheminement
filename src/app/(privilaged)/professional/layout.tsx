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
import InactivityLogout from "@/components/auth/InactivityLogout";

export default async function ProfessionalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session || session.user?.role !== "professional") {
    redirect("/login");
  }

  const headerList = await headers();
  const pathname = headerList.get("x-pathname") || "";
  await connectToDatabase();
  const dbUser = await User.findById(session.user.id).select(
    "status professionalTermsVersion",
  );
  if (
    dbUser?.status === "pending" &&
    !pathname.startsWith("/professional/account-pending")
  ) {
    redirect("/professional/account-pending");
  }
  if (
    dbUser?.status !== "pending" &&
    pathname.startsWith("/professional/account-pending")
  ) {
    redirect("/professional/dashboard");
  }

  const needsTermsAcceptance =
    dbUser?.professionalTermsVersion !== LEGAL_VERSIONS.professionalTerms;

  const locale = await getLocale();

  return (
    <SidebarProvider>
      <InactivityLogout />
      <div className="flex min-h-screen w-full">
        <ProfessionalSidebar />
        <main className="flex-1 overflow-y-auto">
          <div className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b border-border/40 bg-background px-4 sm:px-6">
            <SidebarTrigger />
            <div className="flex-1" />
            <LocaleSwitcher currentLocale={locale} />
          </div>
          <div className="p-6 w-full">{children}</div>
        </main>
      </div>
      <ProfessionalTermsGate needsAcceptance={needsTermsAcceptance} />
    </SidebarProvider>
  );
}
