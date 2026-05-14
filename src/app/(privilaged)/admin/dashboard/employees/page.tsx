"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Upload,
  FileText,
  Shield,
  UserPlus,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface EmployeeRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  address?: string;
  dateOfBirth?: string | null;
  diploma?: string;
  experience?: string;
  cvDocumentUrl?: string;
  cvDocumentName?: string;
  status: "active" | "pending" | "inactive";
  isAdmin: boolean;
  createdAt: string;
}

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  dateOfBirth: string;
  diploma: string;
  experience: string;
  cvDocumentUrl: string;
  cvDocumentName: string;
  password: string;
}

const emptyForm: FormState = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  address: "",
  dateOfBirth: "",
  diploma: "",
  experience: "",
  cvDocumentUrl: "",
  cvDocumentName: "",
  password: "",
};

export default function AdminEmployeesPage() {
  const t = useTranslations("AdminEmployees");

  const [employees, setEmployees] = useState<EmployeeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EmployeeRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/employees", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Failed to load");
      }
      const data = await res.json();
      setEmployees(data.employees ?? []);
      setError(null);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setSaveError(null);
    setFormOpen(true);
  };

  const openEdit = (row: EmployeeRow) => {
    setEditingId(row.id);
    setForm({
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phone: row.phone ?? "",
      address: row.address ?? "",
      dateOfBirth: row.dateOfBirth
        ? new Date(row.dateOfBirth).toISOString().slice(0, 10)
        : "",
      diploma: row.diploma ?? "",
      experience: row.experience ?? "",
      cvDocumentUrl: row.cvDocumentUrl ?? "",
      cvDocumentName: row.cvDocumentName ?? "",
      password: "",
    });
    setSaveError(null);
    setFormOpen(true);
  };

  const updateField = <K extends keyof FormState>(
    key: K,
    value: FormState[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleCvUpload = async (file: File) => {
    setUploading(true);
    setSaveError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/employee-cv", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Upload failed");
      }
      const data = await res.json();
      setForm((prev) => ({
        ...prev,
        cvDocumentUrl: data.url,
        cvDocumentName: data.fileName,
      }));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const url = editingId
        ? `/api/admin/employees/${editingId}`
        : "/api/admin/employees";
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Save failed");
      }
      setFormOpen(false);
      setForm(emptyForm);
      setEditingId(null);
      await load();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/employees/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Delete failed");
      }
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-light text-foreground">
            {t("title")}
          </h1>
          <p className="mt-2 text-muted-foreground font-light max-w-3xl">
            {t("subtitle")}
          </p>
        </div>
        <Button type="button" onClick={openCreate} className="gap-2">
          <UserPlus className="h-4 w-4" />
          {t("newEmployee")}
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="rounded-xl border border-border/40 bg-card overflow-x-auto">
        {!employees ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : employees.length === 0 ? (
          <p className="py-12 text-center text-muted-foreground text-sm">
            {t("empty")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colName")}</TableHead>
                <TableHead>{t("colEmail")}</TableHead>
                <TableHead>{t("colPhone")}</TableHead>
                <TableHead>{t("colDiploma")}</TableHead>
                <TableHead>{t("colCv")}</TableHead>
                <TableHead>{t("colStatus")}</TableHead>
                <TableHead className="text-right">{t("colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((emp) => (
                <TableRow key={emp.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {emp.firstName} {emp.lastName}
                      </span>
                      {emp.isAdmin ? (
                        <span
                          title={t("isAdminHint")}
                          className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary uppercase tracking-wider"
                        >
                          <Shield className="h-3 w-3" />
                          {t("isAdminBadge")}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{emp.email}</TableCell>
                  <TableCell className="text-sm">{emp.phone || "—"}</TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate">
                    {emp.diploma || "—"}
                  </TableCell>
                  <TableCell>
                    {emp.cvDocumentUrl ? (
                      <a
                        href={emp.cvDocumentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        {t("viewCv")}
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${
                        emp.status === "active"
                          ? "bg-green-50 text-green-700"
                          : emp.status === "pending"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {t(`status_${emp.status}`)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2"
                        onClick={() => openEdit(emp)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(emp)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={(open) => !saving && setFormOpen(open)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingId ? t("editTitle") : t("createTitle")}
            </DialogTitle>
            <DialogDescription>
              {editingId ? t("editDescription") : t("createDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>{t("firstName")} *</Label>
                <Input
                  value={form.firstName}
                  onChange={(e) => updateField("firstName", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>{t("lastName")} *</Label>
                <Input
                  value={form.lastName}
                  onChange={(e) => updateField("lastName", e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>{t("email")} *</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>{t("phone")}</Label>
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => updateField("phone", e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>{t("address")}</Label>
              <Input
                value={form.address}
                onChange={(e) => updateField("address", e.target.value)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>{t("dateOfBirth")}</Label>
                <Input
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(e) => updateField("dateOfBirth", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>{t("diploma")}</Label>
                <Input
                  value={form.diploma}
                  onChange={(e) => updateField("diploma", e.target.value)}
                  placeholder={t("diplomaPlaceholder")}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>{t("experience")}</Label>
              <Textarea
                value={form.experience}
                onChange={(e) => updateField("experience", e.target.value)}
                placeholder={t("experiencePlaceholder")}
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("cvDocument")}</Label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="employee-cv-input"
                  type="file"
                  accept=".pdf,.doc,.docx,image/jpeg,image/png"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleCvUpload(file);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  disabled={uploading}
                  onClick={() =>
                    document.getElementById("employee-cv-input")?.click()
                  }
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {form.cvDocumentUrl ? t("replaceCv") : t("uploadCv")}
                </Button>
                {form.cvDocumentUrl ? (
                  <a
                    href={form.cvDocumentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                  >
                    <FileText className="h-4 w-4" />
                    {form.cvDocumentName || t("viewCv")}
                  </a>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">{t("cvHint")}</p>
            </div>

            <div className="space-y-1">
              <Label>{t("password")}</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => updateField("password", e.target.value)}
                placeholder={
                  editingId ? t("passwordHintEdit") : t("passwordHintCreate")
                }
                minLength={8}
              />
              <p className="text-xs text-muted-foreground">
                {editingId ? t("passwordEditNote") : t("passwordCreateNote")}
              </p>
            </div>
          </div>

          {saveError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {saveError}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setFormOpen(false)}
              disabled={saving}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={
                saving ||
                !form.firstName.trim() ||
                !form.lastName.trim() ||
                !form.email.trim()
              }
              className="gap-2"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : editingId ? (
                <Pencil className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {editingId ? t("save") : t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !deleting && !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteDescription", {
                name: deleteTarget
                  ? `${deleteTarget.firstName} ${deleteTarget.lastName}`
                  : "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-1" />
              )}
              {t("confirmDelete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
