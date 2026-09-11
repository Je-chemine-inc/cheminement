"use client";

/**
 * Spec 002 — the organizations that pay for this client's sessions, in the
 * admin patient file. Renders nothing for an admin without manageBilling (the
 * API answers 403).
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Building2, Loader2, Plus, ShieldCheck, ShieldOff } from "lucide-react";
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

const MODES = ["full", "split", "per_session", "external"] as const;
const CONSENT_METHODS = ["written", "online_checkbox", "verbal", "form_on_file"] as const;

type Mode = (typeof MODES)[number];
type ConsentMethod = (typeof CONSENT_METHODS)[number];

interface OrgOption {
  id: string;
  name: string;
  gapPolicy: string;
  negotiatedRate: number | null;
}

interface Coverage {
  id: string;
  beneficiaryKey: string;
  beneficiaryName: string;
  organization: { id: string; name: string; active: boolean; gapPolicy: string | null; negotiatedRate: number | null };
  caseNumber: string;
  mode: Mode;
  split: { type: "fixed" | "percent"; value: number } | null;
  maxSessions: number | null;
  used: number;
  rateOverride: number | null;
  validFrom: string | null;
  validUntil: string | null;
  status: "active" | "exhausted" | "ended";
  endReason: string;
  consent: { status: "none" | "given" | "withdrawn"; recordedAt: string | null; method: string | null; note: string };
}

interface PendingDeclaration {
  appointmentId: string;
  organizationName: string;
  caseNumber: string;
  declaredAt: string | null;
  beneficiaryName: string;
}

type TermsDraft = {
  id: string;
  /** Set when the editor confirms what the client declared at booking. */
  declarationId: string;
  organizationId: string;
  forLovedOne: boolean;
  firstName: string;
  lastName: string;
  caseNumber: string;
  mode: Mode;
  splitType: "percent" | "fixed";
  splitValue: string;
  maxSessions: string;
  rateOverride: string;
  validFrom: string;
  validUntil: string;
  consentGiven: boolean;
  consentMethod: ConsentMethod;
  consentNote: string;
};

const emptyTerms = (): TermsDraft => ({
  id: "",
  declarationId: "",
  organizationId: "",
  forLovedOne: false,
  firstName: "",
  lastName: "",
  caseNumber: "",
  mode: "full",
  splitType: "percent",
  splitValue: "",
  maxSessions: "",
  rateOverride: "",
  validFrom: "",
  validUntil: "",
  consentGiven: false,
  consentMethod: "written",
  consentNote: "",
});

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return body?.error ?? `Request failed (${res.status})`;
}

