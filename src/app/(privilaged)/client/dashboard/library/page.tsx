"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Download,
  FileText,
  FolderOpen,
  Loader2,
  Lock,
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

interface PurchasedResource {
  slug: string;
  title: string;
  summary: string;
  iconUrl?: string;
  purchasedAt: string;
}

export default function ClientLibraryPage() {
  const t = useTranslations("Client.library");
  const tResources = useTranslations("Resources");

  const [docs, setDocs] = useState<ClientDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  // null = still loading, so the empty state never flashes before the fetch.
  const [purchases, setPurchases] = useState<PurchasedResource[] | null>(null);

  useEffect(() => {
    fetch("/api/client/documents")
      .then((r) => r.json())
      .then((data) => setDocs(Array.isArray(data) ? data : []))
      .catch(() => setDocs([]))
      .finally(() => setLoadingDocs(false));
  }, []);

  useEffect(() => {
    fetch("/api/client/resources")
      .then((r) => r.json())
      .then((data) => setPurchases(Array.isArray(data?.items) ? data.items : []))
      .catch(() => setPurchases([]));
  }, []);

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

      {/* Purchased premium resources */}
      <section
        id="purchased"
        className="rounded-3xl border border-border/20 bg-card/80 p-7 shadow-lg"
      >
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-primary/10 p-3">
            <Lock className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-serif text-2xl font-light text-foreground">
              {t("purchased.title")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("purchased.subtitle")}
            </p>
          </div>
        </div>

        <div className="mt-6">
          {purchases === null ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : purchases.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/50 bg-muted/20 p-10 text-center">
              <BookOpen className="mx-auto h-12 w-12 text-muted-foreground/40" />
              <p className="mt-4 text-sm font-medium text-muted-foreground">
                {t("purchased.empty")}
              </p>
              <p className="mt-2 text-xs text-muted-foreground/70">
                {t("purchased.emptyDesc")}
              </p>
              <Link
                href="/book#resources"
                className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                {tResources("explorePremium")}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {purchases.map((item) => (
                <div
                  key={item.slug}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/20 bg-card/70 p-4"
                >
                  <div className="flex items-center gap-3">
                    {item.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.iconUrl}
                        alt=""
                        className="h-11 w-11 rounded-xl object-cover"
                      />
                    ) : (
                      <div className="rounded-xl bg-primary/10 p-2.5">
                        <BookOpen className="h-5 w-5 text-primary" />
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {item.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("purchased.purchasedOn")}{" "}
                        {formatDocDate(item.purchasedAt)}
                      </p>
                    </div>
                  </div>
                  <Link href={`/book/${item.slug}`}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 rounded-full"
                    >
                      {t("purchased.open")}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
