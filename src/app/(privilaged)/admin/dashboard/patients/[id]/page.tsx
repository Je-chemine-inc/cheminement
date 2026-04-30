"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  ArrowLeft,
  Save,
  Trash2,
  Mail,
  RefreshCw,
  CheckCircle2,
  ShieldAlert,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import Link from "next/link";
import { useTranslations } from "next-intl";
import MedicalProfile from "@/components/dashboard/MedicalProfile";
import { IMedicalProfile } from "@/models/MedicalProfile";

export default function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const t = useTranslations("AdminDashboard.patientDetail");
  const tStatus = useTranslations("AdminDashboard.appointmentStatus");
  const { id } = use(params);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  
  // Feedback states
  const [feedback, setFeedback] = useState<{type: "success" | "error", message: string} | null>(null);
  
  // Modals / actions states
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    location: "",
    language: "fr",
    status: "active",
  });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [userRes, aptRes] = await Promise.all([
        fetch(`/api/admin/users/${id}`),
        fetch(`/api/admin/users/${id}/appointments`),
      ]);

      if (!userRes.ok) {
        const errorBody = await userRes.json().catch(() => ({}));
        throw new Error(errorBody.details || errorBody.error || `HTTP ${userRes.status}`);
      }
      const userData = await userRes.json();
      
      if (aptRes.ok) {
        const aptData = await aptRes.json();
        setAppointments(aptData.appointments || []);
      }

      setData(userData);
      setFormData({
        firstName: userData.user.firstName || "",
        lastName: userData.user.lastName || "",
        email: userData.user.email || "",
        phone: userData.user.phone || "",
        location: userData.user.location || "",
        language: userData.user.language || "fr",
        status: userData.user.status || "active",
      });
    } catch (error) {
      setFeedback({ type: "error", message: t("loadError") });
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error();

      setFeedback({ type: "success", message: t("updateSuccess") });
      setTimeout(() => setFeedback(null), 3000);
      fetchData();
    } catch {
      setFeedback({ type: "error", message: t("updateError") });
      setTimeout(() => setFeedback(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteConfirmName !== `${data?.user?.firstName} ${data?.user?.lastName}`) {
      setFeedback({ type: "error", message: t("deleteNameMismatch") });
      setTimeout(() => setFeedback(null), 3000);
      return;
    }

    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      router.push("/admin/dashboard/patients");
    } catch {
      setFeedback({ type: "error", message: t("deleteError") });
      setTimeout(() => setFeedback(null), 3000);
      setDeleting(false);
    }
  };

  const handleAction = async (actionUrl: string, actionName: string) => {
    setActionLoading(actionName);
    try {
      const res = await fetch(actionUrl, { method: "POST" });
      if (!res.ok) throw new Error();
      setFeedback({ type: "success", message: "Action exécutée avec succès." });
      setTimeout(() => setFeedback(null), 3000);
      fetchData(); // Refresh to update pastille
    } catch {
      setFeedback({ type: "error", message: "L'action a échoué." });
      setTimeout(() => setFeedback(null), 3000);
    } finally {
      setActionLoading(null);
    }
  };

  const handleOverrideStatus = async (appointmentId: string, status: string) => {
    try {
      const res = await fetch(`/api/admin/appointments/${appointmentId}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      setFeedback({ type: "success", message: "Statut de la séance mis à jour." });
      setTimeout(() => setFeedback(null), 3000);
      fetchData();
    } catch {
      setFeedback({ type: "error", message: "Impossible de modifier le statut." });
      setTimeout(() => setFeedback(null), 3000);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!data?.user && !feedback) return null;

  if (!data?.user && feedback) {
    return (
      <div className="space-y-6 max-w-5xl">
        <div className="flex items-center gap-4">
          <Link href="/admin/dashboard/patients">
            <Button variant="outline" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-3xl font-serif font-light text-foreground">
            {t("detailTitle")}
          </h1>
        </div>
        <div className="p-8 border rounded-xl bg-red-50 text-red-700 border-red-200">
          {feedback.message}
        </div>
      </div>
    );
  }

  const { user } = data;
  const isGreen = user.paymentGuaranteeStatus === "green";
  const isManual = user.paymentGuaranteeSource === "interac_trust";

  const getAdminStatusBadge = (color?: string, label?: string) => {
    const defaultColor = "bg-gray-100 text-gray-700";
    const defaultLabel = "Inconnu";

    const styles: Record<string, string> = {
      gray: "bg-gray-100 text-gray-600 border-gray-200",
      yellow: "bg-yellow-50 text-yellow-700 border-yellow-200",
      green: "bg-green-50 text-green-700 border-green-200",
      red: "bg-red-50 text-red-700 border-red-200",
    };

    const dotStyles: Record<string, string> = {
      gray: "bg-gray-400",
      yellow: "bg-yellow-500",
      green: "bg-green-500",
      red: "bg-red-500",
    };

    const style = color ? styles[color] : defaultColor;
    const dotStyle = color ? dotStyles[color] : "bg-gray-400";

    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border ml-4 ${style}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dotStyle}`} />
        {label || defaultLabel}
      </span>
    );
  };


  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-4">
        <Link href="/admin/dashboard/patients">
          <Button variant="outline" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-serif font-light text-foreground flex items-center">
            {user.firstName} {user.lastName}
            {getAdminStatusBadge(data.adminStatus?.color, data.adminStatus?.label)}
          </h1>
          <p className="text-muted-foreground font-light mt-1">
            Rejoint le {new Date(user.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>
      
      {feedback && (
        <div className={`p-4 rounded-md text-sm border ${feedback.type === 'success' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
          {feedback.message}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Col - Info */}
        <div className="col-span-1 md:col-span-2 space-y-6">
          <div className="bg-card border border-border/40 rounded-xl p-6">
            <h2 className="text-xl font-serif font-light mb-4">{t("basicInfo")}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("firstName")}</Label>
                <Input name="firstName" value={formData.firstName} onChange={handleChange} />
              </div>
              <div className="space-y-2">
                <Label>{t("lastName")}</Label>
                <Input name="lastName" value={formData.lastName} onChange={handleChange} />
              </div>
              <div className="space-y-2">
                <Label>{t("email")}</Label>
                <Input name="email" value={formData.email} onChange={handleChange} type="email" />
              </div>
              <div className="space-y-2">
                <Label>{t("phone")}</Label>
                <Input name="phone" value={formData.phone} onChange={handleChange} type="tel" />
              </div>
              <div className="space-y-2">
                <Label>{t("location")}</Label>
                <Input name="location" value={formData.location} onChange={handleChange} />
              </div>
              <div className="space-y-2">
                <Label>Langue Préférée</Label>
                <Select value={formData.language} onValueChange={(v) => handleSelectChange("language", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fr">Français</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("accountStatus")}</Label>
                <Select value={formData.status} onValueChange={(v) => handleSelectChange("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{t("statusActive")}</SelectItem>
                    <SelectItem value="pending">{t("statusPending")}</SelectItem>
                    <SelectItem value="inactive">{t("statusInactive")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <Button onClick={handleSave} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t("saveChanges")}
              </Button>
            </div>
          </div>

          <div className="bg-card border border-border/40 rounded-xl p-6">
            <h2 className="text-xl font-serif font-light mb-4 flex items-center gap-2">
              Profil Médical
            </h2>
            {data.medicalProfile ? (
              <MedicalProfile 
                profile={data.medicalProfile} 
                isEditable={true} 
                userId={id} 
                onSaveOverride={async (profileData) => {
                  try {
                    const res = await fetch(`/api/admin/users/${id}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(profileData),
                    });
                    if (!res.ok) throw new Error();
                    setFeedback({ type: "success", message: "Profil médical mis à jour avec succès." });
                    setTimeout(() => setFeedback(null), 3000);
                    fetchData();
                    return null;
                  } catch (e) {
                    setFeedback({ type: "error", message: "Impossible de mettre à jour le profil médical." });
                    setTimeout(() => setFeedback(null), 3000);
                    return null;
                  }
                }} 
              />
            ) : (
                <p className="text-muted-foreground text-sm font-light">Le profil médical de ce patient n'a pas encore été créé.</p>
            )}
          </div>

          <div className="bg-card border border-border/40 rounded-xl p-6">
            <h2 className="text-xl font-serif font-light mb-4 flex items-center gap-2">
              <Calendar className="h-5 w-5" /> {t("clinicalTracking")}
            </h2>
            {appointments.length === 0 ? (
              <p className="text-muted-foreground text-sm font-light py-4 text-center">{t("noSessions")}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("colDate")}</TableHead>
                      <TableHead>{t("colPro")}</TableHead>
                      <TableHead>{t("colStatus")}</TableHead>
                      <TableHead>{t("colAction")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {appointments.map((apt) => (
                      <TableRow key={apt.id}>
                        <TableCell className="text-sm">
                          {apt.date ? new Date(apt.date).toLocaleDateString("fr-CA") : "—"}<br />
                          {apt.time || "—"} ({apt.duration}min)
                        </TableCell>
                        <TableCell className="text-sm">
                          {apt.professional ? apt.professional.name : "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {tStatus(apt.status)}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={apt.status}
                            onValueChange={(v) => handleOverrideStatus(apt.id, v)}
                          >
                            <SelectTrigger className="h-8 w-32 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="scheduled">{tStatus("scheduled")}</SelectItem>
                              <SelectItem value="completed">{tStatus("completed")}</SelectItem>
                              <SelectItem value="cancelled">{tStatus("cancelled")}</SelectItem>
                              <SelectItem value="no-show">{tStatus("noShow")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>

        {/* Right Col - Actions */}
        <div className="space-y-6">
          <div className="bg-card border border-border/40 rounded-xl p-6">
            <h2 className="text-lg font-serif font-light mb-4">{t("guaranteeActions")}</h2>
            <div className="space-y-3">
              <div className="p-3 bg-muted/50 rounded-lg text-sm mb-2 flex items-center justify-between">
                <strong>{t("statusLabel")}</strong>
                {getAdminStatusBadge(data.adminStatus?.color, data.adminStatus?.label)}
              </div>

              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() => handleAction(`/api/admin/users/${id}/resend-invite`, "invite")}
                disabled={actionLoading !== null}
              >
                {actionLoading === "invite" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4 text-muted-foreground" />}
                {t("resendInvite")}
              </Button>

              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() => handleAction(`/api/admin/users/${id}/resend-guarantee`, "guarantee")}
                disabled={actionLoading !== null}
              >
                {actionLoading === "guarantee" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 text-orange-500" />}
                {t("resendGuarantee")}
              </Button>

              {!isGreen && (
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 border-blue-200 hover:bg-blue-50 text-blue-700"
                  onClick={() => handleAction(`/api/admin/users/${id}/approve-guarantee`, "approve")}
                  disabled={actionLoading !== null}
                >
                  {actionLoading === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {t("approveGuarantee")}
                </Button>
              )}
            </div>
          </div>

          <div className="bg-red-50 dark:bg-red-950/10 border border-red-200 dark:border-red-900 rounded-xl p-6">
            <h2 className="text-lg font-serif font-light mb-2 text-red-600 dark:text-red-400 flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" /> {t("dangerZone")}
            </h2>
            <p className="text-sm font-light mb-4 text-red-800/80 dark:text-red-200/80">
              {t("deleteWarning")}
            </p>
            <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive" className="w-full gap-2">
                  <Trash2 className="h-4 w-4" />
                  {t("deleteConfirm")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("deleteConfirmTitle")}</DialogTitle>
                  <DialogDescription dangerouslySetInnerHTML={{ __html: t.raw("deleteConfirmDesc").replace("{name}", `${user.firstName} ${user.lastName}`) }}>
                  </DialogDescription>
                </DialogHeader>
                <Input
                  value={deleteConfirmName}
                  onChange={(e) => setDeleteConfirmName(e.target.value)}
                  placeholder={t("typeFullNamePlaceholder")}
                />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>{t("cancel")}</Button>
                  <Button variant="destructive" onClick={handleDelete} disabled={deleting || deleteConfirmName !== `${user.firstName} ${user.lastName}`}>
                    {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : t("confirm")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>
    </div>
  );
}
