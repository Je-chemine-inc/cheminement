/**
 * Which admin screens this admin may see. Client-safe (no model imports): the
 * sidebar is a client component. The value comes from the admin layout, which
 * reads it on the server with `getAdminUiPermissions` (lib/admin-rbac.ts).
 *
 * Display only. Every route checks the permission for itself.
 */
export type AdminUiPermissions = {
  /** « Facturation et paiements », « Comptabilité & cycles », organizations. */
  manageBilling: boolean;
  /** « Pages vitrines » (spec 003): who the public sees, and what. */
  manageProfessionals: boolean;
};

export const NO_ADMIN_UI_PERMISSIONS: AdminUiPermissions = {
  manageBilling: false,
  manageProfessionals: false,
};

type NavItem = { requires?: keyof AdminUiPermissions };

/**
 * The menu without the entries this admin lacks the right for, and without a
 * section left empty by that.
 */
export function visibleNavSections<I extends NavItem, S extends { items: I[] }>(
  sections: S[],
  permissions: AdminUiPermissions,
): S[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.requires || permissions[item.requires] === true),
    }))
    .filter((section) => section.items.length > 0);
}
