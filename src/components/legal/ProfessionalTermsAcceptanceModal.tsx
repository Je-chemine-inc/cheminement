"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LegalDocumentDTO {
  title: string;
  subtitle?: string;
  lastUpdated: string;
  version: string;
  contentHtml: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onAccept: () => Promise<void> | void;
}

export default function ProfessionalTermsAcceptanceModal({
  open,
  onClose,
  onAccept,
}: Props) {
  const tModal = useTranslations(
    "Legal.professionalTerms.acceptanceModal",
  );
  const tUi = useTranslations("Legal.ui");
  const locale = useLocale();

  const [doc, setDoc] = useState<LegalDocumentDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setScrolledToEnd(false);
      setAgreed(false);
      setSubmitting(false);
      setError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/legal/professionalTerms?locale=${locale}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error("Failed to load document");
        const data = (await res.json()) as LegalDocumentDTO;
        if (!cancelled) setDoc(data);
      } catch (err) {
        console.error("Load terms error:", err);
        if (!cancelled) setLoadError(tModal("errorGeneric"));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, locale, tModal]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom =
      el.scrollTop + el.clientHeight >= el.scrollHeight - 16;
    if (atBottom && !scrolledToEnd) {
      setScrolledToEnd(true);
    }
  };

  const canAccept = scrolledToEnd && agreed && !submitting && !!doc;

  const handleAccept = async () => {
    if (!canAccept) return;
    setSubmitting(true);
    setError(null);
    try {
      await onAccept();
    } catch (err) {
      console.error("Terms acceptance error:", err);
      setError(tModal("errorGeneric"));
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative flex h-full max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-background shadow-2xl">
        {/* Header */}
        <div className="border-b border-border/60 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                {doc
                  ? `${tUi("lastUpdated")} · ${doc.lastUpdated}`
                  : tModal("versionLabel")}
              </p>
              <h2 className="font-serif text-xl font-light text-foreground md:text-2xl">
                {doc?.title ?? tModal("title")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {tModal("description")}
              </p>
            </div>
            <a
              href="/professional-terms"
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {tModal("openFullPage")}
              </span>
            </a>
          </div>
        </div>

        {/* Scrollable content */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-6 py-5"
        >
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : !doc ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div
              className="legal-prose legal-prose-sm"
              dangerouslySetInnerHTML={{ __html: doc.contentHtml }}
            />
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border/60 bg-muted/30 px-6 py-4 space-y-3">
          {!scrolledToEnd ? (
            <p className="text-xs text-muted-foreground">
              {tModal("scrollHint")}
            </p>
          ) : (
            <p className="text-xs text-primary flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5" />
              {tModal("readyToAccept")}
            </p>
          )}

          <label
            className={`flex items-start gap-3 text-sm ${
              scrolledToEnd
                ? "cursor-pointer text-foreground"
                : "cursor-not-allowed text-muted-foreground"
            }`}
          >
            <input
              type="checkbox"
              checked={agreed}
              disabled={!scrolledToEnd}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            <span className="leading-relaxed">
              {tModal("checkboxLabel")}
            </span>
          </label>

          {error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              className="text-destructive border-destructive/40 hover:bg-destructive/10"
              onClick={onClose}
              disabled={submitting}
            >
              {tModal("laterButton")}
            </Button>
            <Button
              onClick={handleAccept}
              disabled={!canAccept}
              className="min-w-[200px]"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {tModal("submitting")}
                </>
              ) : (
                tModal("acceptButton")
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
