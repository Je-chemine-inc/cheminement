"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarCog, Check, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Professional calendar-sync (iCal subscription) dialog. Reveals the pro's
 * private feed URL — minting it on first enable — with copy / open-in-calendar
 * actions and a rotate-to-revoke control. Self-contained: renders its own
 * trigger button.
 */
export function CalendarSyncDialog() {
  const t = useTranslations("CalendarSync");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [webcalUrl, setWebcalUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [working, setWorking] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the current feed state when the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/professional/calendar-feed")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((d: { enabled: boolean; url?: string | null; webcalUrl?: string | null }) => {
        if (cancelled) return;
        setEnabled(Boolean(d.enabled));
        setUrl(d.url ?? null);
        setWebcalUrl(d.webcalUrl ?? null);
      })
      .catch(() => !cancelled && setError(t("loadError")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, t]);

  const mint = async (rotate: boolean) => {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch("/api/professional/calendar-feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rotate }),
      });
      if (!res.ok) throw new Error("mint");
      const d = (await res.json()) as {
        enabled: boolean;
        url: string;
        webcalUrl: string;
      };
      setEnabled(true);
      setUrl(d.url);
      setWebcalUrl(d.webcalUrl);
      setConfirmRotate(false);
    } catch {
      setError(t("loadError"));
    } finally {
      setWorking(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — user can still select the field manually */
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 px-4 py-2 rounded-full font-light text-sm bg-muted text-foreground hover:bg-muted/80 transition-colors"
        >
          <CalendarCog className="h-4 w-4" />
          {t("button")}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">…</p>
          ) : !enabled || !url ? (
            <Button
              type="button"
              className="gap-2"
              onClick={() => mint(false)}
              disabled={working}
            >
              <CalendarCog className="h-4 w-4" />
              {working ? t("enabling") : t("enable")}
            </Button>
          ) : (
            <>
              <div className="space-y-2">
                <Label>{t("urlLabel")}</Label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={url} onFocus={(e) => e.target.select()} />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={copy}
                    aria-label={t("copy")}
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {webcalUrl && (
                <a
                  href={webcalUrl}
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-4 w-4" />
                  {t("openInCalendar")}
                </a>
              )}

              <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">
                  {t("instructionsTitle")}
                </p>
                <p>{t("instructionsGoogle")}</p>
                <p>{t("instructionsApple")}</p>
                <p>{t("instructionsOutlook")}</p>
              </div>

              <p className="text-xs text-muted-foreground">{t("privacyNote")}</p>

              {confirmRotate ? (
                <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 space-y-3">
                  <p className="text-sm text-foreground">
                    {t("regenerateConfirm")}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => mint(true)}
                      disabled={working}
                    >
                      {working ? t("regenerating") : t("regenerateConfirmYes")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmRotate(false)}
                      disabled={working}
                    >
                      {t("regenerateConfirmNo")}
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmRotate(true)}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("regenerate")}
                </button>
              )}
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
