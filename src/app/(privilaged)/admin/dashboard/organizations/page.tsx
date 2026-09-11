"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Building2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

const KINDS = ["eap", "employer", "school", "person", "other"] as const;
const CYCLES = ["per_session", "monthly"] as const;
const GAP_POLICIES = [
  "client_copay",
  "clinic_absorbs_pro_full",
  "clinic_absorbs_pro_org_rate",
] as const;

interface Organization {
  id: string;
  name: string;
  kind: (typeof KINDS)[number];
  billingEmails: string[];
  contactName: string;
  phone: string;
  language: "fr" | "en";
  paymentTermsDays: number;
  billingCycle: (typeof CYCLES)[number];
  negotiatedRate: number | null;
  gapPolicy: (typeof GAP_POLICIES)[number];
  autoSendPerSession: boolean;
  requiresOwnForm: boolean;
  formNotes: string;
  internalNotes: string;
  active: boolean;
  activeCoverageCount: number;
}

/** The form keeps money and lists as text; the API converts. */
type Draft = Omit<Organization, "billingEmails" | "negotiatedRate" | "paymentTermsDays" | "active" | "activeCoverageCount"> & {
  billingEmails: string;
  negotiatedRate: string;
  paymentTermsDays: string;
};

const emptyDraft = (): Draft => ({
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
});

const toDraft = (o: Organization): Draft => ({
  ...o,
  billingEmails: o.billingEmails.join(", "),
  negotiatedRate: o.negotiatedRate === null ? "" : String(o.negotiatedRate),
  paymentTermsDays: String(o.paymentTermsDays),
});

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return body?.error ?? `Request failed (${res.status})`;
}

