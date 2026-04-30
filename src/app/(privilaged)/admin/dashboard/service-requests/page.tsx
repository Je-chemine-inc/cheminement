"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslations } from "next-intl";

interface ServiceRequestRow {
  id: string;
  createdAt: string;
  issueType?: string;
  notes?: string;
  type: string;
  therapyType: string;
  bookingFor: string;
  routingStatus: string;
  preferredAvailability?: string[];
  clientName: string;
  clientEmail: string;
}

export default function AdminServiceRequestsPage() {
  const t = useTranslations("AdminServiceRequests");
  const [requests, setRequests] = useState<ServiceRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const modalityLabel = (type: string) => {
    switch (type) {
      case "video":
        return t("typeVideo");
      case "in-person":
        return t("typeInPerson");
      case "phone":
        return t("typePhone");
      case "both":
        return t("typeBoth");
      default:
        return type;
    }
  };

  const bookingForLabel = (bf: string) => {
    switch (bf) {
      case "self":
        return t("self");
      case "patient":
        return t("patient");
      case "loved-one":
        return t("lovedOne");
      default:
        return bf;
    }
  };

  const routingStatusLabel = (status: string) => {
    switch (status) {
      case "pending":
        return { label: t("routingPending"), color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" };
      case "proposed":
        return { label: t("routingProposed"), color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" };
      case "accepted":
        return { label: t("routingAccepted"), color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" };
      case "general":
        return { label: t("routingGeneral"), color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300" };
      case "refused":
        return { label: t("routingRefused"), color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" };
      default:
        return { label: status, color: "bg-muted text-muted-foreground" };
    }
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/service-requests");
      if (!res.ok) {
        throw new Error("Failed to load");
      }
      const data = await res.json();
      setRequests(data.requests ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  const approve = async (id: string, target: "requester" | "loved-one") => {
    try {
      setApprovingId(id);
      setError(null);
      const res = await fetch(`/api/admin/service-requests/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Failed to approve");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setApprovingId(null);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-8 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-light text-foreground">
            {t("title")}
          </h1>
          <p className="text-muted-foreground font-light mt-2">{t("subtitle")}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => load()}
          disabled={loading}
          className="shrink-0"
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
          />
          {t("refresh")}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {loading && requests.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : requests.length === 0 ? (
        <p className="text-muted-foreground py-8">{t("empty")}</p>
      ) : (
        <div className="rounded-xl border border-border/40 bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("created")}</TableHead>
                <TableHead>{t("client")}</TableHead>
                <TableHead>{t("email")}</TableHead>
                <TableHead>{t("motif")}</TableHead>
                <TableHead>{t("modality")}</TableHead>
                <TableHead>{t("bookingFor")}</TableHead>
                <TableHead>{t("routing")}</TableHead>
                <TableHead>{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {new Date(r.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>{r.clientName}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm">
                    {r.clientEmail}
                  </TableCell>
                  <TableCell className="max-w-[220px] text-sm">
                    {r.issueType || "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {modalityLabel(r.type)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {bookingForLabel(r.bookingFor)}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const { label, color } = routingStatusLabel(r.routingStatus);
                      return (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
                          {label}
                        </span>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => approve(r.id, "requester")}
                        disabled={loading || approvingId === r.id}
                      >
                        {t("sendToRequester")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => approve(r.id, "loved-one")}
                        disabled={loading || approvingId === r.id}
                      >
                        {t("sendToLovedOne")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
