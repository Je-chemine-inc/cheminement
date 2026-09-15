"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CalendarCheck, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WaitlistOfferView } from "@/lib/waitlist-entries-types";

type Claimed = { professionalName: string; dayKey: string; time: string; respondBy: string };

type State =
  | { kind: "loading" }
  | { kind: "valid"; offer: WaitlistOfferView; booking: boolean; error: boolean }
  | { kind: "done"; result: Claimed }
  | { kind: "expired" | "claimed" | "invalid" | "unavailable" | "off" | "error" };

const FAILURES: Record<string, "expired" | "claimed" | "invalid" | "unavailable"> = {
  OFFER_EXPIRED: "expired",
  OFFER_CLAIMED: "claimed",
  OFFER_INVALID: "invalid",
  OFFER_UNAVAILABLE: "unavailable",
};

/** A person books the time a waitlist offer holds for them. */
export function ClaimWaitlistOffer() {
  const t = useTranslations("Waitlist.claim");
  const tWaitlist = useTranslations("Waitlist");
  const locale = useLocale();
  const tag = locale === "en" ? "en-CA" : "fr-CA";
  const token = useSearchParams().get("t") ?? "";
  const [state, setState] = useState<State>(token ? { kind: "loading" } : { kind: "invalid" });
  const [now, setNow] = useState(() => Date.now());

  const failureOf = async (res: Response): Promise<State> => {
    if (res.status === 404) return { kind: "off" };
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    const kind = body?.code ? FAILURES[body.code] : undefined;
    return { kind: kind ?? "error" };
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/waitlist/offers/${encodeURIComponent(token)}`, { cache: "no-store" });
      if (res.ok) {
        const body = (await res.json()) as { offer: WaitlistOfferView };
        setState({ kind: "valid", offer: body.offer, booking: false, error: false });
      } else {
        setState(await failureOf(res));
      }
    } catch {
      setState({ kind: "error" });
    }
  }, [token]);

  useEffect(() => {
    if (token) void load();
  }, [load, token]);

  useEffect(() => {
    if (state.kind !== "valid") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.kind]);

  const book = async (offer: WaitlistOfferView) => {
    setState({ kind: "valid", offer, booking: true, error: false });
    try {
      const res = await fetch("/api/waitlist/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        setState({ kind: "done", result: (await res.json()) as Claimed });
        return;
      }
      const failure = await failureOf(res);
      setState(failure.kind === "error" ? { kind: "valid", offer, booking: false, error: true } : failure);
    } catch {
      setState({ kind: "valid", offer, booking: false, error: true });
    }
  };

  // Days and times are Montréal wall-clock values: formatted in UTC so the visitor's zone never shifts them.
  const slotLabel = (dayKey: string, time: string) => {
    const at = new Date(`${dayKey}T${time}:00Z`);
    const day = new Intl.DateTimeFormat(tag, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(at);
    const clock = new Intl.DateTimeFormat(tag, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(at);
    return t("slot", { day, time: clock });
  };
  const instantLabel = (iso: string) =>
    new Intl.DateTimeFormat(tag, {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Toronto",
    }).format(new Date(iso));
  const money = new Intl.NumberFormat(tag, { style: "currency", currency: "CAD", maximumFractionDigits: 2 });

  const remaining = state.kind === "valid" ? new Date(state.offer.expiresAt).getTime() - now : 0;
  const expiredNow = state.kind === "valid" && remaining <= 0;
  const countdown = `${Math.floor(Math.max(remaining, 0) / 60000)}:${String(Math.floor((Math.max(remaining, 0) % 60000) / 1000)).padStart(2, "0")}`;

  const shell = (icon: React.ReactNode, title: string, body: React.ReactNode, footer?: React.ReactNode) => (
    <div className="container mx-auto max-w-xl px-4 py-16">
      <div className="space-y-5 rounded-2xl border border-border/60 bg-card p-8 text-center">
        {icon}
        <h1 className="font-serif text-2xl font-light text-foreground">{title}</h1>
        <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">{body}</div>
        {footer ?? (
          <Button asChild variant="outline">
            <Link href="/">{t("home")}</Link>
          </Button>
        )}
      </div>
    </div>
  );
  const clockIcon = <Clock className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />;

  if (state.kind === "loading") {
    return shell(<Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" aria-hidden="true" />, t("loading"), null, <span />);
  }
  if (state.kind === "done") {
    const { result } = state;
    return shell(
      <CheckCircle2 className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />,
      t("doneTitle"),
      <p>
        {t("doneBody", {
          name: result.professionalName,
          slot: slotLabel(result.dayKey, result.time),
          deadline: instantLabel(result.respondBy),
        })}
      </p>,
    );
  }
  if (state.kind === "valid" && !expiredNow) {
    const { offer } = state;
    return shell(
      <CalendarCheck className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />,
      t("title"),
      <>
        <p>{t("intro", { name: offer.professionalName })}</p>
        <dl className="mx-auto max-w-sm space-y-1 rounded-xl bg-muted/50 p-4 text-left text-foreground">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t("service")}</dt>
            <dd className="text-right">{tWaitlist(`services.${offer.service}`)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t("when")}</dt>
            <dd className="text-right">{slotLabel(offer.dayKey, offer.time)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t("duration")}</dt>
            <dd className="text-right">{t("minutes", { minutes: offer.durationMinutes })}</dd>
          </div>
          {offer.price !== null ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("price")}</dt>
              <dd className="text-right">{money.format(offer.price)}</dd>
            </div>
          ) : null}
        </dl>
        <p className="font-medium text-foreground" aria-live="polite">
          {t("heldFor", { countdown })}
        </p>
        <p className="text-xs">{t("whatNext", { name: offer.professionalName })}</p>
        {state.error ? (
          <p role="alert" className="text-destructive">
            {t("error")}
          </p>
        ) : null}
      </>,
      <div className="flex flex-col items-center gap-3">
        <Button onClick={() => void book(offer)} disabled={state.booking} className="gap-2">
          {state.booking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {state.booking ? t("booking") : t("cta")}
        </Button>
        <a href={offer.pageUrl} className="text-sm text-primary hover:underline">
          {t("viewPage")}
        </a>
      </div>,
    );
  }

  const kind = state.kind === "valid" ? "expired" : state.kind;
  return shell(clockIcon, t(`${kind}Title`), <p>{t(`${kind}Body`)}</p>);
}
