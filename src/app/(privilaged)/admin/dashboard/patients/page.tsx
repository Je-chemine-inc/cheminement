"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Search,
  Filter,
  Eye,
  AlertCircle,
  RefreshCw,
  Download,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Link from "next/link";
import { AddProfileModal } from "@/components/admin/AddProfileModal";
import { ClientStatusTierBadge } from "@/components/dashboard/ClientStatusTierBadge";
import { clientStatusTierColors } from "@/config/colors";
import type { ClientStatusTier } from "@/lib/client-status-tier";

const STATUS_TIERS: ClientStatusTier[] = ["gray", "yellow", "green", "red"];

type PatientStatus = "active" | "pending" | "inactive";

interface Patient {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: PatientStatus;
  role: "client" | "guest";
  matchedWith?: string;
  joinedDate: string;
  totalSessions: number;
  issueType: string;
  paymentGuaranteeStatus?: "none" | "pending_admin" | "green";
  paymentGuaranteeSource?: "stripe" | "interac_trust";
  statusTier?: ClientStatusTier;
}

interface PatientsData {
  patients: Patient[];
  summary: {
    totalPatients: number;
    activePatients: number;
    pendingPatients: number;
    totalSessions: number;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export default function PatientsPage() {
  const t = useTranslations("AdminDashboard.patients");
  const [data, setData] = useState<PatientsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);

  const fetchPatients = useCallback(
    async (page = 1) => {
      try {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams({
          page: page.toString(),
          limit: "20",
          search: searchQuery,
          status: statusFilter,
        });
        const response = await fetch(`/api/admin/patients?${params}`);
        if (!response.ok) {
          throw new Error("Failed to fetch patients");
        }
        const result = await response.json();
        setData(result);
        setCurrentPage(page);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    },
    [searchQuery, statusFilter],
  );

  useEffect(() => {
    fetchPatients(1);
  }, [fetchPatients]);

  const allPatients = data?.patients || [];
  const patients =
    tierFilter === "all"
      ? allPatients
      : allPatients.filter((p) => (p.statusTier ?? "gray") === tierFilter);
  const summary = data?.summary || {
    totalPatients: 0,
    activePatients: 0,
    pendingPatients: 0,
    totalSessions: 0,
  };

  const exportPatientsData = () => {
    if (!data) return;

    const { patients, summary } = data;

    // Create CSV content
    let csvContent = "Patients Data Export\n";
    csvContent += `Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}\n\n`;

    // Summary section
    csvContent += "Summary\n";
    csvContent += "Metric,Value\n";
    csvContent += `Total Patients,${summary.totalPatients}\n`;
    csvContent += `Active Patients,${summary.activePatients}\n`;
    csvContent += `Pending Patients,${summary.pendingPatients}\n`;
    csvContent += `Total Sessions,${summary.totalSessions}\n\n`;

    // Patients data
    csvContent += "Patient Details\n";
    csvContent +=
      "ID,Name,Email,Phone,Issue Type,Status,Guarantee,Matched With,Sessions,Joined Date\n";

    patients.forEach((patient) => {
      csvContent += `${patient.id},"${patient.name}","${patient.email}","${patient.phone}","${patient.issueType}","${patient.status}","${patient.paymentGuaranteeStatus}","${patient.matchedWith || ""}",${patient.totalSessions},"${new Date(patient.joinedDate).toLocaleDateString()}"\n`;
    });

    // Create and download the file
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `patients-data-${new Date().toISOString().split("T")[0]}.csv`,
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-serif font-light text-foreground">
              {t("title")}
            </h1>
            <p className="text-muted-foreground font-light mt-2">
              {t("subtitle")}
            </p>
          </div>
        </div>

        {/* Loading skeleton */}
        <div className="grid gap-6 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl bg-card p-6 border border-border/40"
            >
              <div className="animate-pulse">
                <div className="h-4 bg-muted rounded w-24 mb-2"></div>
                <div className="h-8 bg-muted rounded w-16"></div>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl bg-card border border-border/40">
          <div className="p-6 border-b border-border/40">
            <div className="animate-pulse">
              <div className="h-10 bg-muted rounded w-full max-w-md"></div>
            </div>
          </div>
          <div className="animate-pulse">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 bg-muted rounded m-6"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-serif font-light text-foreground">
              {t("title")}
            </h1>
            <p className="text-muted-foreground font-light mt-2">
              {t("subtitle")}
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-card p-6 border border-border/40">
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h3 className="text-lg font-light text-foreground mb-2">
                {t("failedLoad")}
              </h3>
              <p className="text-muted-foreground mb-4">{error}</p>
              <button
                onClick={() => fetchPatients(1)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                {t("tryAgain")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-light text-foreground">
            {t("title")}
          </h1>
          <p className="text-muted-foreground font-light mt-2">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <AddProfileModal
            defaultRole="client"
            onSuccess={() => fetchPatients(currentPage)}
          />
          <button
            onClick={() => fetchPatients(currentPage)}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/90 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {t("refresh")}
          </button>
          <Button className="gap-2" onClick={exportPatientsData}>
            <Download className="h-4 w-4" />
            {t("exportReport")}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-4">
        <div className="rounded-xl bg-card p-6 border border-border/40">
          <p className="text-sm font-light text-muted-foreground">
            {t("totalPatients")}
          </p>
          <p className="text-2xl font-serif font-light text-foreground mt-2">
            {summary.totalPatients}
          </p>
        </div>
        <div className="rounded-xl bg-card p-6 border border-border/40">
          <p className="text-sm font-light text-muted-foreground">{t("activePatients")}</p>
          <p className="text-2xl font-serif font-light text-foreground mt-2">
            {summary.activePatients}
          </p>
        </div>
        <div className="rounded-xl bg-card p-6 border border-border/40">
          <p className="text-sm font-light text-muted-foreground">
            {t("pendingPatients")}
          </p>
          <p className="text-2xl font-serif font-light text-foreground mt-2">
            {summary.pendingPatients}
          </p>
        </div>
        <div className="rounded-xl bg-card p-6 border border-border/40">
          <p className="text-sm font-light text-muted-foreground">
            {t("colSessions")}
          </p>
          <p className="text-2xl font-serif font-light text-foreground mt-2">
            {summary.totalSessions.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Status color legend */}
      <div className="rounded-xl bg-card border border-border/40 p-6 space-y-4">
        <h2 className="text-base font-medium text-foreground">
          {t("statusTierLegendTitle")}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border/40 text-left text-muted-foreground">
                <th className="py-2 pr-4 font-normal w-8" />
                <th className="py-2 pr-4 font-normal">{t("statusTierMeaning")}</th>
                <th className="py-2 font-normal">{t("statusTierAction")}</th>
              </tr>
            </thead>
            <tbody>
              {STATUS_TIERS.map((tier) => (
                <tr
                  key={tier}
                  className="border-b border-border/20 last:border-0 align-top"
                >
                  <td className="py-3 pr-4">
                    <span
                      className={`inline-block h-3 w-3 rounded-full ${clientStatusTierColors[tier].dot}`}
                      aria-hidden
                    />
                  </td>
                  <td className="py-3 pr-4 text-foreground">
                    <span className="font-medium">
                      {t(`statusTier.tiers.${tier}.label`)}
                    </span>
                    <span className="text-muted-foreground block mt-0.5 text-xs">
                      {t(`statusTier.tiers.${tier}.meaning`)}
                    </span>
                  </td>
                  <td className="py-3 text-muted-foreground text-xs">
                    {t(`statusTier.tiers.${tier}.action`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl bg-card border border-border/40">
        <div className="p-6 border-b border-border/40">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex items-center gap-3">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[150px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder={t("filterStatus")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allStatuses")}</SelectItem>
                  <SelectItem value="active">{t("statusActive")}</SelectItem>
                  <SelectItem value="pending">{t("statusPending")}</SelectItem>
                  <SelectItem value="inactive">{t("statusInactive")}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={tierFilter} onValueChange={setTierFilter}>
                <SelectTrigger className="w-[170px]">
                  <SelectValue placeholder={t("filterTier")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allTiers")}</SelectItem>
                  {STATUS_TIERS.map((tier) => (
                    <SelectItem key={tier} value={tier}>
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${clientStatusTierColors[tier].dot}`}
                        />
                        {t(`statusTier.tiers.${tier}.label`)}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-left text-sm font-light text-muted-foreground">
                  {t("colClient")}
                </TableHead>
                <TableHead className="text-left text-sm font-light text-muted-foreground">
                  Contact
                </TableHead>
                <TableHead className="text-left text-sm font-light text-muted-foreground">
                  {t("colStatusTier")}
                </TableHead>
                <TableHead className="text-left text-sm font-light text-muted-foreground">
                  {t("colStatus")}
                </TableHead>
                <TableHead className="text-left text-sm font-light text-muted-foreground">
                  {t("colProfessional")}
                </TableHead>
                <TableHead className="text-left text-sm font-light text-muted-foreground">
                  {t("colSessions")}
                </TableHead>
                <TableHead className="text-left text-sm font-light text-muted-foreground">
                  {t("colJoined")}
                </TableHead>
                <TableHead className="text-left text-sm font-light text-muted-foreground">
                  {t("colActions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {patients.map((patient) => (
                <TableRow
                  key={patient.id}
                  className="hover:bg-muted/20 transition-colors"
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <p className="font-light text-foreground">
                        {patient.name}
                      </p>
                      {patient.role === "guest" && (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700">
                          <User className="h-3 w-3" />
                          Guest
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="text-sm font-light text-foreground">
                        {patient.email}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {patient.phone}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <ClientStatusTierBadge
                      tier={patient.statusTier ?? "gray"}
                      label={t(
                        `statusTier.tiers.${patient.statusTier ?? "gray"}.label`,
                      )}
                    />
                  </TableCell>
                  <TableCell className="text-sm font-light text-muted-foreground">
                    {patient.matchedWith || "-"}
                  </TableCell>
                  <TableCell className="text-sm font-light text-foreground">
                    {patient.totalSessions}
                  </TableCell>
                  <TableCell className="text-sm font-light text-muted-foreground">
                    {new Date(patient.joinedDate).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" asChild>
                      <Link href={`/admin/dashboard/patients/${patient.id}`}>
                        <Eye className="h-4 w-4 text-primary" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {patients.length === 0 && (
            <div className="p-12 text-center">
              <p className="text-muted-foreground">{t("noPatients")}</p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                {t("noPatientsDesc")}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
