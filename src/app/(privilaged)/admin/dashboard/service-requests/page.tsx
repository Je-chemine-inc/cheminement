"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, RefreshCw, Trash2, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "next-intl";

interface ProfessionalOption {
  id: string;
  name: string;
  email: string;
}

interface ServiceRequestRow {
  id: string;
  createdAt: string;
  issueType?: string;
  notes?: string;
  type: string;
  therapyType: string;
  bookingFor: string;
  routingStatus: string;
  isReturningClient?: boolean;
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
  const [deleteTarget, setDeleteTarget] = useState<ServiceRequestRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [professionals, setProfessionals] = useState<ProfessionalOption[]>([]);
  const [assignDraft, setAssignDraft] = useState<Record<string, string>>({});
  const [assigningId, setAssigningId] = useState<string | null>(null);

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

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      setError(null);
      const res = await fetch(`/api/admin/service-requests/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Failed to delete");
      }
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setDeleting(false);
    }
  };

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

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/professionals?status=active&limit=200");
        if (!res.ok) return;
        const json = await res.json();
        setProfessionals(json.professionals ?? []);
      } catch (err) {
        console.error("Failed to load professionals list:", err);
      }
    })();
  }, []);

  const assignProfessional = async (requestId: string) => {
    const professionalId = assignDraft[requestId];
    if (!professionalId) return;
    try {
      setAssigningId(requestId);
      setError(null);
      const res = await fetch(
        `/api/admin/service-requests/${requestId}/assign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ professionalId }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Failed to assign");
      }
      setAssignDraft((prev) => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setAssigningId(null);
    }
  };

  return (
    <div className="space-y-8">
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
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{r.clientName}</span>
                      {r.isReturningClient ? (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300"
                          title={t("returningClientHint")}
                        >
                          {t("returningClient")}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm">
                    {r.clientEmail}
                  </TableCell>
                  <TableCell
                    className="max-w-[220px] truncate text-sm"
                    title={r.issueType || undefined}
                  >
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
                  <TableCell className="text-sm align-top">
                    <div className="flex flex-col gap-2 min-w-[260px]">
                      <div className="flex flex-wrap gap-2">
                        {r.bookingFor === "loved-one" && (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => approve(r.id, "requester")}
                              disabled={loading || approvingId === r.id}
                              className="whitespace-nowrap"
                            >
                              {t("sendToRequester")}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => approve(r.id, "loved-one")}
                              disabled={loading || approvingId === r.id}
                              className="whitespace-nowrap"
                            >
                              {t("sendToLovedOne")}
                            </Button>
                          </>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => setDeleteTarget(r)}
                          disabled={loading || approvingId === r.id}
                          className="whitespace-nowrap"
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          {t("delete")}
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/30">
                        <Select
                          value={assignDraft[r.id] || undefined}
                          onValueChange={(v) =>
                            setAssignDraft((prev) => ({ ...prev, [r.id]: v }))
                          }
                        >
                          <SelectTrigger className="h-8 w-52 text-xs">
                            <SelectValue placeholder={t("assignPlaceholder")} />
                          </SelectTrigger>
                          <SelectContent>
                            {professionals.length === 0 ? (
                              <div className="px-3 py-2 text-xs text-muted-foreground">
                                {t("assignNoProfessionals")}
                              </div>
                            ) : (
                              professionals.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => assignProfessional(r.id)}
                          disabled={
                            !assignDraft[r.id] ||
                            assigningId === r.id ||
                            loading
                          }
                          className="h-8 text-xs gap-1 whitespace-nowrap"
                        >
                          {assigningId === r.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <UserCheck className="h-3 w-3" />
                          )}
                          {t("assignAction")}
                        </Button>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteConfirmDesc", {
                client: deleteTarget?.clientName ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("confirm")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
