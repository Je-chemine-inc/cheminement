"use client";

import { useState, useMemo, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Filter,
  Mail,
  Phone,
  Eye,
  Calendar,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { clientsAPI } from "@/lib/api-client";
import ClientDetailsModal from "@/components/dashboard/ClientDetailsModal";
import { ClientStatusTierBadge } from "@/components/dashboard/ClientStatusTierBadge";
import { clientStatusTierColors } from "@/config/colors";
import type { ClientStatusTier } from "@/lib/client-status-tier";
import {
  ProfessionalBookAppointmentModal,
  type BookableClient,
} from "@/components/appointments/ProfessionalBookAppointmentModal";
import { Button } from "@/components/ui/button";

const STATUS_TIERS: ClientStatusTier[] = ["gray", "yellow", "green", "red"];

interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: "active" | "inactive" | "pending";
  paymentGuaranteeStatus?: "none" | "pending_admin" | "green";
  statusTier?: ClientStatusTier;
  lastSession: string;
  totalSessions: number;
  issueType: string;
  joinedDate: string;
}

export default function ClientsPage() {
  const t = useTranslations("Dashboard.clients");
  const locale = useLocale();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [issueTypeFilter, setIssueTypeFilter] = useState<string>("all");
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isBookModalOpen, setIsBookModalOpen] = useState(false);
  const [bookDefaultClientId, setBookDefaultClientId] = useState<
    string | undefined
  >(undefined);

  useEffect(() => {
    const fetchClients = async () => {
      try {
        const data = await clientsAPI.list();
        setClients(data as Client[]);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : t("loadingError"),
        );
      } finally {
        setLoading(false);
      }
    };
    fetchClients();
  }, []);

  // Extract unique issue types for filter
  const issueTypes = useMemo(() => {
    const types = new Set(clients.map((client) => client.issueType));
    return Array.from(types);
  }, [clients]);

  const baseClients = useMemo(
    () => clients.filter((client) => client.totalSessions > 0),
    [clients],
  );

  // Filter and search clients
  const filteredClients = useMemo(() => {
    return baseClients.filter((client) => {
      const matchesSearch =
        client.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        client.email.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus =
        statusFilter === "all" || client.status === statusFilter;

      const matchesIssueType =
        issueTypeFilter === "all" || client.issueType === issueTypeFilter;

      const tier = client.statusTier ?? "yellow";
      const matchesTier =
        tierFilter === "all" || tier === tierFilter;

      return matchesSearch && matchesStatus && matchesIssueType && matchesTier;
    });
  }, [baseClients, searchQuery, statusFilter, tierFilter, issueTypeFilter]);

  const getStatusBadge = (status: Client["status"]) => {
    const styles = {
      active: "bg-green-100 text-green-700",
      inactive: "bg-gray-100 text-gray-700",
      pending: "bg-yellow-100 text-yellow-700",
    };

    return (
      <span
        className={`px-2 py-1 rounded-full text-xs font-light ${styles[status]}`}
      >
        {t(status)}
      </span>
    );
  };

  const handleViewDetails = (client: Client) => {
    setSelectedClient(client);
    setIsDetailsModalOpen(true);
  };

  const openBookForClient = (client: Client) => {
    setBookDefaultClientId(client.id);
    setIsBookModalOpen(true);
  };

  const openBookForAny = () => {
    setBookDefaultClientId(undefined);
    setIsBookModalOpen(true);
  };

  const bookableClients: BookableClient[] = useMemo(
    () =>
      clients.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
      })),
    [clients],
  );

  const formatDate = (dateString: string) => {
    if (dateString === "-") return "-";
    const date = new Date(dateString);
    return date.toLocaleDateString(locale === "fr" ? "fr-CA" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-serif font-light text-foreground">
            {t("title")}
          </h1>
          <p className="text-muted-foreground font-light mt-2">
            {t("subtitle")}
          </p>
        </div>
        <Button
          onClick={openBookForAny}
          className="gap-2 rounded-full"
          disabled={bookableClients.length === 0}
        >
          <Calendar className="h-4 w-4" />
          {t("scheduleAppointment")}
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl bg-card p-4">
          <p className="text-sm font-light text-muted-foreground">
            {t("totalClients")}
          </p>
          <p className="text-2xl font-serif font-light text-foreground mt-2">
            {baseClients.length}
          </p>
        </div>
        <div className="rounded-xl bg-card p-4">
          <p className="text-sm font-light text-muted-foreground">
            {t("activeClients")}
          </p>
          <p className="text-2xl font-serif font-light text-foreground mt-2">
            {baseClients.filter((c) => c.status === "active").length}
          </p>
        </div>
        <div className="rounded-xl bg-card p-4">
          <p className="text-sm font-light text-muted-foreground">
            {t("pendingClients")}
          </p>
          <p className="text-2xl font-serif font-light text-foreground mt-2">
            {baseClients.filter((c) => c.status === "pending").length}
          </p>
        </div>
        <div className="rounded-xl bg-card p-4">
          <p className="text-sm font-light text-muted-foreground">
            {t("totalSessions")}
          </p>
          <p className="text-2xl font-serif font-light text-foreground mt-2">
            {baseClients.reduce((sum, c) => sum + c.totalSessions, 0)}
          </p>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="rounded-xl bg-card overflow-hidden">
        {/* Header - Always Visible */}
        <div className="p-6 pb-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setIsFilterExpanded(!isFilterExpanded)}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <Filter className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-serif font-light text-foreground">
                {t("filters")}
              </h2>
              {isFilterExpanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            {(searchQuery ||
              statusFilter !== "all" ||
              tierFilter !== "all" ||
              issueTypeFilter !== "all") && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("all");
                  setTierFilter("all");
                  setIssueTypeFilter("all");
                }}
                className="text-sm text-primary hover:text-primary/80 font-light transition-colors"
              >
                {t("hideFilters")}
              </button>
            )}
          </div>

          {/* Active Filters Summary - Shows when collapsed */}
          {!isFilterExpanded &&
            (searchQuery ||
              statusFilter !== "all" ||
              tierFilter !== "all" ||
              issueTypeFilter !== "all") && (
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {searchQuery && (
                  <span className="px-2 py-1 bg-primary/10 text-primary text-xs rounded-full font-light">
                    {searchQuery}
                  </span>
                )}
                {statusFilter !== "all" && (
                  <span className="px-2 py-1 bg-primary/10 text-primary text-xs rounded-full font-light">
                    {t("status")}: {t(statusFilter)}
                  </span>
                )}
                {tierFilter !== "all" && (
                  <span className="px-2 py-1 bg-primary/10 text-primary text-xs rounded-full font-light">
                    {t("statusTierFilter")}:{" "}
                    {t(`statusTier.tiers.${tierFilter as ClientStatusTier}.label`)}
                  </span>
                )}
                {issueTypeFilter !== "all" && (
                  <span className="px-2 py-1 bg-primary/10 text-primary text-xs rounded-full font-light">
                    {t("issueType")}: {issueTypeFilter}
                  </span>
                )}
              </div>
            )}
        </div>

        {/* Collapsible Content */}
        {isFilterExpanded && (
          <div className="px-6 pb-6 space-y-6 border-t border-border/40 pt-6">
            {/* Search Bar */}
            <div>
              <label className="text-sm font-light text-muted-foreground mb-2 block">
                {t("filters")}
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 h-11"
                />
              </div>
            </div>

            {/* Filters Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Status Filter */}
              <div>
                <label className="text-sm font-light text-muted-foreground mb-2 block">
                  {t("status")}
                </label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder={t("status")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      <span className="font-light">{t("all")}</span>
                    </SelectItem>
                    <SelectItem value="active">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-500"></span>
                        <span className="font-light">{t("active")}</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="inactive">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-gray-500"></span>
                        <span className="font-light">{t("inactive")}</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="pending">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                        <span className="font-light">{t("pending")}</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Case status (tier) filter */}
              <div>
                <label className="text-sm font-light text-muted-foreground mb-2 block">
                  {t("statusTierFilter")}
                </label>
                <Select value={tierFilter} onValueChange={setTierFilter}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder={t("statusTierFilter")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      <span className="font-light">{t("all")}</span>
                    </SelectItem>
                    {STATUS_TIERS.map((tier) => (
                      <SelectItem key={tier} value={tier}>
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${clientStatusTierColors[tier].dot}`}
                          />
                          <span className="font-light">
                            {t(`statusTier.tiers.${tier}.label`)}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Issue Type Filter */}
              <div className="md:col-span-2 lg:col-span-1">
                <label className="text-sm font-light text-muted-foreground mb-2 block">
                  {t("issueType")}
                </label>
                <Select
                  value={issueTypeFilter}
                  onValueChange={setIssueTypeFilter}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder={t("issueType")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      <span className="font-light">{t("all")}</span>
                    </SelectItem>
                    {issueTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        <span className="font-light">{type}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Results Summary */}
            <div className="pt-4 border-t border-border/40">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground font-light">
                  <span className="font-medium text-foreground">
                    {filteredClients.length}
                  </span>
                  <span>
                    {baseClients.length} {t("totalClients")}
                  </span>
                </div>
                {filteredClients.length !== baseClients.length && (
                  <span className="text-xs text-primary font-light">
                    {t("showFilters")}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Status tier legend */}
      <div className="rounded-xl bg-card p-6 space-y-4">
        <h2 className="text-lg font-serif font-light text-foreground">
          {t("statusTierLegendTitle")}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-light border-collapse">
            <thead>
              <tr className="border-b border-border/40 text-left text-muted-foreground">
                <th className="py-2 pr-4 font-normal w-10" />
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
                  <td className="py-3 text-muted-foreground">
                    {t(`statusTier.tiers.${tier}.action`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Clients Table */}
      <div className="rounded-xl bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-light">{t("name")}</TableHead>
              <TableHead className="font-light">{t("contact")}</TableHead>
              <TableHead className="font-light">{t("status")}</TableHead>
              <TableHead className="font-light">{t("statusTierColumn")}</TableHead>
              <TableHead className="font-light">{t("issueType")}</TableHead>
              <TableHead className="font-light">{t("lastSession")}</TableHead>
              <TableHead className="font-light">{t("totalSessions")}</TableHead>
              <TableHead className="font-light">{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center py-8 text-muted-foreground font-light"
                >
                  {t("loading")}
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center py-8 text-red-500 font-light"
                >
                  {error}
                </TableCell>
              </TableRow>
            ) : filteredClients.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center py-8 text-muted-foreground font-light"
                >
                  {t("noClients")}
                </TableCell>
              </TableRow>
            ) : (
              filteredClients.map((client) => (
                <TableRow key={client.id}>
                  <TableCell className="font-light">
                    <div>
                      <p className="font-medium text-foreground">
                        {client.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(client.joinedDate)}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="font-light">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm">
                        <Mail className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          {client.email}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          {client.phone}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{getStatusBadge(client.status)}</TableCell>
                  <TableCell>
                    <ClientStatusTierBadge
                      tier={client.statusTier ?? "yellow"}
                      label={t(
                        `statusTier.tiers.${client.statusTier ?? "yellow"}.label`,
                      )}
                    />
                  </TableCell>
                  <TableCell className="font-light">
                    <span className="text-sm">{client.issueType}</span>
                  </TableCell>
                  <TableCell className="font-light">
                    <span className="text-sm">
                      {formatDate(client.lastSession)}
                    </span>
                  </TableCell>
                  <TableCell className="font-light">
                    <span className="text-sm">
                      {client.totalSessions} {t("sessions")}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleViewDetails(client)}
                        className="inline-flex items-center justify-center h-10 w-10 rounded-lg hover:bg-muted transition-colors"
                        title={t("viewDetails")}
                      >
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() => openBookForClient(client)}
                        className="inline-flex items-center justify-center h-10 w-10 rounded-lg hover:bg-muted transition-colors"
                        title={t("schedule")}
                      >
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Client Details Modal */}
      <ClientDetailsModal
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
        client={selectedClient}
      />

      {/* Book Appointment Modal */}
      <ProfessionalBookAppointmentModal
        open={isBookModalOpen}
        onOpenChange={setIsBookModalOpen}
        clients={bookableClients}
        defaultClientId={bookDefaultClientId}
        onCreated={() => {
          // Refresh client list so totals update.
          clientsAPI
            .list()
            .then((data) => setClients(data as Client[]))
            .catch(() => {});
        }}
      />
    </div>
  );
}
