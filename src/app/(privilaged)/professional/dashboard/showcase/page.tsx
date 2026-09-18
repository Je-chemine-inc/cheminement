"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertCircle, Loader2, Store } from "lucide-react";
import { ShowcaseAvailabilityCard } from "@/components/showcase/ShowcaseAvailabilityCard";
import { ShowcaseEditorForm } from "@/components/showcase/ShowcaseEditorForm";
import { ShowcaseFactsCard } from "@/components/showcase/ShowcaseFactsCard";
import { ShowcaseProStatus } from "@/components/showcase/ShowcaseProStatus";
import { ShowcaseTeamResourcesNotice } from "@/components/showcase/ShowcaseTeamResourcesCard";
import type { ShowcaseEditorJson } from "@/lib/showcase-editor-types";
import { profileAPI } from "@/lib/api-client";
import type { IProfile } from "@/models/Profile";
import AvailabilitySchedule from "../profile/AvailabilitySchedule";

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

/**
 * « Ma page vitrine » (spec 003): while the team prepares the page, a notice;
 * once it is published, its status, « Disponibilités sur ma page » with the
 * professional's own hours (phase 3b), and the editor, whose saves go live.
 */
export default function ProfessionalShowcasePage() {
  const t = useTranslations("ShowcasePro");
  const [state, setState] = useState<State>({ kind: "loading" });
  // The professional's weekly hours, edited here as in Profil: their own save is what makes times appear.
  const [profile, setProfile] = useState<IProfile | null>(null);
  const [profileFailed, setProfileFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchShowcase().then((next) => {
      if (active) setState(next);
    });
    profileAPI
      .get()
      .then((loaded) => {
        if (!active) return;
        if (loaded) setProfile(loaded as IProfile);
        else setProfileFailed(true);
      })
      .catch(() => {
        if (active) setProfileFailed(true);
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
      ) : !state.view.page.published ? (
        <div className="max-w-2xl rounded-xl bg-card p-8">
          <Store className="h-8 w-8 text-primary" aria-hidden="true" />
          <h2 className="mt-4 font-serif text-xl font-light text-foreground">{t("preparing.title")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("preparing.body")}</p>
        </div>
      ) : (
        <>
          <ShowcaseProStatus view={state.view} onView={setView} />
          <ShowcaseAvailabilityCard
            apiBase="/api/professional/showcase"
            view={state.view}
            onView={setView}
            reload={reload}
            hours={
              profile ? (
                <AvailabilitySchedule
                  embedded
                  profile={profile}
                  setProfile={setProfile}
                  isEditable
                  onSaved={() => void reload()}
                />
              ) : profileFailed ? (
                <p className="text-sm text-muted-foreground">
                  {t("availability.hoursElsewhere")}{" "}
                  <Link href="/professional/dashboard/profile" className="text-primary hover:underline">
                    {t("availability.hoursElsewhereLink")}
                  </Link>
                </p>
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
              )
            }
          />
          <ShowcaseTeamResourcesNotice view={state.view} />
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
