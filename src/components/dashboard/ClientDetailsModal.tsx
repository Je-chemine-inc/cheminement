"use client";

import { useState, useEffect, useRef } from "react";
import {
  X,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Clock,
  FileText,
  Upload,
  Trash2,
  Download,
  Loader2,
} from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { appointmentsAPI } from "@/lib/api-client";
import { AppointmentResponse } from "@/types/api";
import { Button } from "@/components/ui/button";
import { ClientStatusTierBadge } from "@/components/dashboard/ClientStatusTierBadge";
import type { ClientStatusTier } from "@/lib/client-status-tier";

interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: "active" | "inactive" | "pending";
  statusTier?: ClientStatusTier;
  lastSession: string;
  totalSessions: number;
  issueType: string;
  joinedDate: string;
  address?: string;
  age?: number;
  emergencyContact?: string;
  emergencyPhone?: string;
}

interface ClientDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  client: Client | null;
}

export default function ClientDetailsModal({
  isOpen,
  onClose,
  client,
}: ClientDetailsModalProps) {
  const t = useTranslations("Dashboard.clientModal");
  const tClients = useTranslations("Dashboard.clients");
  const locale = useLocale();
  const [sessions, setSessions] = useState<AppointmentResponse[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [uploadedDocuments, setUploadedDocuments] = useState<
    { _id: string; fileUrl: string; name: string; createdAt: string }[]
  >([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (client) {
      const fetchSessions = async () => {
        setSessionsLoading(true);
        try {
          const data = await appointmentsAPI.list({
            clientId: client.id,
          });
          setSessions(data);
        } catch (error) {
          console.error("Failed to fetch sessions:", error);
          setSessions([]);
        } finally {
          setSessionsLoading(false);
        }
      };
      const fetchDocuments = async () => {
        try {
          const res = await fetch(`/api/clients/${client.id}/documents`);
          if (!res.ok) {
            setUploadedDocuments([]);
            return;
          }
          const docs = (await res.json()) as Array<{
            _id: string;
            fileUrl: string;
            name: string;
            createdAt: string;
          }>;
          setUploadedDocuments(docs);
        } catch (e) {
          console.error("Failed to fetch patient documents:", e);
          setUploadedDocuments([]);
        }
      };
      fetchSessions();
      fetchDocuments();
    }
  }, [client]);

  if (!isOpen || !client) return null;

  const getStatusBadge = (status: Client["status"]) => {
    const styles = {
      active: "bg-green-100 text-green-700",
      inactive: "bg-gray-100 text-gray-700",
      pending: "bg-yellow-100 text-yellow-700",
    };

    return (
      <span
        className={`px-3 py-1 rounded-full text-xs font-light ${styles[status]}`}
      >
        {t(`overview.${status}`)}
      </span>
    );
  };

  const getSessionStatusBadge = (status: AppointmentResponse["status"]) => {
    const styles = {
      completed: "bg-green-100 text-green-700",
      cancelled: "bg-red-100 text-red-700",
      scheduled: "bg-blue-100 text-blue-700",
      "no-show": "bg-orange-100 text-orange-700",
      ongoing: "bg-purple-100 text-purple-700",
      pending: "bg-yellow-100 text-yellow-700",
    };

    return (
      <span
        className={`px-2 py-1 rounded-full text-xs font-light ${styles[status]}`}
      >
        {t(`sessions.${status}`)}
      </span>
    );
  };

  const getPaymentStatusBadge = (
    paymentStatus: AppointmentResponse["payment"]["status"],
  ) => {
    const styles = {
      paid: "bg-green-100 text-green-700",
      pending: "bg-yellow-100 text-yellow-700",
      processing: "bg-blue-100 text-blue-700",
      overdue: "bg-orange-100 text-orange-700",
      cancelled: "bg-red-100 text-red-700",
      failed: "bg-red-100 text-red-700",
      refunded: "bg-brown-100 text-brown-700",
    };

    return (
      <span
        className={`px-2 py-1 rounded-full text-xs font-light ${styles[paymentStatus]}`}
      >
        {t(`sessions.${paymentStatus}`)}
      </span>
    );
  };

  const formatShortDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(locale === "fr" ? "fr-CA" : "en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file || !client) return;

    setIsUploading(true);
    setUploadError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("clientId", client.id);

    try {
      const response = await fetch("/api/upload/patient-document", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to upload file");
      }

      const doc = (await response.json()) as {
        _id: string;
        fileUrl: string;
        name: string;
        createdAt: string;
      };
      setUploadedDocuments((prev) => [doc, ...prev]);
    } catch (error: unknown) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRemoveDocument = async (index: number) => {
    if (!client) return;
    const target = uploadedDocuments[index];
    if (!target?._id) return;
    const previous = uploadedDocuments;
    setUploadedDocuments((prev) => prev.filter((_, i) => i !== index));
    try {
      const res = await fetch(
        `/api/clients/${client.id}/documents/${target._id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Delete failed");
    } catch (e) {
      console.error("Failed to delete patient document:", e);
      setUploadedDocuments(previous);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-background rounded-2xl shadow-2xl m-4">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background border-b border-border/40 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xl font-serif">
              {client.name.charAt(0)}
            </div>
            <div>
              <h2 className="text-2xl font-serif font-light text-foreground">
                {client.name}
              </h2>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                {getStatusBadge(client.status)}
                <ClientStatusTierBadge
                  tier={client.statusTier ?? "yellow"}
                  label={tClients(
                    `statusTier.tiers.${client.statusTier ?? "yellow"}.label`,
                  )}
                />
                <span className="text-sm text-muted-foreground font-light">
                  {formatShortDate(client.joinedDate)}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-muted transition-colors"
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Client Information */}
          <div className="rounded-xl bg-card p-6">
            <h3 className="text-lg font-serif font-light text-foreground mb-4">
              {t("overview.contactInfo")}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <Mail className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground font-light mb-1">
                      {t("overview.email")}
                    </p>
                    <p className="text-sm text-foreground">{client.email}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Phone className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground font-light mb-1">
                      {t("overview.phone")}
                    </p>
                    <p className="text-sm text-foreground">{client.phone}</p>
                  </div>
                </div>

                {client.address && (
                  <div className="flex items-start gap-3">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-xs text-muted-foreground font-light mb-1">
                        {t("overview.address")}
                      </p>
                      <p className="text-sm text-foreground">
                        {client.address}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground font-light mb-1">
                      {t("overview.issueType")}
                    </p>
                    <p className="text-sm text-foreground">
                      {client.issueType}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground font-light mb-1">
                      {t("overview.totalSessions")}
                    </p>
                    <p className="text-sm text-foreground">
                      {client.totalSessions} {t("overview.sessions")}
                    </p>
                  </div>
                </div>

                {client.age && (
                  <div className="flex items-start gap-3">
                    <div className="h-4 w-4 mt-0.5" />
                    <div>
                      <p className="text-xs text-muted-foreground font-light mb-1">
                        {t("overview.age")}
                      </p>
                      <p className="text-sm text-foreground">
                        {client.age} {t("overview.yearsOld")}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {client.emergencyContact && (
              <div className="mt-6 pt-6 border-t border-border/40">
                <p className="text-sm font-light text-muted-foreground mb-3">
                  {t("overview.emergencyContactTitle")}
                </p>
                <div className="flex items-center gap-6">
                  <div>
                    <p className="text-xs text-muted-foreground font-light mb-1">
                      {t("overview.emergencyName")}
                    </p>
                    <p className="text-sm text-foreground">
                      {client.emergencyContact}
                    </p>
                  </div>
                  {client.emergencyPhone && (
                    <div>
                      <p className="text-xs text-muted-foreground font-light mb-1">
                        {t("overview.emergencyPhone")}
                      </p>
                      <p className="text-sm text-foreground">
                        {client.emergencyPhone}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Patient Documents */}
          <div className="rounded-xl bg-card p-6">
            <h3 className="text-lg font-serif font-light text-foreground mb-4">
              {t("documents.title")}
            </h3>
            <div className="space-y-4">
              <div
                className="border-2 border-dashed border-border/60 rounded-xl p-6 text-center cursor-pointer hover:border-primary/80 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  onChange={handleFileUpload}
                  accept="application/pdf,image/jpeg,image/png"
                  disabled={isUploading}
                />
                {isUploading ? (
                  <div className="flex items-center justify-center gap-2 text-primary">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>{t("documents.uploading")}</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {t("documents.uploadBoxText1")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("documents.uploadBoxText2")}
                    </p>
                  </div>
                )}
              </div>
              {uploadError && (
                <p className="text-red-500 text-sm text-center">{uploadError}</p>
              )}

              {uploadedDocuments.length > 0 && (
                <div className="space-y-3 mt-6">
                  <p className="text-sm font-light text-muted-foreground">
                    {t("documents.uploadedTitle")}
                  </p>
                  {uploadedDocuments.map((doc, index) => (
                    <div
                      key={doc._id}
                      className="flex items-center justify-between bg-muted/30 rounded-lg p-3"
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-primary" />
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {doc.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatShortDate(doc.createdAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <a
                          href={doc.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 rounded-full hover:bg-muted transition-colors text-primary"
                          title={t("documents.download")}
                        >
                          <Download className="h-4 w-4" />
                        </a>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveDocument(index)}
                          className="text-red-500 hover:text-red-600 hover:bg-red-50"
                          title={t("documents.delete")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recent Sessions */}
          <div className="rounded-xl bg-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-serif font-light text-foreground">
                {t("sessions.title")}
              </h3>
              <button className="text-sm text-primary hover:text-primary/80 font-light transition-colors">
                {t("sessions.viewNotes")}
              </button>
            </div>

            <div className="space-y-3">
              {sessionsLoading ? (
                <p className="text-center text-muted-foreground">
                  {t("sessions.loading")}
                </p>
              ) : sessions.length === 0 ? (
                <p className="text-center text-muted-foreground">
                  {t("sessions.noSessions")}
                </p>
              ) : (
                sessions.map((session) => (
                  <div
                    key={session._id}
                    className="rounded-lg bg-muted/30 p-4 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <p className="text-sm font-medium text-foreground">
                            {session.type}
                          </p>
                          {getSessionStatusBadge(session.status)}
                          {getPaymentStatusBadge(session.payment.status)}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground font-light mb-2">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            <span>{formatShortDate(session.date)}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            <span>
                              {session.duration} {t("sessions.duration")}
                            </span>
                          </div>
                        </div>
                        {session.notes && (
                          <p className="text-sm text-muted-foreground font-light">
                            {session.notes}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-6 py-2.5 text-foreground font-light transition-colors hover:text-muted-foreground rounded-full"
            >
              {t("actions.close")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
