"use client";

/**
 * Spec 002 — "someone else pays for my sessions" in the booking funnel's review
 * step. Only shown while organization billing is on. What the client types is
 * a declaration: an admin confirms it before the organization is billed.
 *
 * The consent box starts unticked and is required to declare (Law 25): without
 * it nothing about the client may be sent to the organization.
 */
import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ThirdPartyPayerDraft = {
  declared: boolean;
  organizationName: string;
  caseNumber: string;
  consent: boolean;
};

export const EMPTY_THIRD_PARTY_PAYER: ThirdPartyPayerDraft = {
  declared: false,
  organizationName: "",
  caseNumber: "",
  consent: false,
};

/** What the booking routes accept, or undefined when nothing is declared. */
export function toThirdPartyPayerPayload(draft: ThirdPartyPayerDraft) {
  if (!draft.declared) return undefined;
  return {
    organizationName: draft.organizationName.trim(),
    caseNumber: draft.caseNumber.trim(),
    consent: draft.consent,
  };
}

/** The message key to show when the declaration cannot be sent as is. */
export function thirdPartyPayerErrorKey(draft: ThirdPartyPayerDraft): string | null {
  if (!draft.declared) return null;
  if (draft.organizationName.trim().length < 2) return "organizationRequired";
  if (!draft.consent) return "consentRequired";
  return null;
}

export function ThirdPartyPayerFields({
  value,
  onChange,
}: {
  value: ThirdPartyPayerDraft;
  onChange: (next: ThirdPartyPayerDraft) => void;
}) {
  const t = useTranslations("AppointmentBooking.thirdPartyPayer");
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/organization-billing")
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((b: { enabled?: boolean }) => {
        if (!cancelled) setEnabled(b.enabled === true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!enabled) return null;

  return (
    <div className="rounded-lg border border-border/60 p-4 space-y-3">
      <label className="flex items-start gap-3 text-sm cursor-pointer">
        <input
          type="checkbox"
          className="mt-1"
          checked={value.declared}
          onChange={(e) => onChange({ ...value, declared: e.target.checked })}
        />
        <span>
          <span className="font-medium flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            {t("question")}
          </span>
          <span className="block text-muted-foreground mt-0.5">{t("questionHelp")}</span>
        </span>
      </label>

      {value.declared && (
        <div className="space-y-3 pl-7">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tpp-org">{t("organizationName")}</Label>
              <Input
                id="tpp-org"
                maxLength={120}
                value={value.organizationName}
                onChange={(e) => onChange({ ...value, organizationName: e.target.value })}
                placeholder={t("organizationPlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpp-case">{t("caseNumber")}</Label>
              <Input
                id="tpp-case"
                maxLength={60}
                value={value.caseNumber}
                onChange={(e) => onChange({ ...value, caseNumber: e.target.value })}
                placeholder={t("caseNumberPlaceholder")}
              />
            </div>
          </div>
          <label className="flex items-start gap-3 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="mt-1"
              checked={value.consent}
              onChange={(e) => onChange({ ...value, consent: e.target.checked })}
            />
            <span>{t("consent")}</span>
          </label>
          <p className="text-xs text-muted-foreground">{t("cardStillRequired")}</p>
        </div>
      )}
    </div>
  );
}
