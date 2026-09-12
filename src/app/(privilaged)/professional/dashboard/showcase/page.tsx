"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Loader2, Store } from "lucide-react";
import { ShowcaseEditorForm } from "@/components/showcase/ShowcaseEditorForm";
import { ShowcaseFactsCard } from "@/components/showcase/ShowcaseFactsCard";
import { ShowcaseProStatus } from "@/components/showcase/ShowcaseProStatus";
import type { ShowcaseEditorJson } from "@/lib/showcase-editor-types";

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "not-invited" }
  | { kind: "ready"; view: ShowcaseEditorJson };

async function fetchShowcase(): Promise<Exclude<State, { kind: "loading" }>> {
  try {
    const res = await fetch("/api/professional/showcase", { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) return { kind: "error" };
    if (body.invited !== true) return { kind: "not-invited" };
    return { kind: "ready", view: body as ShowcaseEditorJson };
  } catch {
    return { kind: "error" };
  }
}

/** « Ma page vitrine » — the professional prepares their showcase page (spec 003). */
export default function ProfessionalShowcasePage() {
  const t = useTranslations("ShowcasePro");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    void fetchShowcase().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, []);

  // After a photo change. A failed reload keeps the editor, and its unsaved text, on screen.
  const reload = useCallback(async () => {
    const next = await fetchShowcase();
    if (next.kind === "ready") setState(next);
  }, []);

  const setView = (view: ShowcaseEditorJson) => setState({ kind: "ready", view });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-light text-foreground">{t("title")}</h1>
        <p className="mt-2 max-w-3xl font-light text-muted-foreground">{t("subtitle")}</p>
      </div>

      {state.kind === "loading" ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : state.kind === "error" ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {t("loadError")}
        </p>
      ) : state.kind === "not-invited" ? (
        <div className="max-w-2xl rounded-xl bg-card p-8">
          <Store className="h-8 w-8 text-primary" aria-hidden="true" />
          <h2 className="mt-4 font-serif text-xl font-light text-foreground">{t("notInvited.title")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("notInvited.body")}</p>
        </div>
      ) : (
        <>
          <ShowcaseProStatus view={state.view} onView={setView} />
          <ShowcaseFactsCard view={state.view} profileHref="/professional/dashboard/profile" />
          <ShowcaseEditorForm
            key={state.view.page.slug}
            apiBase="/api/professional/showcase"
            view={state.view}
            onView={setView}
            reload={reload}
          />
        </>
      )}
    </div>
  );
}
