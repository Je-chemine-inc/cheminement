"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Category = "mandat" | "approche" | "expertise";
const CATEGORIES: Category[] = ["mandat", "approche", "expertise"];

interface CatalogItem {
  id: string;
  category: Category;
  labelFr: string;
  labelEn: string;
  active: boolean;
  /** Spec 003: an expertise offered as a tag on showcase pages. */
  showcase: boolean;
  /** What the theme covers, on every page offering it. */
  descriptionFr: string;
  descriptionEn: string;
  /** Its URL segment on the city pages. */
  slug: string;
}

const emptyDraft = (category: Category): CatalogItem => ({
  id: "",
  category,
  labelFr: "",
  labelEn: "",
  active: true,
  showcase: false,
  descriptionFr: "",
  descriptionEn: "",
  slug: "",
});

export default function AdminProCatalogPage() {
  const t = useTranslations("AdminDashboard.proCatalog");

  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Category>("mandat");

  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<CatalogItem>(emptyDraft("mandat"));
  const [deleting, setDeleting] = useState<CatalogItem | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/pro-catalog", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      const body = (await res.json()) as { items: CatalogItem[] };
      setItems(body.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const visible = useMemo(
    () => (items ?? []).filter((i) => i.category === tab),
    [items, tab],
  );

  const openCreate = () => {
    setDraft(emptyDraft(tab));
    setMutationError(null);
    setEditorOpen(true);
  };
  const openEdit = (item: CatalogItem) => {
    setDraft({
      ...item,
      showcase: item.showcase === true,
      slug: item.slug ?? "",
      descriptionFr: item.descriptionFr ?? "",
      descriptionEn: item.descriptionEn ?? "",
    });
    setMutationError(null);
    setEditorOpen(true);
  };

  const save = async () => {
    const labelFr = draft.labelFr.trim();
    const labelEn = draft.labelEn.trim();
    if (!labelFr || !labelEn) {
      setMutationError(t("bothLabelsRequired"));
      return;
    }
    setSubmitting(true);
    setMutationError(null);
    try {
      const isEdit = Boolean(draft.id);
      const res = await fetch(
        isEdit ? `/api/admin/pro-catalog/${draft.id}` : "/api/admin/pro-catalog",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: draft.category,
            labelFr,
            labelEn,
            active: draft.active,
            // Only an expertise can appear on showcase pages; the API refuses
            // these fields for the other categories.
            ...(draft.category === "expertise"
              ? {
                  showcase: draft.showcase,
                  slug: draft.slug.trim().toLowerCase(),
                  descriptionFr: draft.descriptionFr,
                  descriptionEn: draft.descriptionEn,
                }
              : {}),
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      setEditorOpen(false);
      await fetchItems();
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (item: CatalogItem) => {
    try {
      await fetch(`/api/admin/pro-catalog/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !item.active }),
      });
      await fetchItems();
    } catch {
      /* surfaced on next refresh */
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setSubmitting(true);
    try {
      await fetch(`/api/admin/pro-catalog/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      await fetchItems();
    } catch {
      /* ignore */
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-serif font-light text-foreground">
            {t("title")}
          </h1>
          <p className="text-muted-foreground font-light mt-1 max-w-2xl">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={fetchItems} aria-label={t("refresh")}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button className="gap-2" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t("add")}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1 bg-muted rounded-full p-1 w-fit">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setTab(c)}
            className={`px-4 py-1.5 text-sm font-light rounded-full transition-colors ${
              tab === c
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(`categories.${c}`)}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {t("empty")}
        </p>
      ) : (
        <div className="rounded-lg border border-border/60 divide-y divide-border/40">
          {visible.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 p-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-light text-foreground truncate">
                    {item.labelFr}
                  </span>
                  {!item.active && (
                    <Badge variant="outline" className="text-muted-foreground">
                      {t("inactive")}
                    </Badge>
                  )}
                  {item.category === "expertise" && item.showcase && (
                    <Badge variant="secondary">{t("showcaseBadge")}</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {item.labelEn || "—"}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleActive(item)}
                >
                  {item.active ? t("deactivate") : t("activate")}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openEdit(item)}
                  aria-label={t("edit")}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleting(item)}
                  aria-label={t("delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / edit editor */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{draft.id ? t("editTitle") : t("addTitle")}</DialogTitle>
            <DialogDescription>
              {t(`categories.${draft.category}`)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("labelFr")}</Label>
              <Input
                value={draft.labelFr}
                onChange={(e) => setDraft({ ...draft, labelFr: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("labelEn")}</Label>
              <Input
                value={draft.labelEn}
                onChange={(e) => setDraft({ ...draft, labelEn: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
              />
              {t("activeLabel")}
            </label>
            {draft.category === "expertise" && (
              <div className="space-y-3 rounded-lg border border-border/60 p-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={draft.showcase}
                    onChange={(e) => setDraft({ ...draft, showcase: e.target.checked })}
                  />
                  <span>
                    {t("showcaseLabel")}
                    <span className="block text-xs text-muted-foreground">{t("showcaseHint")}</span>
                  </span>
                </label>
                <div className="space-y-2">
                  <Label htmlFor="pro-catalog-slug">{t("slugLabel")}</Label>
                  <Input
                    id="pro-catalog-slug"
                    value={draft.slug}
                    placeholder="anxiete"
                    onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase() })}
                  />
                  <p className="text-xs text-muted-foreground">{t("slugHint")}</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pro-catalog-description-fr">{t("descriptionFrLabel")}</Label>
                  <Textarea
                    id="pro-catalog-description-fr"
                    rows={4}
                    maxLength={600}
                    value={draft.descriptionFr}
                    onChange={(e) => setDraft({ ...draft, descriptionFr: e.target.value })}
                  />
                  <Label htmlFor="pro-catalog-description-en">{t("descriptionEnLabel")}</Label>
                  <Textarea
                    id="pro-catalog-description-en"
                    rows={4}
                    maxLength={600}
                    value={draft.descriptionEn}
                    onChange={(e) => setDraft({ ...draft, descriptionEn: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">{t("descriptionHint")}</p>
                </div>
              </div>
            )}
            {mutationError && (
              <p className="text-sm text-destructive">{mutationError}</p>
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
            <Button onClick={save} disabled={submitting}>
              {submitting ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteConfirm", { label: deleting?.labelFr ?? "" })}
            </DialogDescription>
          </DialogHeader>
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
              {submitting ? t("deleting") : t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
