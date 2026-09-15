"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

type State = "idle" | "working" | "done" | "invalid" | "error";

/** The client hands their declined or expired request to Je chemine's matching. */
export function RerouteDirectRequest() {
  const t = useTranslations("DirectRequests.reroute");
  const token = useSearchParams().get("t") ?? "";
  const [state, setState] = useState<State>(token ? "idle" : "invalid");

  const confirm = async () => {
    setState("working");
    try {
      const res = await fetch("/api/appointments/direct/reroute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      setState(res.ok ? "done" : res.status === 410 ? "invalid" : "error");
    } catch {
      setState("error");
    }
  };

  const title = state === "done" ? t("doneTitle") : state === "invalid" ? t("invalidTitle") : t("title");
  const body = state === "done" ? t("doneBody") : state === "invalid" ? t("invalidBody") : t("body");

  return (
    <div className="container mx-auto max-w-xl px-4 py-16">
      <div className="space-y-5 rounded-2xl border border-border/60 bg-card p-8 text-center">
        {state === "done" ? (
          <CheckCircle2 className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />
        ) : (
          <Users className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />
        )}
        <h1 className="font-serif text-2xl font-light text-foreground">{title}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
        {state === "error" ? (
          <p role="alert" className="text-sm text-destructive">
            {t("error")}
          </p>
        ) : null}
        {state === "idle" || state === "working" || state === "error" ? (
          <Button onClick={() => void confirm()} disabled={state === "working"} className="gap-2">
            {state === "working" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {state === "working" ? t("working") : t("cta")}
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link href="/">{t("home")}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
