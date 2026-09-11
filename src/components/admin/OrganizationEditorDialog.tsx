"use client";

/**
 * Spec 002 — the form that creates or edits a paying organization. Shared by
 * Admin → "Organismes payeurs" and the client's file, where an admin creates
 * the organization a client declared at booking without leaving the page.
 */
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const ORGANIZATION_KINDS = ["eap", "employer", "school", "person", "other"] as const;
export const ORGANIZATION_CYCLES = ["per_session", "monthly"] as const;
export const ORGANIZATION_GAP_POLICIES = [
  "client_copay",
  "clinic_absorbs_pro_full",
  "clinic_absorbs_pro_org_rate",
] as const;

/** An organization as `serializeOrganization` returns it. */
export interface OrganizationRecord {
  id: string;
  name: string;
  kind: (typeof ORGANIZATION_KINDS)[number];
  billingEmails: string[];
  contactName: string;
  phone: string;
  language: "fr" | "en";
  paymentTermsDays: number;
  billingCycle: (typeof ORGANIZATION_CYCLES)[number];
  negotiatedRate: number | null;
  gapPolicy: (typeof ORGANIZATION_GAP_POLICIES)[number];
  autoSendPerSession: boolean;
  requiresOwnForm: boolean;
  formNotes: string;
  internalNotes: string;
  active: boolean;
  activeCoverageCount: number;
}

/** The form keeps money and lists as text; the API converts. */
export type OrganizationDraft = Omit<
  OrganizationRecord,
  "billingEmails" | "negotiatedRate" | "paymentTermsDays" | "active" | "activeCoverageCount"
> & {
  billingEmails: string;
  negotiatedRate: string;
  paymentTermsDays: string;
};

export const emptyOrganizationDraft = (over: Partial<OrganizationDraft> = {}): OrganizationDraft => ({
  id: "",
  name: "",
  kind: "eap",
  billingEmails: "",
  contactName: "",
  phone: "",
  language: "fr",
  paymentTermsDays: "30",
  billingCycle: "per_session",
  negotiatedRate: "",
  gapPolicy: "client_copay",
  autoSendPerSession: false,
  requiresOwnForm: false,
  formNotes: "",
  internalNotes: "",
  ...over,
});

export const organizationToDraft = (o: OrganizationRecord): OrganizationDraft => ({
  ...o,
  billingEmails: o.billingEmails.join(", "),
  negotiatedRate: o.negotiatedRate === null ? "" : String(o.negotiatedRate),
  paymentTermsDays: String(o.paymentTermsDays),
});

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return body?.error ?? `Request failed (${res.status})`;
}

/**
 * Mount it with a `key` that changes per opening, so it starts from `initial`
 * each time.
 */
export function OrganizationEditorDialog({
  open,
  onOpenChange,
  initial,
  description,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: OrganizationDraft;
  /** Replaces the default help text under the title. */
  description?: string;
  onSaved: (organization: OrganizationRecord) => void | Promise<void>;
}) {
  const t = useTranslations("AdminDashboard.organizations");
  const [draft, setDraft] = useState<OrganizationDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const save = async () => {
    if (!draft.name.trim()) {
      setError(t("nameRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        draft.id ? `/api/admin/organizations/${draft.id}` : "/api/admin/organizations",
        {
          method: draft.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: draft.name,
            kind: draft.kind,
            billingEmails: draft.billingEmails,
            contactName: draft.contactName || null,
            phone: draft.phone || null,
            language: draft.language,
            paymentTermsDays: draft.paymentTermsDays,
            billingCycle: draft.billingCycle,
            negotiatedRate: draft.negotiatedRate.trim() || null,
            gapPolicy: draft.gapPolicy,
            autoSendPerSession: draft.autoSendPerSession,
            requiresOwnForm: draft.requiresOwnForm,
            formNotes: draft.formNotes || null,
            internalNotes: draft.internalNotes || null,
          }),
        },
      );
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json().catch(() => ({}))) as { organization?: OrganizationRecord };
      onOpenChange(false);
      if (body.organization) await onSaved(body.organization);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  const rateBelowPolicyWarning =
    draft.gapPolicy === "clinic_absorbs_pro_full" && draft.negotiatedRate.trim() !== "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{draft.id ? t("editTitle") : t("addTitle")}</DialogTitle>
          <DialogDescription>{description ?? t("editorHelp")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>{t("fields.name")}</Label>
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>{t("fields.kind")}</Label>
            <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v as OrganizationDraft["kind"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ORGANIZATION_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>{t(`kinds.${k}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("fields.language")}</Label>
            <Select value={draft.language} onValueChange={(v) => setDraft({ ...draft, language: v as "fr" | "en" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fr">Français</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>{t("fields.billingEmails")}</Label>
            <Input
              value={draft.billingEmails}
              onChange={(e) => setDraft({ ...draft, billingEmails: e.target.value })}
              placeholder="facturation@organisme.ca"
            />
            <p className="text-xs text-muted-foreground">{t("fields.billingEmailsHelp")}</p>
          </div>
          <div className="space-y-2">
            <Label>{t("fields.contactName")}</Label>
            <Input value={draft.contactName} onChange={(e) => setDraft({ ...draft, contactName: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>{t("fields.phone")}</Label>
            <Input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
          </div>

          <div className="space-y-2">
            <Label>{t("fields.negotiatedRate")}</Label>
            <Input
              inputMode="decimal"
              value={draft.negotiatedRate}
              onChange={(e) => setDraft({ ...draft, negotiatedRate: e.target.value })}
              placeholder={t("fields.negotiatedRatePlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("fields.paymentTermsDays")}</Label>
            <Input
              inputMode="numeric"
              value={draft.paymentTermsDays}
              onChange={(e) => setDraft({ ...draft, paymentTermsDays: e.target.value })}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>{t("fields.gapPolicy")}</Label>
            <Select value={draft.gapPolicy} onValueChange={(v) => setDraft({ ...draft, gapPolicy: v as OrganizationDraft["gapPolicy"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ORGANIZATION_GAP_POLICIES.map((g) => (
                  <SelectItem key={g} value={g}>{t(`gapPolicies.${g}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t(`gapPolicyHelp.${draft.gapPolicy}`)}</p>
            {rateBelowPolicyWarning && (
              <p className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t("negativeMarginWarning")}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>{t("fields.billingCycle")}</Label>
            <Select value={draft.billingCycle} onValueChange={(v) => setDraft({ ...draft, billingCycle: v as OrganizationDraft["billingCycle"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ORGANIZATION_CYCLES.map((c) => (
                  <SelectItem key={c} value={c}>{t(`cycles.${c}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:pt-7">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.autoSendPerSession}
                disabled={draft.billingCycle !== "per_session"}
                onChange={(e) => setDraft({ ...draft, autoSendPerSession: e.target.checked })}
              />
              {t("fields.autoSendPerSession")}
            </label>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.requiresOwnForm}
                onChange={(e) => setDraft({ ...draft, requiresOwnForm: e.target.checked })}
              />
              {t("fields.requiresOwnForm")}
            </label>
            {draft.requiresOwnForm && (
              <Textarea
                value={draft.formNotes}
                onChange={(e) => setDraft({ ...draft, formNotes: e.target.value })}
                placeholder={t("fields.formNotesPlaceholder")}
                rows={2}
              />
            )}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>{t("fields.internalNotes")}</Label>
            <Textarea
              value={draft.internalNotes}
              onChange={(e) => setDraft({ ...draft, internalNotes: e.target.value })}
              rows={2}
            />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={submitting}>
            {submitting ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
