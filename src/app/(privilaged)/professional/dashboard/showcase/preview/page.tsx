import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { getLocale } from "next-intl/server";
import { authOptions } from "@/lib/auth";
import { buildShowcasePreview } from "@/lib/showcase-queries";
import { ShowcaseProfileView } from "@/components/showcase/ShowcaseProfileView";

/**
 * The professional's draft page, as the public would see it once approved
 * (spec 003). The professional layout already requires an approved account.
 */
export const dynamic = "force-dynamic";

export default async function ShowcasePreviewPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== "professional") notFound();
  const locale = (await getLocale()) === "en" ? "en" : "fr";
  const profile = await buildShowcasePreview(session.user.id, "draft", locale);
  if (!profile) notFound();
  return (
    <div className="-m-4 overflow-hidden rounded-xl border border-border/40 sm:-m-6">
      <ShowcaseProfileView profile={profile} preview />
    </div>
  );
}
