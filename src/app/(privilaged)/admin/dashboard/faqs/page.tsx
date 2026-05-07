"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  RefreshCw,
  HelpCircle,
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

type Audience = "all" | "client" | "professional";

interface AdminFaq {
  id: string;
  questionFr: string;
  questionEn: string;
  answerFr: string;
  answerEn: string;
  audience: Audience;
  order: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface FormState {
  questionFr: string;
  questionEn: string;
  answerFr: string;
  answerEn: string;
  audience: Audience;
  order: number;
  enabled: boolean;
}

const EMPTY_FORM: FormState = {
  questionFr: "",
  questionEn: "",
  answerFr: "",
  answerEn: "",
  audience: "all",
  order: 0,
  enabled: true,
};

export default function AdminFaqsPage() {
  const t = useTranslations("AdminDashboard.faqs");

  const [faqs, setFaqs] = useState<AdminFaq[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AdminFaq | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleting, setDeleting] = useState<AdminFaq | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const fetchFaqs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/faqs", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      const body = (await res.json()) as { faqs: AdminFaq[] };
      setFaqs(body.faqs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load FAQs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFaqs();
  }, [fetchFaqs]);

  const grouped = useMemo(() => {
    if (!faqs) return null;
    return {
      all: faqs.filter((f) => f.audience === "all"),
      client: faqs.filter((f) => f.audience === "client"),
      professional: faqs.filter((f) => f.audience === "professional"),
    };
  }, [faqs]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setMutationError(null);
    setEditorOpen(true);
  };

  const openEdit = (faq: AdminFaq) => {
    setEditing(faq);
    setForm({
      questionFr: faq.questionFr,
      questionEn: faq.questionEn,
      answerFr: faq.answerFr,
      answerEn: faq.answerEn,
      audience: faq.audience,
      order: faq.order,
      enabled: faq.enabled,
    });
    setMutationError(null);
    setEditorOpen(true);
  };

  const submitForm = async () => {
    setSubmitting(true);
    setMutationError(null);
    try {
      const url = editing ? `/api/admin/faqs/${editing.id}` : "/api/admin/faqs";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      setEditorOpen(false);
      await fetchFaqs();
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
      const res = await fetch(`/api/admin/faqs/${deleting.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      setDeleting(null);
      await fetchFaqs();
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSubmitting(false);
    }
  };

  const audienceLabel = (a: Audience) => t(`audience.${a}`);

  const renderRows = (list: AdminFaq[]) => {
    if (list.length === 0) {
      return (
        <p className="text-sm text-muted-foreground italic">{t("emptyGroup")}</p>
      );
    }
    return (
      <div className="space-y-2">
        {list
          .slice()
          .sort((a, b) => a.order - b.order || a.questionFr.localeCompare(b.questionFr))
          .map((faq) => (
            <div
              key={faq.id}
              className="rounded-lg border border-border/40 bg-card/60 p-4 flex items-start gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    #{faq.order}
                  </span>
                  {!faq.enabled && (
                    <span className="text-xs rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                      {t("disabled")}
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-foreground">
                  {faq.questionFr}
                </p>
                <p className="text-xs text-muted-foreground italic mt-0.5">
                  {faq.questionEn}
                </p>
                <p className="text-xs text-muted-foreground mt-2 line-clamp-2 whitespace-pre-line">
                  {faq.answerFr}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEdit(faq)}
                  aria-label={t("edit")}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleting(faq)}
                  aria-label={t("delete")}
                >
                  <Trash2 className="h-4 w-4 text-red-600" />
                </Button>
              </div>
            </div>
          ))}
      </div>
    );
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
          <Button variant="outline" onClick={fetchFaqs} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            {t("addFaq")}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 flex items-center gap-2 text-red-800">
          <AlertCircle className="h-5 w-5" />
          <p className="font-light">{error}</p>
        </div>
      )}

      {loading && !faqs ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : grouped ? (
        <div className="space-y-8">
          <section className="rounded-xl bg-card p-6 border border-border/40">
            <div className="flex items-center gap-2 mb-4">
              <HelpCircle className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-serif font-light text-foreground">
                {t("audience.all")}
              </h2>
            </div>
            {renderRows(grouped.all)}
          </section>

          <section className="rounded-xl bg-card p-6 border border-border/40">
            <div className="flex items-center gap-2 mb-4">
              <HelpCircle className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-serif font-light text-foreground">
                {t("audience.client")}
              </h2>
            </div>
            {renderRows(grouped.client)}
          </section>

          <section className="rounded-xl bg-card p-6 border border-border/40">
            <div className="flex items-center gap-2 mb-4">
              <HelpCircle className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-serif font-light text-foreground">
                {t("audience.professional")}
              </h2>
            </div>
            {renderRows(grouped.professional)}
          </section>
        </div>
      ) : null}

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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="questionFr">{t("questionFr")}</Label>
                <Input
                  id="questionFr"
                  value={form.questionFr}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, questionFr: e.target.value }))
                  }
                  placeholder={t("questionFrPlaceholder")}
                />
              </div>
              <div>
                <Label htmlFor="questionEn">{t("questionEn")}</Label>
                <Input
                  id="questionEn"
                  value={form.questionEn}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, questionEn: e.target.value }))
                  }
                  placeholder={t("questionEnPlaceholder")}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="answerFr">{t("answerFr")}</Label>
                <Textarea
                  id="answerFr"
                  value={form.answerFr}
                  rows={5}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, answerFr: e.target.value }))
                  }
                  placeholder={t("answerFrPlaceholder")}
                />
              </div>
              <div>
                <Label htmlFor="answerEn">{t("answerEn")}</Label>
                <Textarea
                  id="answerEn"
                  value={form.answerEn}
                  rows={5}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, answerEn: e.target.value }))
                  }
                  placeholder={t("answerEnPlaceholder")}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>{t("audienceLabel")}</Label>
                <Select
                  value={form.audience}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, audience: v as Audience }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{audienceLabel("all")}</SelectItem>
                    <SelectItem value="client">
                      {audienceLabel("client")}
                    </SelectItem>
                    <SelectItem value="professional">
                      {audienceLabel("professional")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="order">{t("orderLabel")}</Label>
                <Input
                  id="order"
                  type="number"
                  value={form.order}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      order: Number.parseInt(e.target.value, 10) || 0,
                    }))
                  }
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, enabled: e.target.checked }))
                    }
                  />
                  {t("enabled")}
                </label>
              </div>
            </div>

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
            <DialogDescription>
              {t("confirmDeleteDescription")}
            </DialogDescription>
          </DialogHeader>
          {deleting && (
            <div className="rounded-lg bg-muted p-3 text-sm">
              <p className="font-medium">{deleting.questionFr}</p>
              <p className="text-muted-foreground italic mt-1">
                {deleting.questionEn}
              </p>
            </div>
          )}
          {mutationError && (
            <p className="text-sm text-red-600">{mutationError}</p>
          )}
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
