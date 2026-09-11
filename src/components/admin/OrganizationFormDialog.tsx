"use client";

import { useState } from "react";
import { Loader2, Paperclip } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Mirrors ORG_FORM_MAX_BYTES (the route refuses anything larger). */
const MAX_BYTES = 5 * 1024 * 1024;

export interface FormTarget {
  id: string;
  organizationName: string;
  formNotes: string;
}

/**
 * Attach (or replace) an organization's own claim form on an invoice: one
 * PDF the admin filled in, with an explicit confirmation that it holds
 * nothing clinical — the organization receives it.
 */
export function OrganizationFormDialog({
  target,
  onClose,
  onAttached,
}: {
  target: FormTarget | null;
  onClose: () => void;
  /** The invoice as the server returns it after the upload. */
  onAttached: (invoice: unknown) => void;
}) {
  const t = useTranslations("AdminDashboard.orgInvoices.form");
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setConfirmed(false);
    setBusy(false);
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const errorText = (code: unknown, fallback: unknown) =>
    typeof code === "string" && t.has(`errors.${code}`)
      ? t(`errors.${code}`)
      : typeof fallback === "string"
        ? fallback
        : t("errors.FAILED");

  const upload = async () => {
    if (!target || !file) return;
    // The same checks as the server, before sending 5 MB for nothing.
    if (file.type !== "application/pdf") return setError(t("errors.FORM_NOT_PDF"));
    if (file.size > MAX_BYTES) return setError(t("errors.FORM_TOO_LARGE"));
    if (!confirmed) return setError(t("errors.CONFIRMATION_REQUIRED"));
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.append("file", file);
    body.append("confirmNoClinical", "true");
    // No Content-Type header: the browser sets the multipart boundary.
    const res = await fetch(`/api/admin/organization-invoices/${target.id}/attachment`, {
      method: "POST",
      body,
    }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) {
      setError(errorText(json?.code, json?.error));
      return;
    }
    reset();
    onAttached(json.invoice);
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>{target ? t("dialogBody", { org: target.organizationName }) : ""}</DialogDescription>
        </DialogHeader>
        {target?.formNotes && (
          <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-sm">
            <p className="text-xs font-medium text-muted-foreground">{t("notesTitle")}</p>
            <p className="whitespace-pre-line">{target.formNotes}</p>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="org-form-file">{t("chooseFile")}</Label>
          <Input
            id="org-form-file"
            type="file"
            accept="application/pdf"
            onChange={(e) => {
              setError(null);
              setFile(e.target.files?.[0] ?? null);
            }}
          />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>{t("confirmNoClinical")}</span>
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {t("cancel")}
          </Button>
          <Button disabled={!file || !confirmed || busy} onClick={() => void upload()}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Paperclip className="mr-1 h-4 w-4" />}
            {t("upload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
