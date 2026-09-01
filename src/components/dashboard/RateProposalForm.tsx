"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { THERAPY_TYPES, type TherapyType } from "@/lib/professional-pricing";

/**
 * A professional's own rate-change request.
 *
 * Submitting changes nothing — the current rate stands until an admin accepts.
 * Rendered only in the professional's own profile view; an admin editing someone
 * else's profile gets the pricing editor instead.
 */

interface Proposal {
  id: string;
  therapyType: TherapyType;
  proposedRate: number;
  currentRate?: number;
  status: "pending" | "accepted" | "rejected";
  decisionNote?: string;
  createdAt: string;
}

const LABEL_KEY: Record<TherapyType, string> = {
  solo: "individualSession",
  couple: "coupleSession",
  group: "groupSession",
};

export default function RateProposalForm() {
  const t = useTranslations("Dashboard.rateProposal");

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [therapyType, setTherapyType] = useState<TherapyType>("solo");
  const [rate, setRate] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"success" | "error">("success");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/profile/rate-proposal");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setProposals(Array.isArray(data?.proposals) ? data.proposals : []);
    } catch {
      setMessageType("error");
      setMessage(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (rate.trim() === "") return;
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/profile/rate-proposal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          therapyType,
          proposedRate: Number(rate),
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessageType("error");
        const known = [
          "RATE_EXCEEDS_CLIENT_PRICE",
          "ALREADY_PENDING",
          "INVALID_RATE",
        ];
        setMessage(
          known.includes(data?.error) ? t(`errors.${data.error}`) : t("submitFailed"),
        );
        return;
      }

      setMessageType("success");
      setMessage(t("submitted"));
      setRate("");
      setNote("");
      await load();
    } catch {
      setMessageType("error");
      setMessage(t("submitFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const pending = proposals.filter((p) => p.status === "pending");
  const decided = proposals.filter((p) => p.status !== "pending").slice(0, 5);

  return (
    <div className="rounded-xl bg-card p-6">
      <h2 className="text-xl font-serif font-light text-foreground mb-1">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground mb-6">{t("description")}</p>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="mb-6 space-y-2">
              <Label className="text-sm">{t("pendingTitle")}</Label>
              {pending.map((p) => (
                <p key={p.id} className="text-sm text-muted-foreground">
                  {t("pendingRow", {
                    type: t(`types.${LABEL_KEY[p.therapyType]}`),
                    rate: p.proposedRate,
                  })}
                </p>
              ))}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="rp-type" className="text-xs mb-1 block">
                {t("therapyType")}
              </Label>
              <select
                id="rp-type"
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={therapyType}
                onChange={(e) => setTherapyType(e.target.value as TherapyType)}
              >
                {THERAPY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`types.${LABEL_KEY[type]}`)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="rp-rate" className="text-xs mb-1 block">
                {t("proposedRate")}
              </Label>
              <Input
                id="rp-rate"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="rp-note" className="text-xs mb-1 block">
                {t("note")}
              </Label>
              <Input
                id="rp-note"
                value={note}
                maxLength={1000}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("notePlaceholder")}
              />
            </div>
          </div>

          {message && (
            <p
              role="status"
              className={`mt-3 text-sm ${
                messageType === "error" ? "text-destructive" : "text-emerald-600"
              }`}
            >
              {message}
            </p>
          )}

          <Button
            className="mt-4"
            onClick={submit}
            disabled={submitting || rate.trim() === ""}
          >
            {submitting ? t("submitting") : t("submit")}
          </Button>

          {decided.length > 0 && (
            <div className="mt-6 border-t border-border pt-4 space-y-2">
              <Label className="text-sm">{t("historyTitle")}</Label>
              {decided.map((p) => (
                <p key={p.id} className="text-sm text-muted-foreground">
                  {t(`status.${p.status}`)} —{" "}
                  {t(`types.${LABEL_KEY[p.therapyType]}`)} · {p.proposedRate} $
                  {p.decisionNote ? ` — ${p.decisionNote}` : ""}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
