"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  RefreshCw,
  Library as LibraryIcon,
  ExternalLink,
} from "lucide-react";
import { useTranslations } from "next-intl";
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

type ResourceType = "ebook" | "video" | "course" | "worksheet" | "guide" | "tool";

interface AdminResource {
  id: string;
  title: string;
  description: string;
  type: ResourceType;
  category: string;
  price: number;
  currency: string;
  fileUrl: string;
  contentUrl: string;
  previewUrl: string;
  tags: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface FormState {
  title: string;
  description: string;
  type: ResourceType;
  category: string;
  price: number;
  currency: string;
  fileUrl: string;
  contentUrl: string;
  previewUrl: string;
  tagsRaw: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  title: "",
  description: "",
  type: "guide",
  category: "",
  price: 0,
  currency: "CAD",
  fileUrl: "",
  contentUrl: "",
  previewUrl: "",
  tagsRaw: "",
  isActive: true,
};

const TYPES: ResourceType[] = ["ebook", "video", "course", "worksheet", "guide", "tool"];

export default function AdminLibraryPage() {
  const t = useTranslations("AdminDashboard.library");

  const [resources, setResources] = useState<AdminResource[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AdminResource | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleting, setDeleting] = useState<AdminResource | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const fetchResources = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/resources", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      const body = (await res.json()) as { resources: AdminResource[] };
      setResources(body.resources);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load resources");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchResources();
  }, [fetchResources]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setMutationError(null);
    setEditorOpen(true);
  };

  const openEdit = (r: AdminResource) => {
    setEditing(r);
    setForm({
      title: r.title,
      description: r.description,
      type: r.type,
      category: r.category,
      price: r.price,
      currency: r.currency,
      fileUrl: r.fileUrl,
      contentUrl: r.contentUrl,
      previewUrl: r.previewUrl,
      tagsRaw: r.tags.join(", "),
      isActive: r.isActive,
    });
    setMutationError(null);
    setEditorOpen(true);
  };

  const submitForm = async () => {
    setSubmitting(true);
    setMutationError(null);
    try {
      const url = editing
        ? `/api/admin/resources/${editing.id}`
        : "/api/admin/resources";
      const method = editing ? "PATCH" : "POST";
      const payload = {
        title: form.title,
        description: form.description,
        type: form.type,
        category: form.category,
        price: form.price,
        currency: form.currency,
        fileUrl: form.fileUrl,
        contentUrl: form.contentUrl,
        previewUrl: form.previewUrl,
        tags: form.tagsRaw,
        isActive: form.isActive,
      };
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      setEditorOpen(false);
      await fetchResources();
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setSubmitting(true);
    setMutationError(null);
    try {
      const res = await fetch(`/api/admin/resources/${deleting.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      setDeleting(null);
      await fetchResources();
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-light text-foreground">
            {t("title")}
          </h1>
          <p className="text-muted-foreground font-light mt-2">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchResources} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            {t("addResource")}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 flex items-center gap-2 text-red-800">
          <AlertCircle className="h-5 w-5" />
          <p className="font-light">{error}</p>
        </div>
      )}

      {loading && !resources ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : resources && resources.length === 0 ? (
        <div className="rounded-xl bg-card p-12 border border-border/40 text-center">
          <LibraryIcon className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">{t("empty")}</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(resources ?? []).map((r) => (
            <div
              key={r.id}
              className="rounded-xl border border-border/40 bg-card p-5 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    {t(`types.${r.type}`)}
                    {r.category ? ` · ${r.category}` : ""}
                  </p>
                  <h3 className="font-medium text-foreground truncate">
                    {r.title}
                  </h3>
                </div>
                {!r.isActive && (
                  <span className="text-xs rounded-full bg-muted px-2 py-0.5 text-muted-foreground shrink-0">
                    {t("inactive")}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground line-clamp-3">
                {r.description}
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium">
                  {r.price > 0
                    ? `${r.price.toFixed(2)} ${r.currency}`
                    : t("free")}
                </span>
                {r.tags.length > 0 && (
                  <span className="truncate">· {r.tags.join(", ")}</span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs">
                {r.fileUrl && (
                  <a
                    href={r.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" /> {t("file")}
                  </a>
                )}
                {r.contentUrl && (
                  <a
                    href={r.contentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" /> {t("content")}
                  </a>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
                <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleting(r)}>
                  <Trash2 className="h-4 w-4 text-red-600" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? t("editTitle") : t("createTitle")}
            </DialogTitle>
            <DialogDescription>
              {editing ? t("editDescription") : t("createDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="r-title">{t("titleLabel")}</Label>
              <Input
                id="r-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>

            <div>
              <Label htmlFor="r-description">{t("descriptionLabel")}</Label>
              <Textarea
                id="r-description"
                value={form.description}
                rows={4}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t("typeLabel")}</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => setForm((f) => ({ ...f, type: v as ResourceType }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map((tt) => (
                      <SelectItem key={tt} value={tt}>
                        {t(`types.${tt}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="r-category">{t("categoryLabel")}</Label>
                <Input
                  id="r-category"
                  value={form.category}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, category: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="r-price">{t("priceLabel")}</Label>
                <Input
                  id="r-price"
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.price}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      price: Number.parseFloat(e.target.value) || 0,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="r-currency">{t("currencyLabel")}</Label>
                <Input
                  id="r-currency"
                  value={form.currency}
                  maxLength={3}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))
                  }
                />
              </div>
            </div>

            <div>
              <Label htmlFor="r-fileUrl">{t("fileUrlLabel")}</Label>
              <Input
                id="r-fileUrl"
                value={form.fileUrl}
                onChange={(e) =>
                  setForm((f) => ({ ...f, fileUrl: e.target.value }))
                }
                placeholder="https://..."
              />
            </div>
            <div>
              <Label htmlFor="r-contentUrl">{t("contentUrlLabel")}</Label>
              <Input
                id="r-contentUrl"
                value={form.contentUrl}
                onChange={(e) =>
                  setForm((f) => ({ ...f, contentUrl: e.target.value }))
                }
                placeholder="https://..."
              />
            </div>
            <div>
              <Label htmlFor="r-previewUrl">{t("previewUrlLabel")}</Label>
              <Input
                id="r-previewUrl"
                value={form.previewUrl}
                onChange={(e) =>
                  setForm((f) => ({ ...f, previewUrl: e.target.value }))
                }
                placeholder="https://..."
              />
            </div>
            <div>
              <Label htmlFor="r-tags">{t("tagsLabel")}</Label>
              <Input
                id="r-tags"
                value={form.tagsRaw}
                onChange={(e) =>
                  setForm((f) => ({ ...f, tagsRaw: e.target.value }))
                }
                placeholder={t("tagsPlaceholder")}
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) =>
                  setForm((f) => ({ ...f, isActive: e.target.checked }))
                }
              />
              {t("activeLabel")}
            </label>

            {mutationError && (
              <p className="text-sm text-red-600">{mutationError}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditorOpen(false)}
              disabled={submitting}
            >
              {t("cancel")}
            </Button>
            <Button onClick={submitForm} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editing ? t("save") : t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmDeleteTitle")}</DialogTitle>
            <DialogDescription>{t("confirmDeleteDescription")}</DialogDescription>
          </DialogHeader>
          {deleting && (
            <div className="rounded-lg bg-muted p-3 text-sm">
              <p className="font-medium">{deleting.title}</p>
            </div>
          )}
          {mutationError && <p className="text-sm text-red-600">{mutationError}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleting(null)}
              disabled={submitting}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={submitting}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
