"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Search,
  Filter,
  UserPlus,
  MoreVertical,
  Shield,
  AlertCircle,
  RefreshCw,
  Crown,
  Settings,
  Users,
  Wallet,
  Loader2,
  UserMinus,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { IUser } from "@/models/User";

type AdminRole =
  | "super_admin"
  | "platform_admin"
  | "content_admin"
  | "support_admin"
  | "billing_admin";

interface AdminPermissions {
  manageUsers: boolean;
  manageProfessionals: boolean;
  managePatients: boolean;
  approveProfessionals: boolean;
  manageContent: boolean;
  viewAnalytics: boolean;
  manageReports: boolean;
  manageBilling: boolean;
  manageAdmins: boolean;
  createAdmins: boolean;
  deleteAdmins: boolean;
  manageSettings: boolean;
  managePlatform: boolean;
}

interface AdminUser {
  id: string;
  userId: string;
  role: AdminRole;
  permissions: AdminPermissions;
  user: {
    firstName: string;
    lastName: string;
    email: string;
    createdAt: string;
  };
  createdBy: {
    firstName: string;
    lastName: string;
  } | null;
  createdAt: string;
  lastLogin?: string;
}

interface AdminData {
  admins: AdminUser[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

interface RoleInfo {
  role: AdminRole;
  name: string;
  description: string;
  permissions: AdminPermissions;
}

interface CurrentAdmin {
  id: string;
  userId: string;
  role: AdminRole;
  permissions: AdminPermissions;
}

const PERMISSION_KEYS: (keyof AdminPermissions)[] = [
  "manageUsers",
  "manageProfessionals",
  "managePatients",
  "approveProfessionals",
  "manageContent",
  "viewAnalytics",
  "manageReports",
  "manageBilling",
  "manageAdmins",
  "createAdmins",
  "deleteAdmins",
  "manageSettings",
  "managePlatform",
];

const getRoleIcon = (role: AdminRole) => {
  switch (role) {
    case "super_admin":
      return <Crown className="h-4 w-4" />;
    case "platform_admin":
      return <Shield className="h-4 w-4" />;
    case "content_admin":
      return <Settings className="h-4 w-4" />;
    case "support_admin":
      return <Users className="h-4 w-4" />;
    case "billing_admin":
      return <Wallet className="h-4 w-4" />;
  }
};

const getRoleBadgeColor = (role: AdminRole) => {
  switch (role) {
    case "super_admin":
      return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400";
    case "platform_admin":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
    case "content_admin":
      return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
    case "support_admin":
      return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400";
    case "billing_admin":
      return "bg-teal-100 text-teal-800 dark:bg-teal-950/40 dark:text-teal-200";
  }
};

export default function AdminsPage() {
  const t = useTranslations("AdminDashboard.admins");
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [availableRoles, setAvailableRoles] = useState<RoleInfo[]>([]);
  const [currentAdmin, setCurrentAdmin] = useState<CurrentAdmin | null>(null);

  const [permissionsTarget, setPermissionsTarget] = useState<AdminUser | null>(
    null,
  );
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [demoteTarget, setDemoteTarget] = useState<AdminUser | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<AdminUser | null>(
    null,
  );

  const fetchAdmins = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        page: "1",
        limit: "20",
        search: searchQuery,
        role: roleFilter,
      });
      const response = await fetch(`/api/admin/admins?${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch admins");
      }
      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [searchQuery, roleFilter]);

  const fetchRoles = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/roles");
      if (response.ok) {
        const result = await response.json();
        setAvailableRoles(result.roles);
      }
    } catch (err) {
      console.error("Failed to fetch roles:", err);
    }
  }, []);

  const fetchCurrentAdmin = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/me");
      if (response.ok) {
        const result = await response.json();
        setCurrentAdmin(result);
      }
    } catch (err) {
      console.error("Failed to fetch current admin:", err);
    }
  }, []);

  useEffect(() => {
    fetchAdmins();
    fetchRoles();
    fetchCurrentAdmin();
  }, [fetchAdmins, fetchRoles, fetchCurrentAdmin]);

  const admins = data?.admins || [];

  // Hierarchy: can the current admin act on this target?
  const canActOn = useCallback(
    (target: AdminUser): boolean => {
      if (!currentAdmin) return false;
      // Cannot act on self via this UI
      if (target.id === currentAdmin.id) return false;
      // Only super_admin can act on another super_admin
      if (
        target.role === "super_admin" &&
        currentAdmin.role !== "super_admin"
      ) {
        return false;
      }
      return true;
    },
    [currentAdmin],
  );

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
                onClick={fetchAdmins}
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
          <button
            onClick={fetchAdmins}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/90 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <UserPlus className="h-4 w-4" />
                {t("promoteToAdmin")}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{t("dialogTitle")}</DialogTitle>
                <DialogDescription>
                  {t("dialogDesc")}
                </DialogDescription>
              </DialogHeader>
              <CreateAdminForm
                roles={availableRoles}
                currentAdmin={currentAdmin}
                onSuccess={() => {
                  setShowCreateDialog(false);
                  fetchAdmins();
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-4">
        <div className="rounded-xl bg-card p-6 border border-border/40">
          <p className="text-sm font-light text-muted-foreground">
            {t("totalAdmins")}
          </p>
          <p className="text-2xl font-serif font-light text-foreground mt-2">
            {data?.pagination.total || 0}
          </p>
        </div>
        <div className="rounded-xl bg-card p-6 border border-border/40">
          <p className="text-sm font-light text-muted-foreground">
            {t("superAdmins")}
          </p>
          <p className="text-2xl font-serif font-light text-foreground mt-2">
            {admins.filter((a) => a.role === "super_admin").length}
          </p>
        </div>
        <div className="rounded-xl bg-card p-6 border border-border/40">
          <p className="text-sm font-light text-muted-foreground">
            {t("platformAdmins")}
          </p>
          <p className="text-2xl font-serif font-light text-foreground mt-2">
            {admins.filter((a) => a.role === "platform_admin").length}
          </p>
        </div>
        <div className="rounded-xl bg-card p-6 border border-border/40">
          <p className="text-sm font-light text-muted-foreground">
            {t("activeToday")}
          </p>
          <p className="text-2xl font-serif font-light text-foreground mt-2">
            {
              admins.filter((a) => {
                if (!a.lastLogin) return false;
                const today = new Date();
                const lastLogin = new Date(a.lastLogin);
                return lastLogin.toDateString() === today.toDateString();
              }).length
            }
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
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-[180px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder={t("filterRole")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allRoles")}</SelectItem>
                  <SelectItem value="super_admin">{t("superAdmin")}</SelectItem>
                  <SelectItem value="platform_admin">{t("platformAdmin")}</SelectItem>
                  <SelectItem value="content_admin">{t("contentAdmin")}</SelectItem>
                  <SelectItem value="support_admin">{t("supportAdmin")}</SelectItem>
                  <SelectItem value="billing_admin">{t("billingAdmin")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left p-4 text-sm font-light text-muted-foreground">
                  {t("colAdmin")}
                </th>
                <th className="text-left p-4 text-sm font-light text-muted-foreground">
                  {t("colRole")}
                </th>
                <th className="text-left p-4 text-sm font-light text-muted-foreground">
                  {t("colCreatedBy")}
                </th>
                <th className="text-left p-4 text-sm font-light text-muted-foreground">
                  {t("colLastLogin")}
                </th>
                <th className="text-left p-4 text-sm font-light text-muted-foreground">
                  {t("colCreated")}
                </th>
                <th className="text-right p-4 text-sm font-light text-muted-foreground">
                  {t("colActions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {admins.map((admin) => {
                const isSelf =
                  currentAdmin !== null && admin.id === currentAdmin.id;
                const actAllowed = canActOn(admin);
                return (
                  <tr
                    key={admin.id}
                    className="border-t border-border/40 hover:bg-muted/20 transition-colors"
                  >
                    <td className="p-4">
                      <div>
                        <p className="font-light text-foreground">
                          {admin.user.firstName} {admin.user.lastName}
                          {isSelf ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              ({t("youLabel")})
                            </span>
                          ) : null}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {admin.user.email}
                        </p>
                      </div>
                    </td>
                    <td className="p-4">
                      <Badge
                        className={`inline-flex items-center gap-1 ${getRoleBadgeColor(admin.role)}`}
                      >
                        {getRoleIcon(admin.role)}
                        {admin.role.replace("_", " ").toUpperCase()}
                      </Badge>
                    </td>
                    <td className="p-4 text-sm font-light text-muted-foreground">
                      {admin.createdBy
                        ? `${admin.createdBy.firstName} ${admin.createdBy.lastName}`
                        : t("system")}
                    </td>
                    <td className="p-4 text-sm font-light text-muted-foreground">
                      {admin.lastLogin
                        ? new Date(admin.lastLogin).toLocaleDateString()
                        : t("never")}
                    </td>
                    <td className="p-4 text-sm font-light text-muted-foreground">
                      {new Date(admin.createdAt).toLocaleDateString()}
                    </td>
                    <td className="p-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => setPermissionsTarget(admin)}
                          >
                            {t("viewPermissions")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!actAllowed}
                            onClick={() => actAllowed && setEditTarget(admin)}
                          >
                            {t("editRole")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={!actAllowed}
                            onClick={() => actAllowed && setDemoteTarget(admin)}
                          >
                            <UserMinus className="h-4 w-4 mr-2" />
                            {t("demoteToEmployee")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!actAllowed}
                            onClick={() =>
                              actAllowed && setDeactivateTarget(admin)
                            }
                            className="text-destructive focus:text-destructive"
                          >
                            {t("deactivate")}
                          </DropdownMenuItem>
                          {!actAllowed && !isSelf ? (
                            <div className="px-2 py-1.5 text-[11px] text-muted-foreground border-t mt-1">
                              {t("hierarchyBlocked")}
                            </div>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {admins.length === 0 && (
            <div className="p-12 text-center">
              <Shield className="h-12 w-12 mx-auto mb-4 opacity-50 text-muted-foreground" />
              <p className="text-muted-foreground">{t("noAdmins")}</p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                {t("noAdminsDesc")}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* View Permissions dialog */}
      <Dialog
        open={permissionsTarget !== null}
        onOpenChange={(open) => !open && setPermissionsTarget(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("viewPermissionsTitle")}</DialogTitle>
            <DialogDescription>
              {permissionsTarget
                ? `${permissionsTarget.user.firstName} ${permissionsTarget.user.lastName} — ${permissionsTarget.role
                    .replace("_", " ")
                    .toUpperCase()}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[60vh] overflow-y-auto">
            {permissionsTarget &&
              PERMISSION_KEYS.map((key) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-md border border-border/40 px-3 py-2 text-sm"
                >
                  <span className="text-foreground">{t(`perm.${key}`)}</span>
                  <span
                    className={
                      permissionsTarget.permissions[key]
                        ? "text-green-600 dark:text-green-400 font-medium"
                        : "text-muted-foreground"
                    }
                  >
                    {permissionsTarget.permissions[key]
                      ? t("permYes")
                      : t("permNo")}
                  </span>
                </div>
              ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Role / Permissions dialog */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => !open && setEditTarget(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("editRoleTitle")}</DialogTitle>
            <DialogDescription>
              {editTarget
                ? `${editTarget.user.firstName} ${editTarget.user.lastName} — ${editTarget.user.email}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {editTarget && currentAdmin ? (
            <EditAdminForm
              admin={editTarget}
              roles={availableRoles}
              currentAdmin={currentAdmin}
              onSuccess={() => {
                setEditTarget(null);
                fetchAdmins();
              }}
              onCancel={() => setEditTarget(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Demote-to-employee confirmation dialog */}
      <Dialog
        open={demoteTarget !== null}
        onOpenChange={(open) => !open && setDemoteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("demoteTitle")}</DialogTitle>
            <DialogDescription>
              {demoteTarget
                ? t("demoteDesc", {
                    name: `${demoteTarget.user.firstName} ${demoteTarget.user.lastName}`,
                  })
                : ""}
            </DialogDescription>
          </DialogHeader>
          {demoteTarget ? (
            <ConfirmAction
              endpoint={`/api/admin/admins/${demoteTarget.id}/demote`}
              method="POST"
              confirmLabel={t("confirmDemote")}
              cancelLabel={t("cancel")}
              onSuccess={() => {
                setDemoteTarget(null);
                fetchAdmins();
              }}
              onCancel={() => setDemoteTarget(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Deactivate confirmation dialog */}
      <Dialog
        open={deactivateTarget !== null}
        onOpenChange={(open) => !open && setDeactivateTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deactivateTitle")}</DialogTitle>
            <DialogDescription>
              {deactivateTarget
                ? t("deactivateDesc", {
                    name: `${deactivateTarget.user.firstName} ${deactivateTarget.user.lastName}`,
                  })
                : ""}
            </DialogDescription>
          </DialogHeader>
          {deactivateTarget ? (
            <ConfirmAction
              endpoint={`/api/admin/admins/${deactivateTarget.id}`}
              method="DELETE"
              destructive
              confirmLabel={t("confirmDeactivate")}
              cancelLabel={t("cancel")}
              onSuccess={() => {
                setDeactivateTarget(null);
                fetchAdmins();
              }}
              onCancel={() => setDeactivateTarget(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConfirmAction({
  endpoint,
  method,
  confirmLabel,
  cancelLabel,
  destructive,
  onSuccess,
  onCancel,
}: {
  endpoint: string;
  method: "POST" | "DELETE";
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Request failed");
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={submitting}
        >
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant={destructive ? "destructive" : "default"}
          onClick={handleConfirm}
          disabled={submitting}
          className="gap-2"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

function EditAdminForm({
  admin,
  roles,
  currentAdmin,
  onSuccess,
  onCancel,
}: {
  admin: AdminUser;
  roles: RoleInfo[];
  currentAdmin: CurrentAdmin;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("AdminDashboard.admins");
  const [role, setRole] = useState<AdminRole>(admin.role);
  const [permissions, setPermissions] = useState<AdminPermissions>(
    admin.permissions,
  );
  const [usePreset, setUsePreset] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only super_admin can assign the super_admin role
  const canAssignSuper = currentAdmin.role === "super_admin";
  const selectableRoles = roles.filter(
    (r) => r.role !== "super_admin" || canAssignSuper,
  );

  const handleRoleChange = (newRole: AdminRole) => {
    setRole(newRole);
    if (usePreset) {
      const preset = roles.find((r) => r.role === newRole)?.permissions;
      if (preset) {
        setPermissions(preset);
      }
    }
  };

  const togglePermission = (key: keyof AdminPermissions) => {
    setUsePreset(false);
    setPermissions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/admins/${admin.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          permissions: usePreset ? undefined : permissions,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Update failed");
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{t("adminRole")}</Label>
        <Select
          value={role}
          onValueChange={(v) => handleRoleChange(v as AdminRole)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {selectableRoles.map((r) => (
              <SelectItem key={r.role} value={r.role}>
                <div className="flex items-center gap-2">
                  {getRoleIcon(r.role)}
                  <span>{r.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {roles.find((r) => r.role === role)?.description}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>{t("permissionsLabel")}</Label>
          <button
            type="button"
            onClick={() => {
              const preset = roles.find((r) => r.role === role)?.permissions;
              if (preset) {
                setPermissions(preset);
                setUsePreset(true);
              }
            }}
            className="text-xs text-primary hover:underline"
          >
            {t("resetToPreset")}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[40vh] overflow-y-auto rounded-md border border-border/40 p-3">
          {PERMISSION_KEYS.map((key) => (
            <label
              key={key}
              className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/30 rounded px-2 py-1.5"
            >
              <input
                type="checkbox"
                checked={permissions[key]}
                onChange={() => togglePermission(key)}
                className="h-4 w-4 rounded border-border"
              />
              <span>{t(`perm.${key}`)}</span>
            </label>
          ))}
        </div>
        {!usePreset ? (
          <p className="text-xs text-amber-600 dark:text-amber-500">
            {t("customPermissionsNote")}
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={submitting}
        >
          {t("cancel")}
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="gap-2"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t("save")}
        </Button>
      </DialogFooter>
    </div>
  );
}

function CreateAdminForm({
  roles,
  currentAdmin,
  onSuccess,
}: {
  roles: RoleInfo[];
  currentAdmin: CurrentAdmin | null;
  onSuccess: () => void;
}) {
  const t = useTranslations("AdminDashboard.admins");
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedRole, setSelectedRole] = useState<AdminRole>("support_admin");
  const [availableUsers, setAvailableUsers] = useState<IUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Only super_admin can promote directly to super_admin
  const canAssignSuper = currentAdmin?.role === "super_admin";
  const selectableRoles = roles.filter(
    (r) => r.role !== "super_admin" || canAssignSuper,
  );

  // Fetch available users (non-admin users)
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await fetch("/api/admin/admins/clients");
        if (response.ok) {
          const data = await response.json();
          setAvailableUsers(data.clients);
        }
      } catch (err) {
        console.error("Failed to fetch users:", err);
      }
    };
    fetchUsers();
  }, []);

  const filteredUsers = availableUsers.filter(
    (user) =>
      `${user.firstName} ${user.lastName}`
        .toLowerCase()
        .includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId) {
      setError("Please select a user to promote to admin");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedUserId,
          role: selectedRole,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to promote user to admin");
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="text-sm font-medium mb-2 block">
          {t("selectUser")}
        </label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("searchUsers")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="mt-2 max-h-48 overflow-y-auto border rounded-md">
          {filteredUsers.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              {t("noUsers")}
            </div>
          ) : (
            filteredUsers.map((user) => (
              <div
                key={user._id.toString()}
                onClick={() => setSelectedUserId(user._id.toString())}
                className={`p-3 cursor-pointer hover:bg-muted/50 border-b last:border-b-0 ${
                  selectedUserId === user._id.toString()
                    ? "bg-primary/10 border-primary"
                    : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                    <span className="text-sm font-medium text-primary">
                      {user.firstName[0]}
                      {user.lastName[0]}
                    </span>
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">
                      {user.firstName} {user.lastName}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      {t("employeeBadge")}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium mb-2 block">{t("adminRole")}</label>
        <Select
          value={selectedRole}
          onValueChange={(value) => setSelectedRole(value as AdminRole)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {selectableRoles.map((role) => (
              <SelectItem key={role.role} value={role.role}>
                <div className="flex items-center gap-2">
                  {getRoleIcon(role.role)}
                  <span>{role.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          {roles.find((r) => r.role === selectedRole)?.description}
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <Button
          type="submit"
          disabled={loading || !selectedUserId}
          className="flex-1"
        >
          {loading ? t("promoting") : t("promoteToAdmin")}
        </Button>
      </div>
    </form>
  );
}
