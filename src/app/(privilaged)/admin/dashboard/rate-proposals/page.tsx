"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Admin review queue for professional rate-change requests.
 *
 * Accepting changes what a professional is paid on **future** bookings only —
 * existing appointments keep the price agreed at booking until re-priced
 * deliberately from the professional's pricing editor.
 */

interface Spread {
  amount: number;
  percentage: number;
}

interface ProposalRow {
  id: string;
  professional: { id: string; name: string; email: string | null };
  therapyType: "solo" | "couple" | "group";
  currentRate: number | null;
  proposedRate: number;
  clientPrice: number | null;
  proposedSpread: Spread | null;
  zeroOrNegativeSpread: boolean;
  note: string | null;
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
  decisionNote: string | null;
}

const LABEL_KEY = {
  solo: "individualSession",
  couple: "coupleSession",
  group: "groupSession",
} as const;

export default function RateProposalsPage() {
  const t = useTranslations("Dashboard.adminRateProposals");

  const [rows, setRows] = useState<ProposalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"success" | "error">("success");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/rate-proposals?status=pending");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setRows(Array.isArray(data?.proposals) ? data.proposals : []);
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

  const decide = async (id: string, decision: "accept" | "reject") => {
    setBusyId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/rate-proposals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, decisionNote: notes[id]?.trim() || undefined }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessageType("error");
        const known = ["RATE_EXCEEDS_CLIENT_PRICE", "NOT_PENDING"];
        setMessage(
          known.includes(data?.error) ? t(`errors.${data.error}`) : t("decisionFailed"),
        );
        return;
      }

      setMessageType("success");
      setMessage(decision === "accept" ? t("accepted") : t("rejected"));
      await load();
    } catch {
      setMessageType("error");
      setMessage(t("decisionFailed"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-serif font-light text-foreground">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t("description")}</p>
      </div>

      {message && (
        <p
          role="status"
          className={`text-sm ${
            messageType === "error" ? "text-destructive" : "text-emerald-600"
          }`}
        >
          {message}
        </p>
      )}

      {loading ? (
        <p className="text-muted-foreground">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-4">
          {rows.map((row) => (
            <li key={row.id} className="rounded-xl bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-foreground">
                    {row.professional.name || row.professional.email || "—"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t(`types.${LABEL_KEY[row.therapyType]}`)} ·{" "}
                    {new Date(row.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <p className="text-sm text-foreground">
                  {t("rateChange", {
                    from: row.currentRate ?? 0,
                    to: row.proposedRate,
                  })}
                </p>
              </div>

              <p
                className={`mt-3 text-sm ${
                  row.zeroOrNegativeSpread
                    ? "text-amber-600 dark:text-amber-500"
                    : "text-muted-foreground"
                }`}
              >
                {row.proposedSpread === null
                  ? t("spreadUnknown")
                  : row.zeroOrNegativeSpread
                    ? t("spreadZeroWarning", {
                        clientPrice: row.clientPrice ?? 0,
                      })
                    : t("spreadAfter", {
                        clientPrice: row.clientPrice ?? 0,
                        amount: row.proposedSpread.amount,
                        percentage: row.proposedSpread.percentage,
                      })}
              </p>

              {row.note && (
                <p className="mt-2 text-sm text-muted-foreground italic">
                  “{row.note}”
                </p>
              )}

              <div className="mt-4">
                <Label htmlFor={`note-${row.id}`} className="text-xs mb-1 block">
                  {t("decisionNote")}
                </Label>
                <Input
                  id={`note-${row.id}`}
                  value={notes[row.id] ?? ""}
                  maxLength={1000}
                  onChange={(e) =>
                    setNotes((prev) => ({ ...prev, [row.id]: e.target.value }))
                  }
                  placeholder={t("decisionNotePlaceholder")}
                />
              </div>

              <div className="mt-4 flex gap-3">
                <Button
                  onClick={() => decide(row.id, "accept")}
                  disabled={busyId === row.id}
                >
                  {t("accept")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => decide(row.id, "reject")}
                  disabled={busyId === row.id}
                >
                  {t("reject")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
