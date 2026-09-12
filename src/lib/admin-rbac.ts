import type { IAdminPermissions } from "@/models/Admin";
import Admin from "@/models/Admin";
import connectToDatabase from "@/lib/mongodb";
import { maskPhoneForDisplay } from "@/lib/contact-mask";
import { NO_ADMIN_UI_PERMISSIONS, type AdminUiPermissions } from "@/lib/admin-nav";

/**
 * Moindre privilège : masquer le téléphone si l’admin gère la facturation mais pas les dossiers patients.
 */
export function mustMaskClientContactPII(
  permissions: IAdminPermissions | null | undefined,
): boolean {
  if (!permissions) return false;
  return (
    permissions.manageBilling === true && permissions.managePatients !== true
  );
}

export async function getActiveAdminPermissions(
  sessionUserId: string,
): Promise<IAdminPermissions | null> {
  const admin = await Admin.findOne({
    userId: sessionUserId,
    isActive: true,
  })
    .select("permissions")
    .lean();
  return admin?.permissions ?? null;
}

/**
 * What the admin screens may show this admin, for the menu and the pages. The
 * same rules as `requireBillingAdmin` and `requireProfessionalsAdmin`, so the
 * menu never offers a screen the API refuses. Only the display: every route
 * still checks for itself. Never throws; anything unexpected hides.
 */
export async function getAdminUiPermissions(
  user: { id?: string | null; isAdmin?: boolean | null } | null | undefined,
): Promise<AdminUiPermissions> {
  if (!user?.id || !user.isAdmin) return { ...NO_ADMIN_UI_PERMISSIONS };
  try {
    await connectToDatabase();
    const permissions = await getActiveAdminPermissions(user.id);
    return {
      manageBilling: permissions?.manageBilling === true,
      manageProfessionals: permissions?.manageProfessionals === true,
    };
  } catch (e) {
    console.error("[admin-rbac] could not read the admin's permissions:", e);
    return { ...NO_ADMIN_UI_PERMISSIONS };
  }
}

export function applyClientContactMaskToUserPayload<
  T extends { phone?: string },
>(payload: T, mask: boolean): T {
  if (!mask || !payload.phone) {
    return payload;
  }
  return {
    ...payload,
    phone: maskPhoneForDisplay(payload.phone),
  };
}

export function applyMedicalProfileContactMask<T extends Record<string, unknown>>(
  payload: T,
  mask: boolean,
): T {
  if (!mask) return payload;
  const next = { ...payload } as Record<string, unknown>;
  if (typeof next.emergencyContactPhone === "string" && next.emergencyContactPhone) {
    next.emergencyContactPhone = maskPhoneForDisplay(
      next.emergencyContactPhone,
    );
  }
  if (typeof next.location === "string" && next.location) {
    next.location = "—";
  }
  return next as T;
}