export function CoveragePanel({ clientId }: { clientId: string }) {
  const t = useTranslations("AdminDashboard.coverages");

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [coverages, setCoverages] = useState<Coverage[]>([]);
  const [declarations, setDeclarations] = useState<PendingDeclaration[]>([]);
  const [rejecting, setRejecting] = useState<PendingDeclaration | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  const [editor, setEditor] = useState<TermsDraft | null>(null);
  const [consentFor, setConsentFor] = useState<{ coverage: Coverage; action: "give" | "withdraw" } | null>(null);
  const [consentMethod, setConsentMethod] = useState<ConsentMethod>("written");
  const [consentNote, setConsentNote] = useState("");
  const [ending, setEnding] = useState<Coverage | null>(null);
  const [endReason, setEndReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/coverages?clientId=${clientId}`, { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        setAllowed(false);
        return;
      }
      setAllowed(true);
      if (res.ok) {
        const body = (await res.json()) as {
          coverages: Coverage[];
          pendingDeclarations?: PendingDeclaration[];
        };
        setCoverages(body.coverages);
        setDeclarations(body.pendingDeclarations ?? []);
      }
      const [orgRes, flagRes] = await Promise.all([
        fetch("/api/admin/organizations", { cache: "no-store" }),
        fetch("/api/admin/organization-billing", { cache: "no-store" }),
      ]);
      if (orgRes.ok) setOrgs(((await orgRes.json()) as { organizations: OrgOption[] }).organizations);
      if (flagRes.ok) setEnabled(((await flagRes.json()) as { enabled: boolean }).enabled);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  if (allowed === false) return null;

  const openCreate = () => {
    setError(null);
    setEditor(emptyTerms());
  };
  const openConfirm = (d: PendingDeclaration) => {
    setError(null);
    // Preselect the organization whose name matches what the client typed.
    const match = orgs.find(
      (o) => o.name.trim().toLowerCase() === d.organizationName.trim().toLowerCase(),
    );
    setEditor({
      ...emptyTerms(),
      declarationId: d.appointmentId,
      organizationId: match?.id ?? "",
      caseNumber: d.caseNumber,
    });
  };

  const openEdit = (c: Coverage) => {
    setError(null);
    setEditor({
      ...emptyTerms(),
      id: c.id,
      organizationId: c.organization.id,
      caseNumber: c.caseNumber,
      mode: c.mode,
      splitType: c.split?.type ?? "percent",
      splitValue: c.split ? String(c.split.value) : "",
      maxSessions: c.maxSessions ? String(c.maxSessions) : "",
      rateOverride: c.rateOverride !== null ? String(c.rateOverride) : "",
      validFrom: c.validFrom ?? "",
      validUntil: c.validUntil ?? "",
    });
  };

  const run = async (fn: () => Promise<Response>, done: () => void) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) throw new Error(await readError(res));
      done();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  const saveTerms = () => {
    if (!editor) return;
    const terms = {
      caseNumber: editor.caseNumber || null,
      mode: editor.mode,
      split:
        editor.mode === "split"
          ? { type: editor.splitType, value: editor.splitValue }
          : null,
      maxSessions: editor.maxSessions || null,
      rateOverride: editor.rateOverride || null,
      validFrom: editor.validFrom || null,
      validUntil: editor.validUntil || null,
    };
    if (editor.id) {
      return run(
        () =>
          fetch(`/api/admin/coverages/${editor.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(terms),
          }),
        () => setEditor(null),
      );
    }
    if (!editor.organizationId) {
      setError(t("organizationRequired"));
      return;
    }
    if (editor.declarationId) {
      return run(
        () =>
          fetch(`/api/admin/appointments/${editor.declarationId}/payer-declaration`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...terms, action: "confirm", organizationId: editor.organizationId }),
          }),
        () => setEditor(null),
      );
    }
    if (editor.consentGiven && !editor.consentNote.trim()) {
      setError(t("consentNoteRequired"));
      return;
    }
    return run(
      () =>
        fetch("/api/admin/coverages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...terms,
            clientId,
            organizationId: editor.organizationId,
            beneficiary: editor.forLovedOne
              ? { firstName: editor.firstName, lastName: editor.lastName }
              : "self",
            consent: editor.consentGiven
              ? { method: editor.consentMethod, note: editor.consentNote }
              : null,
          }),
        }),
      () => setEditor(null),
    );
  };

  const saveConsent = () => {
    if (!consentFor) return;
    if (!consentNote.trim()) {
      setError(t("consentNoteRequired"));
      return;
    }
    return run(
      () =>
        fetch(`/api/admin/coverages/${consentFor.coverage.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: consentFor.action,
            method: consentMethod,
            note: consentNote,
          }),
        }),
      () => {
        setConsentFor(null);
        setConsentNote("");
      },
    );
  };

  const confirmReject = () => {
    if (!rejecting) return;
    return run(
      () =>
        fetch(`/api/admin/appointments/${rejecting.appointmentId}/payer-declaration`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reject", reason: rejectReason }),
        }),
      () => {
        setRejecting(null);
        setRejectReason("");
      },
    );
  };

  const confirmEnd = () => {
    if (!ending) return;
    return run(
      () =>
        fetch(`/api/admin/coverages/${ending.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "end", reason: endReason }),
        }),
      () => {
        setEnding(null);
        setEndReason("");
      },
    );
  };

  const selectedOrg = editor
    ? orgs.find((o) => o.id === editor.organizationId) ??
      (editor.id ? coverages.find((c) => c.id === editor.id)?.organization : undefined)
    : undefined;
  const marginWarning =
    selectedOrg?.gapPolicy === "clinic_absorbs_pro_full" &&
    (selectedOrg.negotiatedRate !== null || (editor?.rateOverride ?? "") !== "");

  const describeTerms = (c: Coverage) => {
    const parts = [t(`modes.${c.mode}`)];
    if (c.mode === "split" && c.split) {
      parts.push(
        c.split.type === "percent"
          ? t("splitPercent", { value: c.split.value })
          : t("splitFixed", { value: c.split.value.toFixed(2) }),
      );
    }
    if (c.rateOverride !== null) parts.push(t("rateOverrideValue", { value: c.rateOverride.toFixed(2) }));
    return parts.join(" · ");
  };

  return (
    <div className="bg-card border border-border/40 rounded-xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-xl font-serif font-light flex items-center gap-2">
          <Building2 className="h-5 w-5" /> {t("title")}
        </h2>
        <Button type="button" variant="outline" className="gap-2" onClick={openCreate} disabled={orgs.length === 0}>
          <Plus className="h-4 w-4" />
          {t("add")}
        </Button>
      </div>

      {!enabled && (
        <p className="mb-4 rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">{t("switchOffNotice")}</p>
      )}
      {orgs.length === 0 && !loading && (
        <p className="mb-4 text-xs text-muted-foreground">{t("noOrganizations")}</p>
      )}

      {declarations.length > 0 && (
        <div className="mb-4 space-y-2">
          {declarations.map((d) => (
            <div
              key={d.appointmentId}
              className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-0.5">
                <p className="font-medium text-amber-900 dark:text-amber-200">
                  {t("declaredTitle", { name: d.organizationName })}
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  {[
                    d.caseNumber ? t("caseNumberValue", { value: d.caseNumber }) : "",
                    d.beneficiaryName ? t("forLovedOne", { name: d.beneficiaryName }) : "",
                    t("declaredHelp"),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" className="h-7 text-xs" onClick={() => openConfirm(d)} disabled={orgs.length === 0}>
                  {t("confirmDeclaration")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => {
                    setError(null);
                    setRejectReason("");
                    setRejecting(d);
                  }}
                >
                  {t("rejectDeclaration")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : coverages.length === 0 ? (
        <p className="text-muted-foreground text-sm font-light py-4 text-center">{t("empty")}</p>
      ) : (
        <div className="divide-y divide-border/40 rounded-lg border border-border/60">
          {coverages.map((c) => (
            <div key={c.id} className={`space-y-2 p-4 ${c.status === "ended" ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">{c.organization.name}</span>
                <Badge variant="outline">{t(`statuses.${c.status}`)}</Badge>
                {c.consent.status === "given" ? (
                  <Badge className="gap-1 bg-green-100 text-green-800 hover:bg-green-100">
                    <ShieldCheck className="h-3 w-3" />
                    {t("consentGiven")}
                  </Badge>
                ) : (
                  <Badge className="gap-1 bg-amber-100 text-amber-800 hover:bg-amber-100">
                    <ShieldOff className="h-3 w-3" />
                    {c.consent.status === "withdrawn" ? t("consentWithdrawn") : t("consentMissing")}
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <div>
                  {c.beneficiaryKey === "self" ? t("forClient") : t("forLovedOne", { name: c.beneficiaryName })}
                  {c.caseNumber ? ` · ${t("caseNumberValue", { value: c.caseNumber })}` : ""}
                </div>
                <div>{describeTerms(c)}</div>
                <div>
                  {c.maxSessions
                    ? t("sessionsUsedOf", { used: c.used, max: c.maxSessions })
                    : t("sessionsUsed", { used: c.used })}
                  {c.validFrom || c.validUntil
                    ? ` · ${t("validity", { from: c.validFrom ?? "—", until: c.validUntil ?? "—" })}`
                    : ""}
                </div>
                {c.status === "ended" && c.endReason && <div>{t("endedBecause", { reason: c.endReason })}</div>}
              </div>
              {c.status !== "ended" && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openEdit(c)}>
                    {t("editTerms")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => {
                      setError(null);
                      setConsentNote("");
                      setConsentFor({ coverage: c, action: c.consent.status === "given" ? "withdraw" : "give" });
                    }}
                  >
                    {c.consent.status === "given" ? t("withdrawConsent") : t("recordConsent")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-destructive hover:text-destructive"
                    onClick={() => {
                      setError(null);
                      setEndReason("");
                      setEnding(c);
                    }}
                  >
                    {t("end")}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create / edit terms */}
      <Dialog open={Boolean(editor)} onOpenChange={(o) => !o && setEditor(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editor?.declarationId ? t("confirmTitle") : editor?.id ? t("editTitle") : t("addTitle")}
            </DialogTitle>
            <DialogDescription>
              {editor?.declarationId ? t("confirmHelp") : t("editorHelp")}
            </DialogDescription>
          </DialogHeader>
          {editor && (
            <div className="grid gap-4 sm:grid-cols-2">
              {!editor.id && (
                <>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>{t("fields.organization")}</Label>
                    <Select value={editor.organizationId} onValueChange={(v) => setEditor({ ...editor, organizationId: v })}>
                      <SelectTrigger><SelectValue placeholder={t("fields.organizationPlaceholder")} /></SelectTrigger>
                      <SelectContent>
                        {orgs.map((o) => (
                          <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {!editor.declarationId && (
                  <div className="space-y-2 sm:col-span-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editor.forLovedOne}
                        onChange={(e) => setEditor({ ...editor, forLovedOne: e.target.checked })}
                      />
                      {t("fields.forLovedOne")}
                    </label>
                    {editor.forLovedOne && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input placeholder={t("fields.firstName")} value={editor.firstName} onChange={(e) => setEditor({ ...editor, firstName: e.target.value })} />
                        <Input placeholder={t("fields.lastName")} value={editor.lastName} onChange={(e) => setEditor({ ...editor, lastName: e.target.value })} />
                        <p className="text-xs text-muted-foreground sm:col-span-2">{t("fields.lovedOneHelp")}</p>
                      </div>
                    )}
                  </div>
                  )}
                </>
              )}
              <div className="space-y-2">
                <Label>{t("fields.caseNumber")}</Label>
                <Input value={editor.caseNumber} onChange={(e) => setEditor({ ...editor, caseNumber: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>{t("fields.mode")}</Label>
                <Select value={editor.mode} onValueChange={(v) => setEditor({ ...editor, mode: v as Mode })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODES.map((m) => (
                      <SelectItem key={m} value={m}>{t(`modes.${m}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">{t(`modeHelp.${editor.mode}`)}</p>
              {editor.mode === "split" && (
                <>
                  <div className="space-y-2">
                    <Label>{t("fields.splitType")}</Label>
                    <Select value={editor.splitType} onValueChange={(v) => setEditor({ ...editor, splitType: v as "percent" | "fixed" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percent">{t("fields.splitTypePercent")}</SelectItem>
                        <SelectItem value="fixed">{t("fields.splitTypeFixed")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{editor.splitType === "percent" ? t("fields.splitPercent") : t("fields.splitFixed")}</Label>
                    <Input inputMode="decimal" value={editor.splitValue} onChange={(e) => setEditor({ ...editor, splitValue: e.target.value })} />
                  </div>
                </>
              )}
              <div className="space-y-2">
                <Label>{t("fields.maxSessions")}</Label>
                <Input inputMode="numeric" value={editor.maxSessions} placeholder={t("fields.maxSessionsPlaceholder")} onChange={(e) => setEditor({ ...editor, maxSessions: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>{t("fields.rateOverride")}</Label>
                <Input inputMode="decimal" value={editor.rateOverride} placeholder={t("fields.rateOverridePlaceholder")} onChange={(e) => setEditor({ ...editor, rateOverride: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>{t("fields.validFrom")}</Label>
                <Input type="date" value={editor.validFrom} onChange={(e) => setEditor({ ...editor, validFrom: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>{t("fields.validUntil")}</Label>
                <Input type="date" value={editor.validUntil} onChange={(e) => setEditor({ ...editor, validUntil: e.target.value })} />
              </div>
              {marginWarning && (
                <p className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300 sm:col-span-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {t("negativeMarginWarning")}
                </p>
              )}
              {editor.declarationId && (
                <p className="flex items-center gap-2 rounded-md bg-green-50 p-2 text-xs text-green-800 sm:col-span-2 dark:bg-green-950/30 dark:text-green-300">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                  {t("consentFromBooking")}
                </p>
              )}
              {!editor.id && !editor.declarationId && (
                <div className="space-y-2 rounded-md border border-border/60 p-3 sm:col-span-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={editor.consentGiven}
                      onChange={(e) => setEditor({ ...editor, consentGiven: e.target.checked })}
                    />
                    {t("fields.consentGiven")}
                  </label>
                  <p className="text-xs text-muted-foreground">{t("consentHelp")}</p>
                  {editor.consentGiven && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Select value={editor.consentMethod} onValueChange={(v) => setEditor({ ...editor, consentMethod: v as ConsentMethod })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CONSENT_METHODS.map((m) => (
                            <SelectItem key={m} value={m}>{t(`consentMethods.${m}`)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input placeholder={t("fields.consentNote")} value={editor.consentNote} onChange={(e) => setEditor({ ...editor, consentNote: e.target.value })} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)} disabled={submitting}>{t("cancel")}</Button>
            <Button onClick={saveTerms} disabled={submitting}>{submitting ? t("saving") : t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Consent */}
      <Dialog open={Boolean(consentFor)} onOpenChange={(o) => !o && setConsentFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{consentFor?.action === "withdraw" ? t("withdrawConsent") : t("recordConsent")}</DialogTitle>
            <DialogDescription>
              {consentFor?.action === "withdraw" ? t("withdrawConsentHelp") : t("consentHelp")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {consentFor?.action === "give" && (
              <Select value={consentMethod} onValueChange={(v) => setConsentMethod(v as ConsentMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONSENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{t(`consentMethods.${m}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Textarea value={consentNote} onChange={(e) => setConsentNote(e.target.value)} placeholder={t("fields.consentNote")} rows={3} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConsentFor(null)} disabled={submitting}>{t("cancel")}</Button>
            <Button onClick={saveConsent} disabled={submitting}>{submitting ? t("saving") : t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refuse a declaration */}
      <Dialog open={Boolean(rejecting)} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("rejectTitle")}</DialogTitle>
            <DialogDescription>{t("rejectBody", { name: rejecting?.organizationName ?? "" })}</DialogDescription>
          </DialogHeader>
          <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder={t("rejectReasonPlaceholder")} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)} disabled={submitting}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={confirmReject} disabled={submitting}>{t("rejectDeclaration")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* End */}
      <Dialog open={Boolean(ending)} onOpenChange={(o) => !o && setEnding(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("endTitle")}</DialogTitle>
            <DialogDescription>{t("endBody", { name: ending?.organization.name ?? "" })}</DialogDescription>
          </DialogHeader>
          <Input value={endReason} onChange={(e) => setEndReason(e.target.value)} placeholder={t("endReasonPlaceholder")} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnding(null)} disabled={submitting}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={confirmEnd} disabled={submitting}>{t("end")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
