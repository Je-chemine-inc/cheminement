import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { getLocale } from "next-intl/server";
import { authOptions } from "@/lib/auth";
import { getAdminUiPermissions } from "@/lib/admin-rbac";
import { buildShowcasePreview } from "@/lib/showcase-queries";
import { ShowcaseProfileView } from "@/components/showcase/ShowcaseProfileView";

/**
 * A professional's page as the public would see it — the draft, or with
 * `?source=published` the version online — for an admin who manages
 * professionals (spec 003).
 */
export const dynamic = "force-dynamic";

export default async function AdminShowcasePreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ source?: string }>;
}) {
  const session = await getServerSession(authOptions);
  const permissions = await getAdminUiPermissions(session?.user);
  if (!permissions.manageProfessionals) notFound();
  const [{ userId }, { source }] = await Promise.all([params, searchParams]);
  const locale = (await getLocale()) === "en" ? "en" : "fr";
  const profile = await buildShowcasePreview(userId, source === "published" ? "published" : "draft", locale);
  if (!profile) notFound();
  return (
    <div className="-m-4 overflow-hidden rounded-xl border border-border/40 sm:-m-6">
      <ShowcaseProfileView profile={profile} preview />
    </div>
  );
}
