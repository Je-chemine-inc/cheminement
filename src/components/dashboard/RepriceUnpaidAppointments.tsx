"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

/**
 * After an admin changes a professional's pricing, offer to apply it to that
 * professional's **unpaid upcoming** appointments.
 *
 * Deliberately explicit: nothing is pre-selected and a pricing change never
 * cascades on its own. Paid, refunded and receipted appointments are excluded
 * server-side and skipped again at apply time, in case one settles between
 * loading this list and pressing the button.
 */

interface Money {
  price?: number;
  platformFee?: number;
  professionalPayout?: number;
}

interface Row {
  id: string;
  date: string | null;
  therapyType: string;
  current: Money;
  proposed: Required<Money>;
  changed: boolean;
}

export default function RepriceUnpaidAppointments({
  userId,
  reloadKey,
}: {
  userId: string;
  /** Bump to re-fetch — the parent changes this after a successful save. */
  reloadKey: number;
}) {
  const t = useTranslations("Dashboard.adminPricing.reprice");

  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"success" | "error">("success");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/admin/appointments/reprice-bulk?professionalId=${userId}`,
      );
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setRows(Array.isArray(data?.appointments) ? data.appointments : []);
      // Never pre-select: applying must be a deliberate act.
      setSelected(new Set());
    } catch {
      setMessageType("error");
      setMessage(t("loadFailed"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [userId, t]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = async () => {
    if (selected.size === 0) return;
    setApplying(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/appointments/reprice-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentIds: [...selected] }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessageType("error");
        setMessage(t("applyFailed"));
        return;
      }

      setMessageType("success");
      const skipped = Array.isArray(data?.skipped) ? data.skipped.length : 0;
      setMessage(
        skipped > 0
          ? t("appliedWithSkips", { count: data.repricedCount, skipped })
          : t("applied", { count: data.repricedCount }),
      );
      await load();
    } catch {
      setMessageType("error");
      setMessage(t("applyFailed"));
    } finally {
      setApplying(false);
    }
  };

  const changed = rows.filter((r) => r.changed);

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  }

  if (changed.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {rows.length === 0 ? t("noneUnpaid") : t("allUpToDate")}
      </p>
    );
  }

  return (
    <div className="mt-6 border-t border-border pt-6">
      <h3 className="text-base font-medium text-foreground mb-1">{t("title")}</h3>
      <p className="text-sm text-muted-foreground mb-4">{t("description")}</p>

      <ul className="space-y-2">
        {changed.map((row) => (
          <li
            key={row.id}
            className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg"
          >
            <Checkbox
              id={`reprice-${row.id}`}
              checked={selected.has(row.id)}
              onCheckedChange={() => toggle(row.id)}
              className="mt-1"
            />
            <Label
              htmlFor={`reprice-${row.id}`}
              className="flex-1 cursor-pointer font-normal"
            >
              <span className="block text-sm text-foreground">
                {row.date ? new Date(row.date).toLocaleDateString() : "—"} ·{" "}
                {row.therapyType}
              </span>
              <span className="block text-sm text-muted-foreground">
                {t("change", {
                  from: row.current.price ?? 0,
                  to: row.proposed.price,
                  payout: row.proposed.professionalPayout,
                  fee: row.proposed.platformFee,
                })}
              </span>
            </Label>
          </li>
        ))}
      </ul>

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
        onClick={apply}
        disabled={applying || selected.size === 0}
      >
        {applying ? t("applying") : t("apply", { count: selected.size })}
      </Button>
    </div>
  );
}
