"use client";

import { useState, useEffect, useRef } from "react";
import {
  Clock,
  Download,
  FileText,
  FolderOpen,
  Loader2,
  Upload,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

interface ClientDoc {
  _id: string;
  name: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  sharedBy: "client" | "professional" | "platform";
  createdAt: string;
}

export default function ClientLibraryPage() {
  const t = useTranslations("Client.library");

  const [docs, setDocs] = useState<ClientDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/client/documents")
      .then((r) => r.json())
      .then((data) => setDocs(Array.isArray(data) ? data : []))
      .catch(() => setDocs([]))
      .finally(() => setLoadingDocs(false));
  }, []);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/client/documents", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t("myDocuments.uploadError"));
      }
      const newDoc: ClientDoc = await res.json();
      setDocs((prev) => [newDoc, ...prev]);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : t("myDocuments.uploadError"));
    } finally {
      setUploading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDocDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  const sharedByLabel = (doc: ClientDoc) => {
    if (doc.sharedBy === "professional") return t("myDocuments.sharedByProfessional");
    if (doc.sharedBy === "platform") return t("myDocuments.sharedByPlatform");
    return t("myDocuments.sharedByYou");
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="rounded-3xl border border-border/20 bg-linear-to-br from-primary/10 via-card to-card/80 p-8 shadow-lg">
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground/70">
            {t("badge")}
          </p>
          <h1 className="font-serif text-3xl font-light text-foreground lg:text-4xl">
            {t("title")}
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {t("description")}
          </p>
        </div>
      </section>

      {/* My Documents */}
      <section className="rounded-3xl border border-border/20 bg-card/80 p-7 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary/10 p-3">
              <FolderOpen className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-serif text-2xl font-light text-foreground">
                {t("myDocuments.title")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("myDocuments.subtitle")}
              </p>
            </div>
          </div>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              className="gap-2 rounded-full"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {uploading
                ? t("myDocuments.uploading")
                : t("myDocuments.uploadButton")}
            </Button>
          </div>
        </div>

        {uploadError && (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800/40 dark:bg-red-950/20 dark:text-red-400">
            {uploadError}
          </p>
        )}

        <div className="mt-6">
          {loadingDocs ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : docs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/50 bg-muted/20 p-10 text-center">
              <FolderOpen className="mx-auto h-12 w-12 text-muted-foreground/40" />
              <p className="mt-4 text-sm font-medium text-muted-foreground">
                {t("myDocuments.noDocuments")}
              </p>
              <p className="mt-2 text-xs text-muted-foreground/70">
                {t("myDocuments.noDocumentsDesc")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground/50">
                {t("myDocuments.uploadHint")}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {docs.map((doc) => (
                <div
                  key={doc._id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/20 bg-card/70 p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-primary/10 p-2.5">
                      <FileText className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {doc.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {sharedByLabel(doc)} · {formatFileSize(doc.fileSize)} ·{" "}
                        {t("myDocuments.uploadedAt")} {formatDocDate(doc.createdAt)}
                      </p>
                    </div>
                  </div>
                  <a href={doc.fileUrl} download={doc.name} target="_blank">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 rounded-full"
                    >
                      <Download className="h-4 w-4" />
                      {t("myDocuments.download")}
                    </Button>
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Educational Resources — Coming Soon */}
      <section
        id="resources"
        className="rounded-3xl border border-dashed border-border/40 bg-card/60 p-10 text-center shadow-inner"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
          <Clock className="h-6 w-6 text-amber-600 dark:text-amber-400" />
        </div>
        <h2 className="mt-4 font-serif text-2xl font-light text-foreground">
          {t("comingSoonTitle")}
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          {t("comingSoonDesc")}
        </p>
      </section>
    </div>
  );
}
