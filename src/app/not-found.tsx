import Link from "next/link";
import { Compass } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * The 404 page.
 *
 * It now actually matters: until the root loading boundary was moved out of
 * the public tree, notFound() could not set a 404 status, so this page was
 * only ever served with HTTP 200 and search engines treated every mistyped
 * URL as a real page. Both visitors and crawlers land here for real now.
 *
 * Rendered outside the (public) layout, so it carries no header or footer —
 * hence the explicit way back rather than relying on site navigation.
 */
export default async function NotFound() {
  const t = await getTranslations("Common");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <Compass className="h-8 w-8 text-primary" />
        </div>

        <p className="mt-6 text-sm uppercase tracking-[0.3em] text-muted-foreground">
          404
        </p>
        <h1 className="mt-2 font-serif text-3xl font-light text-foreground">
          {t("notFoundTitle")}
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {t("notFoundBody")}
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("backHome")}
          </Link>
          <Link
            href="/book#resources"
            className="rounded-lg border border-border/60 bg-background px-5 py-2.5 text-sm text-foreground transition-colors hover:bg-muted"
          >
            {t("browseResources")}
          </Link>
        </div>
      </div>
    </div>
  );
}