export default function AdminOrganizationsPage() {
  const t = useTranslations("AdminDashboard.organizations");

  const [items, setItems] = useState<Organization[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [switchConfirm, setSwitchConfirm] = useState<boolean | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [archiving, setArchiving] = useState<Organization | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [orgRes, flagRes] = await Promise.all([
        fetch(`/api/admin/organizations${showArchived ? "?includeArchived=1" : ""}`, {
          cache: "no-store",
        }),
        fetch("/api/admin/organization-billing", { cache: "no-store" }),
      ]);
      if (!orgRes.ok) throw new Error(await readError(orgRes));
      setItems(((await orgRes.json()) as { organizations: Organization[] }).organizations);
      if (flagRes.ok) setEnabled(((await flagRes.json()) as { enabled: boolean }).enabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (items ?? []).filter((o) => !q || o.name.toLowerCase().includes(q));
  }, [items, search]);

  const openCreate = () => {
    setDraft(emptyDraft());
    setMutationError(null);
    setEditorOpen(true);
  };
  const openEdit = (o: Organization) => {
    setDraft(toDraft(o));
    setMutationError(null);
    setEditorOpen(true);
  };

  const save = async () => {
    if (!draft.name.trim()) {
      setMutationError(t("nameRequired"));
      return;
    }
    setSubmitting(true);
    setMutationError(null);
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
      setEditorOpen(false);
      await fetchItems();
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  const setArchived = async (o: Organization, archived: boolean) => {
    setSubmitting(true);
    setMutationError(null);
    try {
      const res = await fetch(`/api/admin/organizations/${o.id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      if (!res.ok) throw new Error(await readError(res));
      setArchiving(null);
      await fetchItems();
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  const applySwitch = async (next: boolean) => {
    setSubmitting(true);
    setMutationError(null);
    try {
      const res = await fetch("/api/admin/organization-billing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error(await readError(res));
      setEnabled(next);
      setSwitchConfirm(null);
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  const rateBelowPolicyWarning =
    draft.gapPolicy === "clinic_absorbs_pro_full" && draft.negotiatedRate.trim() !== "";

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-serif font-light text-foreground">{t("title")}</h1>
          <p className="text-muted-foreground font-light mt-1 max-w-2xl">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={fetchItems} aria-label={t("refresh")}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button className="gap-2" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t("add")}
          </Button>
        </div>
      </div>

      {enabled !== null && (
        <div
          className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
            enabled
              ? "border-teal-500/40 bg-teal-500/5"
              : "border-border/60 bg-muted/40"
          }`}
        >
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              {enabled ? t("switchOn") : t("switchOff")}
            </p>
            <p className="text-xs text-muted-foreground max-w-2xl">
              {enabled ? t("switchHelpOn") : t("switchHelpOff")}
            </p>
          </div>
          <Button
            variant={enabled ? "outline" : "default"}
            onClick={() => setSwitchConfirm(!enabled)}
          >
            {enabled ? t("turnOff") : t("turnOn")}
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="sm:max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          {t("showArchived")}
        </label>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">{t("empty")}</p>
      ) : (
        <div className="rounded-lg border border-border/60 divide-y divide-border/40">
          {visible.map((o) => (
            <div key={o.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="font-light text-foreground">{o.name}</span>
                  <Badge variant="outline">{t(`kinds.${o.kind}`)}</Badge>
                  {!o.active && (
                    <Badge variant="outline" className="text-muted-foreground">
                      {t("archived")}
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t(`cycles.${o.billingCycle}`)} ·{" "}
                  {o.negotiatedRate !== null
                    ? t("rateValue", { amount: o.negotiatedRate.toFixed(2) })
                    : t("noRate")}{" "}
                  · {t(`gapPolicies.${o.gapPolicy}`)} ·{" "}
                  {t("activeCoverages", { count: o.activeCoverageCount })}
                </div>
                {o.billingEmails.length > 0 && (
                  <div className="text-xs text-muted-foreground truncate">
                    {o.billingEmails.join(", ")}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="sm" className="gap-1" onClick={() => openEdit(o)}>
                  <Pencil className="h-4 w-4" />
                  {t("edit")}
                </Button>
                {o.active ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1"
                    onClick={() => {
                      setMutationError(null);
                      setArchiving(o);
                    }}
                  >
                    <Archive className="h-4 w-4" />
                    {t("archive")}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1"
                    disabled={submitting}
                    onClick={() => setArchived(o, false)}
                  >
                    <ArchiveRestore className="h-4 w-4" />
                    {t("unarchive")}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / edit */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft.id ? t("editTitle") : t("addTitle")}</DialogTitle>
            <DialogDescription>{t("editorHelp")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>{t("fields.name")}</Label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>{t("fields.kind")}</Label>
              <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v as Draft["kind"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
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
              <Select value={draft.gapPolicy} onValueChange={(v) => setDraft({ ...draft, gapPolicy: v as Draft["gapPolicy"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GAP_POLICIES.map((g) => (
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
              <Select value={draft.billingCycle} onValueChange={(v) => setDraft({ ...draft, billingCycle: v as Draft["billingCycle"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CYCLES.map((c) => (
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
          {mutationError && <p className="text-sm text-destructive">{mutationError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)} disabled={submitting}>
              {t("cancel")}
            </Button>
            <Button onClick={save} disabled={submitting}>
              {submitting ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive */}
      <Dialog open={Boolean(archiving)} onOpenChange={(o) => !o && setArchiving(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("archiveTitle")}</DialogTitle>
            <DialogDescription>
              {t("archiveBody", { name: archiving?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          {mutationError && <p className="text-sm text-destructive">{mutationError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiving(null)} disabled={submitting}>
              {t("cancel")}
            </Button>
            <Button onClick={() => archiving && setArchived(archiving, true)} disabled={submitting}>
              {t("archive")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The switch */}
      <Dialog open={switchConfirm !== null} onOpenChange={(o) => !o && setSwitchConfirm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{switchConfirm ? t("confirmOnTitle") : t("confirmOffTitle")}</DialogTitle>
            <DialogDescription>
              {switchConfirm ? t("confirmOnBody") : t("confirmOffBody")}
            </DialogDescription>
          </DialogHeader>
          {mutationError && <p className="text-sm text-destructive">{mutationError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSwitchConfirm(null)} disabled={submitting}>
              {t("cancel")}
            </Button>
            <Button
              variant={switchConfirm ? "default" : "destructive"}
              onClick={() => switchConfirm !== null && applySwitch(switchConfirm)}
              disabled={submitting}
            >
              {switchConfirm ? t("turnOn") : t("turnOff")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
