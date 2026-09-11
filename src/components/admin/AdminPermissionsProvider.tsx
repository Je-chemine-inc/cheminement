"use client";

import { createContext, useContext } from "react";
import { NO_ADMIN_UI_PERMISSIONS, type AdminUiPermissions } from "@/lib/admin-nav";

/**
 * The signed-in admin's permissions, read once by the admin layout on the
 * server. Display only; outside the provider nothing is granted.
 */
const AdminPermissionsContext = createContext<AdminUiPermissions>(NO_ADMIN_UI_PERMISSIONS);

export function AdminPermissionsProvider({
  permissions,
  children,
}: {
  permissions: AdminUiPermissions;
  children: React.ReactNode;
}) {
  return (
    <AdminPermissionsContext.Provider value={permissions}>{children}</AdminPermissionsContext.Provider>
  );
}

export function useAdminPermissions(): AdminUiPermissions {
  return useContext(AdminPermissionsContext);
}
