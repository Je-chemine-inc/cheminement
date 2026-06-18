"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Wallet,
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PayoutMethod = "interac" | "direct_deposit" | "";

/**
 * Professional payout method (manual internal disbursement — no Stripe fees).
 * The pro chooses Interac (deposit email) or Direct deposit (uploads a void
 * cheque specimen). Persisted on the Profile; an admin reads it to disburse.
 */
export function PayoutMethodSection() {
  const t = useTranslations("Professional.billing");

  const [method, setMethod] = useState<PayoutMethod>("");
  const [interacEmail, setInteracEmail] = useState("");
  const [chequeUrl, setChequeUrl] = useState("");
  const [chequeName, setChequeName] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/profile");
        if (res.ok) {
          const p = await res.json();
          if (p?.payoutMethod) setMethod(p.payoutMethod);
          if (p?.payoutInteracEmail) setInteracEmail(p.payoutInteracEmail);
          if (p?.payoutChequeUrl) setChequeUrl(p.payoutChequeUrl);
          if (p?.payoutChequeName) setChequeName(p.payoutChequeName);
        }
      } catch {
        /* non-blocking */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setSaved(false);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload/payout-cheque", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        fileName?: string;
        error?: string;
      };
      if (!res.ok || !data.url) throw new Error(data.error || t("payoutUploadError"));
      setChequeUrl(data.url);
      setChequeName(data.fileName || file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("payoutUploadError"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSave = async () => {
    setError(null);
    setSaved(false);
    if (method === "interac" && !interacEmail.trim()) {
      setError(t("payoutInteracEmailRequired"));
      return;
    }
    if (method === "direct_deposit" && !chequeUrl) {
      setError(t("payoutChequeRequired"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payoutMethod: method || undefined,
          payoutInteracEmail:
            method === "interac" ? interacEmail.trim() : undefined,
          payoutChequeUrl: method === "direct_deposit" ? chequeUrl : undefined,
          payoutChequeName:
            method === "direct_deposit" ? chequeName : undefined,
        }),
      });
      if (!res.ok) throw new Error();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError(t("payoutError"));
    } finally {
      setSaving(false);
    }
  };

  const optionClass = (selected: boolean) =>
    `flex-1 rounded-2xl border px-4 py-3 text-left transition ${
      selected
        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
        : "border-border/40 hover:bg-muted/40"
    }`;

  return (
    <section className="rounded-3xl border border-border/20 bg-card/80 p-7 shadow-lg">
      <div className="flex items-center gap-3">
        <Wallet className="h-6 w-6 text-primary" />
        <div>
          <h2 className="font-serif text-2xl font-light text-foreground">
            {t("payoutTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("payoutDesc")}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => setMethod("interac")}
              className={optionClass(method === "interac")}
            >
              <p className="font-medium text-foreground">{t("payoutInterac")}</p>
              <p className="text-xs text-muted-foreground">
                {t("payoutInteracHint")}
              </p>
            </button>
            <button
              type="button"
              onClick={() => setMethod("direct_deposit")}
              className={optionClass(method === "direct_deposit")}
            >
              <p className="font-medium text-foreground">
                {t("payoutDirectDeposit")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("payoutDirectDepositHint")}
              </p>
            </button>
          </div>

          {method === "interac" && (
            <div className="space-y-2">
              <Label>{t("payoutInteracEmailLabel")}</Label>
              <Input
                type="email"
                value={interacEmail}
                onChange={(e) => setInteracEmail(e.target.value)}
                placeholder={t("payoutInteracEmailPlaceholder")}
              />
            </div>
          )}

          {method === "direct_deposit" && (
            <div className="space-y-3">
              <Label>{t("payoutChequeLabel")}</Label>
              {chequeUrl && (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/30 p-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-5 w-5 shrink-0 text-primary" />
                    <span className="truncate text-sm">
                      {chequeName || t("payoutChequeLabel")}
                    </span>
                  </div>
                  <a
                    href={chequeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <ExternalLink className="h-4 w-4" />
                    {t("payoutChequeView")}
                  </a>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                className="hidden"
                onChange={handleUpload}
                disabled={uploading}
              />
              <Button
                type="button"
                variant="outline"
                className="gap-2 rounded-full"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {uploading
                  ? t("payoutChequeUploading")
                  : chequeUrl
                    ? t("payoutChequeReplace")
                    : t("payoutChequeUpload")}
              </Button>
              <p className="text-sm text-muted-foreground">
                {t("payoutConfidentialNote")}
              </p>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          {method && (
            <div className="flex items-center gap-3">
              <Button
                onClick={handleSave}
                disabled={saving || uploading}
                className="gap-2 rounded-full"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {saving ? t("payoutSaving") : t("payoutSave")}
              </Button>
              {saved && (
                <span className="flex items-center gap-1 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  {t("payoutSaved")}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
