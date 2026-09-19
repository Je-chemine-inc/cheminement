import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import SiteMessages from "@/components/SiteMessages";
import { loginRedirectFor } from "@/lib/login-redirect";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) {
    // Keep the requested page (and its query) so login resumes there.
    const headerList = await headers();
    redirect(
      loginRedirectFor(
        headerList.get("x-pathname") || "",
        headerList.get("x-search") || "",
      ),
    );
  }

  return <SiteMessages>{children}</SiteMessages>;
}
