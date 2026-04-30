"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, CheckCircle2, Mail, User } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface PendingRequest {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  requestedAt?: string;
  interacReference?: string | null;
}

export default function AdminPaymentTrustPage() {
  const t = useTranslations("AdminDashboard.paymentTrust");
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approvedIds, setApprovedIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/payment-guarantee-requests");
      if (!res.ok) {
        throw new Error(t("errorLoad"));
      }
      const data = await res.json();
      setRequests(data.requests ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (userId: string) => {
    try {
      setApprovingId(userId);
      const res = await fetch(
        `/api/admin/payment-guarantee-requests/${userId}/approve`,
        { method: "POST" },
      );
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error || t("errorApprove"));
      }
      setApprovedIds((prev) => [...prev, userId]);
      setTimeout(async () => {
        setApprovedIds((prev) => prev.filter((id) => id !== userId));
        await load();
      }, 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setApprovingId(null);
    }
  };

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h1 className="text-3xl font-serif font-light text-foreground">
          {t("titleInterac")}
        </h1>
        <p className="text-muted-foreground font-light mt-2">
          {t("descInterac")}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-border/40 bg-card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : requests.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground font-light">
            {t("empty")}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-light">{t("client")}</TableHead>
                <TableHead className="font-light">{t("contact")}</TableHead>
                <TableHead className="font-light">{t("colReference")}</TableHead>
                <TableHead className="font-light text-right">{t("action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link
                      href={`/admin/dashboard/patients/${r.id}`}
                      className="flex items-center gap-2 hover:underline decoration-primary/30 underline-offset-4"
                    >
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-foreground">
                        {r.firstName} {r.lastName}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      {r.email}
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground">
                      {r.interacReference || "—"}
                    </code>
                  </TableCell>
                  <TableCell className="text-right">
                    {approvedIds.includes(r.id) ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                        <CheckCircle2 className="h-4 w-4" />
                        {t("validationLabel")}
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        disabled={approvingId === r.id}
                        onClick={() => approve(r.id)}
                        className="gap-1.5"
                      >
                        {approvingId === r.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                        {t("approveBtn")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
