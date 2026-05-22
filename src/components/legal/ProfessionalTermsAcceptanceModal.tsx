"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

interface Props {
  open: boolean;
  onClose: () => void;
  onAccept: () => Promise<void> | void;
}

/**
 * Renders the post-login mandatory consent for professionals. Replaces the
 * previous scroll-to-bottom modal (which would freeze on a blank screen if
 * the legal HTML failed to load). The current design follows the same pattern
 * as the signup form's last step:
 *   - Two external links opening in new tabs (Terms + Privacy)
 *   - Each checkbox is disabled until its link is opened at least once
 *   - "Accept" button is disabled until both links opened AND both boxes ticked
 *   - Declining ("Refuser et se déconnecter") signs the user out
 */
export default function ProfessionalTermsAcceptanceModal({
  open,
  onClose,
  onAccept,
}: Props) {
  const t = useTranslations("Legal.professionalTerms.acceptanceModal");

  const [termsOpened, setTermsOpened] = useState(false);
  const [privacyOpened, setPrivacyOpened] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedPrivacy, setAgreedPrivacy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTermsOpened(false);
      setPrivacyOpened(false);
      setAgreedTerms(false);
      setAgreedPrivacy(false);
      setSubmitting(false);
      setError(null);
    }
  }, [open]);

  const canAccept =
    termsOpened &&
    privacyOpened &&
    agreedTerms &&
    agreedPrivacy &&
    !submitting;

  const handleAccept = async () => {
    if (!canAccept) return;
    setSubmitting(true);
    setError(null);
    try {
      await onAccept();
    } catch (err) {
      console.error("Terms acceptance error:", err);
      setError(t("errorGeneric"));
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-background shadow-2xl">
        {/* Header */}
        <div className="border-b border-border/60 px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h2 className="font-serif text-xl font-light text-foreground md:text-2xl">
                {t("title")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("description")}
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <p className="text-sm text-foreground leading-relaxed">
            {t("introInstruction")}
          </p>

          {/* Professional Terms */}
          <div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-3">
            <a
              href="/professional-terms"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setTermsOpened(true)}
              className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              {t("openTermsLink")}
            </a>
            <label
              className={`flex items-start gap-3 text-sm leading-snug ${
                termsOpened
                  ? "cursor-pointer text-foreground"
                  : "cursor-not-allowed text-muted-foreground"
              }`}
            >
              <Checkbox
                checked={agreedTerms}
                disabled={!termsOpened || submitting}
                onCheckedChange={(checked) => setAgreedTerms(checked === true)}
                className="mt-0.5"
              />
              <span>{t("termsCheckboxLabel")}</span>
            </label>
            {!termsOpened && (
              <p className="text-xs italic text-muted-foreground">
                {t("openToEnableHint")}
              </p>
            )}
          </div>

          {/* Privacy Policy */}
          <div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-3">
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setPrivacyOpened(true)}
              className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              {t("openPrivacyLink")}
            </a>
            <label
              className={`flex items-start gap-3 text-sm leading-snug ${
                privacyOpened
                  ? "cursor-pointer text-foreground"
                  : "cursor-not-allowed text-muted-foreground"
              }`}
            >
              <Checkbox
                checked={agreedPrivacy}
                disabled={!privacyOpened || submitting}
                onCheckedChange={(checked) =>
                  setAgreedPrivacy(checked === true)
                }
                className="mt-0.5"
              />
              <span>{t("privacyCheckboxLabel")}</span>
            </label>
            {!privacyOpened && (
              <p className="text-xs italic text-muted-foreground">
                {t("openToEnableHint")}
              </p>
            )}
          </div>

          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}
        </div>

        {/* Footer */}
        <div className="border-t border-border/60 bg-muted/20 px-6 py-4">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              className="text-destructive border-destructive/40 hover:bg-destructive/10"
              onClick={onClose}
              disabled={submitting}
            >
              {t("laterButton")}
            </Button>
            <Button
              onClick={handleAccept}
              disabled={!canAccept}
              className="min-w-[220px]"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("submitting")}
                </>
              ) : (
                t("acceptButton")
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
