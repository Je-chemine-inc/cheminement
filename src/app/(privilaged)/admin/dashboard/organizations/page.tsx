"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
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
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  OrganizationEditorDialog,
  emptyOrganizationDraft,
  organizationToDraft,
  type OrganizationDraft,
  type OrganizationRecord as Organization,
} from "@/components/admin/OrganizationEditorDialog";

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
  // Bank debit (DPA) on the pay link: its own switch, for a pilot.
  const [padEnabled, setPadEnabled] = useState<boolean | null>(null);
  const [padConfirm, setPadConfirm] = useState<boolean | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<OrganizationDraft>(emptyOrganizationDraft());
  // Remounts the form so each opening starts from `draft`.
  const [editorKey, setEditorKey] = useState(0);
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
      if (flagRes.ok) {
        const flags = (await flagRes.json()) as { enabled: boolean; padEnabled?: boolean };
        setEnabled(flags.enabled);
        setPadEnabled(flags.padEnabled === true);
      }
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
    setDraft(emptyOrganizationDraft());
    setEditorKey((k) => k + 1);
    setEditorOpen(true);
  };
  const openEdit = (o: Organization) => {
    setDraft(organizationToDraft(o));
    setEditorKey((k) => k + 1);
    setEditorOpen(true);
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

  const applyPadSwitch = async (next: boolean) => {
    setSubmitting(true);
    setMutationError(null);
    try {
      const res = await fetch("/api/admin/organization-billing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ padEnabled: next }),
      });
      if (!res.ok) throw new Error(await readError(res));
      setPadEnabled(next);
      setPadConfirm(null);
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

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

      {padEnabled !== null && (
        <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">{padEnabled ? t("padOn") : t("padOff")}</p>
            <p className="text-xs text-muted-foreground max-w-2xl">{t("padHelp")}</p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setMutationError(null);
              setPadConfirm(!padEnabled);
            }}
          >
            {padEnabled ? t("padTurnOff") : t("padTurnOn")}
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
      <OrganizationEditorDialog
        key={editorKey}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        initial={draft}
        onSaved={fetchItems}
      />

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

      {/* Bank debit (DPA) */}
      <Dialog open={padConfirm !== null} onOpenChange={(o) => !o && setPadConfirm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{padConfirm ? t("padConfirmOnTitle") : t("padConfirmOffTitle")}</DialogTitle>
            <DialogDescription>{padConfirm ? t("padConfirmOnBody") : t("padConfirmOffBody")}</DialogDescription>
          </DialogHeader>
          {mutationError && <p className="text-sm text-destructive">{mutationError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPadConfirm(null)} disabled={submitting}>
              {t("cancel")}
            </Button>
            <Button
              variant={padConfirm ? "default" : "destructive"}
              onClick={() => padConfirm !== null && applyPadSwitch(padConfirm)}
              disabled={submitting}
            >
              {padConfirm ? t("padTurnOn") : t("padTurnOff")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
