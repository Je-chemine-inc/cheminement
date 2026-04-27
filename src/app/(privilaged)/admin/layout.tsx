import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/layout/AdminSidebar";
import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import { getLocale } from "next-intl/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import InactivityLogout from "@/components/auth/InactivityLogout";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session || session.user?.role !== "admin") {
    redirect("/login");
  }

  const locale = await getLocale();

  return (
    <SidebarProvider>
      <InactivityLogout />
      <div className="flex min-h-screen w-full">
        <AdminSidebar />
        <main className="flex-1 overflow-y-auto">
          <div className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b border-border/40 bg-background px-4 sm:px-6">
            <SidebarTrigger />
            <div className="flex-1" />
            <LocaleSwitcher currentLocale={locale} />
          </div>
          <div className="p-6 w-full">{children}</div>
        </main>
      </div>
    </SidebarProvider>
  );
}
