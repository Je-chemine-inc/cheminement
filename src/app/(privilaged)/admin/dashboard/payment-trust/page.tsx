"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2, CheckCircle2, Mail, User, Receipt, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

interface PendingReceipt {
  id: string;
  appointmentId: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  professionalName: string | null;
  appointmentDate: string | null;
  appointmentTime: string | null;
  interacReference: string | null;
  invoiceNumber: string | null;
  payerName: string | null;
  amountCad: number;
  issuedAt: string | null;
}

function formatDate(iso: string | null, locale: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(locale === "fr" ? "fr-CA" : "en-CA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function AdminPaymentTrustPage() {
  const t = useTranslations("AdminDashboard.paymentTrust");
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approvedIds, setApprovedIds] = useState<string[]>([]);

  const [receipts, setReceipts] = useState<PendingReceipt[]>([]);
  const [loadingReceipts, setLoadingReceipts] = useState(true);
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);
  const [paidIds, setPaidIds] = useState<string[]>([]);

  // Reconciliation filters (search the payer name, the professional, the date).
  const [search, setSearch] = useState("");
  const [proFilter, setProFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");

  // "Associer & marquer payé" dialog — captures the real Interac payer name + note.
  const [reconcile, setReconcile] = useState<PendingReceipt | null>(null);
  const [payerNameInput, setPayerNameInput] = useState("");
  const [noteInput, setNoteInput] = useState("");

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
  }, [t]);

  const loadReceipts = useCallback(async () => {
    try {
      setLoadingReceipts(true);
      const res = await fetch("/api/admin/client-receipts/pending");
      if (!res.ok) {
        throw new Error(t("errorLoadReceipts"));
      }
      const data = await res.json();
      setReceipts(data.receipts ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoadingReceipts(false);
    }
  }, [t]);

  useEffect(() => {
    load();
    loadReceipts();
  }, [load, loadReceipts]);

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

  const openReconcile = (r: PendingReceipt) => {
    setReconcile(r);
    // Pre-fill with the recorded payer or the client name; the admin overrides
    // it when an "orphan" transfer arrives under a different name.
    setPayerNameInput(r.payerName || r.clientName);
    setNoteInput("");
  };

  const submitReconcile = async () => {
    if (!reconcile) return;
    const receiptId = reconcile.id;
    try {
      setMarkingPaidId(receiptId);
      const res = await fetch(
        `/api/admin/client-receipts/${receiptId}/mark-paid`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payerName: payerNameInput.trim() || undefined,
            note: noteInput.trim() || undefined,
          }),
        },
      );
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error || t("errorMarkPaid"));
      }
      setReconcile(null);
      setPaidIds((prev) => [...prev, receiptId]);
      setTimeout(async () => {
        setPaidIds((prev) => prev.filter((id) => id !== receiptId));
        await loadReceipts();
      }, 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setMarkingPaidId(null);
    }
  };

  // Distinct professionals present in the pending list — drives the filter.
  const proOptions = useMemo(
    () =>
      Array.from(
        new Set(
          receipts
            .map((r) => r.professionalName)
            .filter((n): n is string => Boolean(n)),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [receipts],
  );

  const filteredReceipts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return receipts.filter((r) => {
      const matchesSearch =
        !q ||
        r.clientName.toLowerCase().includes(q) ||
        r.clientEmail.toLowerCase().includes(q) ||
        (r.invoiceNumber ?? "").toLowerCase().includes(q) ||
        (r.interacReference ?? "").toLowerCase().includes(q) ||
        (r.payerName ?? "").toLowerCase().includes(q);
      const matchesPro =
        proFilter === "all" || r.professionalName === proFilter;
      const matchesDate =
        !dateFilter ||
        (r.appointmentDate
          ? r.appointmentDate.slice(0, 10) === dateFilter
          : false);
      return matchesSearch && matchesPro && matchesDate;
    });
  }, [receipts, search, proFilter, dateFilter]);

  return (
    <div className="space-y-12 max-w-5xl">
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

      <div>
        <h2 className="text-2xl font-serif font-light text-foreground flex items-center gap-2">
          <Receipt className="h-6 w-6" />
          {t("receiptsTitle")}
        </h2>
        <p className="text-muted-foreground font-light mt-2">
          {t("receiptsDesc")}
        </p>
      </div>

      {/* Reconciliation filters: search by payer/invoice, professional, date. */}
      {!loadingReceipts && receipts.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              {t("searchLabel")}
            </Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="pl-9"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              {t("filterProfessional")}
            </Label>
            <Select value={proFilter} onValueChange={setProFilter}>
              <SelectTrigger className="sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allProfessionals")}</SelectItem>
                {proOptions.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              {t("filterDate")}
            </Label>
            <Input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="sm:w-44"
            />
          </div>
          {(search || proFilter !== "all" || dateFilter) && (
            <Button
              variant="ghost"
              onClick={() => {
                setSearch("");
                setProFilter("all");
                setDateFilter("");
              }}
            >
              {t("clearFilters")}
            </Button>
          )}
        </div>
      )}

      <div className="rounded-xl border border-border/40 bg-card overflow-hidden">
        {loadingReceipts ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : receipts.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground font-light">
            {t("receiptsEmpty")}
          </div>
        ) : filteredReceipts.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground font-light">
            {t("noMatch")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-light">{t("client")}</TableHead>
                  <TableHead className="font-light">{t("colSession")}</TableHead>
                  <TableHead className="font-light">{t("colInvoice")}</TableHead>
                  <TableHead className="font-light">{t("colAmount")}</TableHead>
                  <TableHead className="font-light text-right">
                    {t("action")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReceipts.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        href={`/admin/dashboard/patients/${r.clientId}`}
                        className="flex items-center gap-2 hover:underline decoration-primary/30 underline-offset-4"
                      >
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-foreground">
                          {r.clientName}
                        </span>
                      </Link>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {r.clientEmail}
                      </div>
                      {r.payerName && r.payerName !== r.clientName && (
                        <div className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                          {t("payerLabel")}: {r.payerName}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="text-foreground">
                        {formatDate(r.appointmentDate, "fr")}
                        {r.appointmentTime ? ` · ${r.appointmentTime}` : ""}
                      </div>
                      {r.professionalName && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {r.professionalName}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground">
                        {r.invoiceNumber || r.interacReference || "—"}
                      </code>
                    </TableCell>
                    <TableCell className="text-sm font-medium text-foreground">
                      ${r.amountCad.toFixed(2)} CAD
                    </TableCell>
                    <TableCell className="text-right">
                      {paidIds.includes(r.id) ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                          <CheckCircle2 className="h-4 w-4" />
                          {t("paidBadge")}
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          disabled={markingPaidId === r.id}
                          onClick={() => openReconcile(r)}
                          className="gap-1.5"
                        >
                          {markingPaidId === r.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                          {t("reconcileBtn")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Associate an Interac transfer → record the payer name + mark paid. */}
      <Dialog
        open={reconcile !== null}
        onOpenChange={(o) => {
          if (!o) setReconcile(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("reconcileTitle")}</DialogTitle>
            <DialogDescription>
              {reconcile
                ? t("reconcileDesc", {
                    client: reconcile.clientName,
                    amount: reconcile.amountCad.toFixed(2),
                    invoice: reconcile.invoiceNumber || "—",
                  })
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("payerNameLabel")}</Label>
              <Input
                value={payerNameInput}
                onChange={(e) => setPayerNameInput(e.target.value)}
                placeholder={t("payerNamePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("noteLabel")}</Label>
              <Textarea
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                placeholder={t("notePlaceholder")}
                maxLength={300}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setReconcile(null)}
              disabled={markingPaidId !== null}
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={submitReconcile}
              disabled={markingPaidId !== null}
              className="gap-2"
            >
              {markingPaidId !== null ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {t("reconcileConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
