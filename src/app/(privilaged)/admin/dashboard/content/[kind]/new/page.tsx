"use client";

import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import ContentEntryForm, {
  type ContentEntryFormValues,
} from "@/components/admin/ContentEntryForm";
import { isContentKind } from "@/lib/content-kind";

const EMPTY_VALUES: ContentEntryFormValues = {
  slug: "",
  titleFr: "",
  titleEn: "",
  summaryFr: "",
  summaryEn: "",
  iconUrl: "",
  contentHtmlFr: "",
  contentHtmlEn: "",
  mediaType: "article",
  mediaUrl: "",
  status: "draft",
  sortOrder: 100,
};

export default function NewContentEntryPage() {
  const t = useTranslations("AdminContent");
  const router = useRouter();
  const params = useParams<{ kind: string }>();
  const kind = params?.kind && isContentKind(params.kind) ? params.kind : null;

  if (!kind) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Unknown content kind.
      </div>
    );
  }

  const handleSubmit = async (values: ContentEntryFormValues) => {
    try {
      const res = await fetch(`/api/admin/content/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { ok: false, error: data?.error ?? "Failed to create" };
      }
      const { slug } = (await res.json()) as { slug: string };
      router.push(
        `/admin/dashboard/content/${kind}/${slug}/edit?created=1`,
      );
      return { ok: true };
    } catch (err) {
      console.error("Create error:", err);
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to create",
      };
    }
  };

  return (
    <div className="space-y-6">
      <Link
        href={`/admin/dashboard/content/${kind}`}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("backToList")}
      </Link>
      <div>
        <h1 className="text-3xl font-serif font-light text-foreground">
          {t(`kind_${kind}.createTitle`)}
        </h1>
        <p className="mt-2 text-muted-foreground font-light">
          {t(`kind_${kind}.createSubtitle`)}
        </p>
      </div>

      <ContentEntryForm
        kind={kind}
        initialValues={EMPTY_VALUES}
        slugEditable={true}
        autoSlugFromTitle={true}
        onSubmit={handleSubmit}
        submitLabel={t("createSubmit")}
      />
    </div>
  );
}
