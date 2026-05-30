"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Search,
  Filter,
  Eye,
  CalendarDays,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  RefreshCw,
  Download,
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
type ProfessionalStatus = "active" | "pending" | "inactive";

interface Professional {
  id: string;
  name: string;
  email: string;
  specialty: string;
  license: string;
  status: ProfessionalStatus;
  joinedDate: string;
  totalClients: number;
  totalSessions: number;
}

interface ProfessionalsData {
  professionals: Professional[];
  summary: {
    totalProfessionals: number;
    activeProfessionals: number;
    pendingProfessionals: number;
    totalSessions: number;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export default function ProfessionalsPage() {
  const t = useTranslations("AdminDashboard.professionals");
  const [data, setData] = useState<ProfessionalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);

  const fetchProfessionals = useCallback(
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
        const response = await fetch(`/api/admin/professionals?${params}`);
        if (!response.ok) {
          throw new Error("Failed to fetch professionals");
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
    fetchProfessionals(1);
  }, [fetchProfessionals]);

  const professionals = data?.professionals || [];
  const summary = data?.summary || {
    totalProfessionals: 0,
    activeProfessionals: 0,
    pendingProfessionals: 0,
    totalSessions: 0,
  };

  const exportProfessionalsData = () => {
    if (!data) return;

    const { professionals, summary } = data;

    // Create CSV content
    let csvContent = "Professionals Data Export\n";
    csvContent += `Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}\n\n`;

    // Summary section
    csvContent += "Summary\n";
    csvContent += "Metric,Value\n";
    csvContent += `Total Professionals,${summary.totalProfessionals}\n`;
    csvContent += `Active Professionals,${summary.activeProfessionals}\n`;
    csvContent += `Pending Professionals,${summary.pendingProfessionals}\n`;
    csvContent += `Total Sessions,${summary.totalSessions}\n\n`;

    // Professionals data
    csvContent += "Professional Details\n";
    csvContent +=
      "ID,Name,Email,Specialty,License,Status,Clients,Sessions,Joined Date\n";

    professionals.forEach((professional) => {
      csvContent += `${professional.id},"${professional.name}","${professional.email}","${professional.specialty}","${professional.license}","${professional.status}",${professional.totalClients},${professional.totalSessions},"${new Date(professional.joinedDate).toLocaleDateString()}"\n`;
    });

    // Create and download the file
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `professionals-data-${new Date().toISOString().split("T")[0]}.csv`,
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getStatusBadge = (status: ProfessionalStatus) => {
    const styles = {
      active: "bg-green-100 text-green-700",
      pending: "bg-yellow-100 text-yellow-700",
      inactive: "bg-gray-100 text-gray-700",
    };

    const icons = {
      active: CheckCircle2,
      pending: Clock,
      inactive: XCircle,
    };

    const Icon = icons[status];

    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${styles[status]}`}
      >
        <Icon className="h-3 w-3" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
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
                onClick={() => fetchProfessionals(1)}
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
            defaultRole="professional"
            onSuccess={() => fetchProfessionals(currentPage)}
          />
          <button
            onClick={() => fetchProfessionals(currentPage)}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/90 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {t("refresh")}
          </button>
          <Button className="gap-2" onClick={exportProfessionalsData}>
            <Download className="h-4 w-4" />
            {t("exportReport")}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-4">
        <div className="rounded-xl bg-card p-6 border border-border/40">
          <p className="text-sm font-light text-muted-foreground">
            {t("totalProf")}
          </p>
          <p className="text-2xl font-serif font-light text-foreground mt-2">
            {summary.totalProfessionals}
          </p>
        </div>
        <div className="rounded-xl bg-card p-6 border border-border/40">
          <p className="text-sm font-light text-muted-foreground">{t("activeProf")}</p>
          <p className="text-2xl font-serif font-light text-foreground mt-2">
            {summary.activeProfessionals}
          </p>
        </div>
        <div className="rounded-xl bg-card p-6 border border-border/40">
          <p className="text-sm font-light text-muted-foreground">{t("pendingProf")}</p>
          <p className="text-2xl font-serif font-light text-foreground mt-2">
            {summary.pendingProfessionals}
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
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-left text-sm font-light text-muted-foreground">
                  {t("colProfessional")}
                </TableHead>
                <TableHead className="text-left text-sm font-light text-muted-foreground">
                  {t("colSpecialty")}
                </TableHead>
                <TableHead className="text-left text-sm font-light text-muted-foreground">
                  {t("colLicense")}
                </TableHead>
                <TableHead className="text-left text-sm font-light text-muted-foreground">
                  {t("colStatus")}
                </TableHead>
                <TableHead className="text-left text-sm font-light text-muted-foreground">
                  {t("colClients")}
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
              {professionals.map((professional) => (
                <TableRow
                  key={professional.id}
                  className="hover:bg-muted/20 transition-colors"
                >
                  <TableCell>
                    <div>
                      <p className="font-light text-foreground">
                        {professional.name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {professional.email}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm font-light text-foreground">
                    {professional.specialty}
                  </TableCell>
                  <TableCell className="text-sm font-light text-muted-foreground">
                    {professional.license}
                  </TableCell>
                  <TableCell>{getStatusBadge(professional.status)}</TableCell>
                  <TableCell className="text-sm font-light text-foreground">
                    {professional.totalClients}
                  </TableCell>
                  <TableCell className="text-sm font-light text-foreground">
                    {professional.totalSessions}
                  </TableCell>
                  <TableCell className="text-sm font-light text-muted-foreground">
                    {new Date(professional.joinedDate).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-sm font-light text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/admin/dashboard/professionals/${professional.id}/schedule`}
                        title={t("openCalendar")}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("openCalendar")}
                        >
                          <CalendarDays className="h-4 w-4 text-primary" />
                        </Button>
                      </Link>
                      <Link
                        href={`/admin/dashboard/professionals/${professional.id}`}
                        title={t("viewProfile")}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("viewProfile")}
                        >
                          <Eye className="h-4 w-4 text-primary" />
                        </Button>
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {professionals.length === 0 && (
            <div className="p-12 text-center">
              <p className="text-muted-foreground">{t("noProfessionals")}</p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                {t("noProfessionalsDesc")}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
