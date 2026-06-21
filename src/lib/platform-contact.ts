import "server-only";
import connectToDatabase from "@/lib/mongodb";
import PlatformSettings, {
  DEFAULT_SOCIAL_LINKS,
  DEFAULT_PARTNERS,
  type ISocialLinks,
  type IPartner,
} from "@/models/PlatformSettings";

export type PlatformPhysicalAddress = {
  street: string;
  suite: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
};

export type PlatformContactInfo = {
  physicalAddress: PlatformPhysicalAddress;
  phoneNumber: string;
  supportEmail: string;
  interacDepositEmail: string;
  companyName: string;
};

const EMPTY_ADDRESS: PlatformPhysicalAddress = {
  street: "",
  suite: "",
  city: "",
  province: "",
  postalCode: "",
  country: "",
};

/**
 * Loads the admin-configured platform coordinates used on fiscal receipts and
 * other compliance surfaces. Returns empty strings (never undefined) so the
 * caller can render unconditionally; a server warning is logged when the
 * mandatory phone/address fields are missing so admins get visibility.
 *
 * Backward-compatibility: legacy installations where `physicalAddress` was
 * stored as a free-text string are normalized into the structured shape with
 * the legacy value placed in `street`.
 */
export async function getPlatformContactInfo(): Promise<PlatformContactInfo> {
  await connectToDatabase();
  const settings = await PlatformSettings.findOne().lean();

  const rawAddress = settings?.platformContact?.physicalAddress as unknown;
  let physicalAddress: PlatformPhysicalAddress = { ...EMPTY_ADDRESS };
  if (typeof rawAddress === "string") {
    physicalAddress = { ...EMPTY_ADDRESS, street: rawAddress.trim() };
  } else if (rawAddress && typeof rawAddress === "object") {
    const a = rawAddress as Partial<PlatformPhysicalAddress>;
    physicalAddress = {
      street: a.street?.trim() ?? "",
      suite: a.suite?.trim() ?? "",
      city: a.city?.trim() ?? "",
      province: a.province?.trim() ?? "",
      postalCode: a.postalCode?.trim() ?? "",
      country: a.country?.trim() ?? "",
    };
  }

  const phoneNumber = settings?.platformContact?.phoneNumber?.trim() ?? "";
  const supportEmail = settings?.platformContact?.supportEmail?.trim() ?? "";
  const interacDepositEmail = settings?.interacDepositEmail?.trim() ?? "";
  const companyName =
    settings?.emailSettings?.branding?.companyName?.trim() ?? "";

  const hasAnyAddress = Boolean(
    physicalAddress.street ||
      physicalAddress.city ||
      physicalAddress.postalCode,
  );
  if (!hasAnyAddress || !phoneNumber) {
    console.warn(
      "[platform-contact] Missing mandatory coordinates for receipts " +
        `(hasAddress=${hasAnyAddress}, hasPhone=${!!phoneNumber}). ` +
        "Set them in Admin → Settings → Configuration.",
    );
  }

  return {
    physicalAddress,
    phoneNumber,
    supportEmail,
    interacDepositEmail,
    companyName,
  };
}

/**
 * Admin-configured footer social links. Falls back to DEFAULT_SOCIAL_LINKS only
 * when a field is ABSENT (legacy docs / .lean() skips schema defaults) — an
 * explicitly emptied value ("") is preserved so the admin can hide that icon.
 */
export async function getSocialLinks(): Promise<ISocialLinks> {
  await connectToDatabase();
  const settings = await PlatformSettings.findOne().select("socialLinks").lean();
  const s = settings?.socialLinks as Partial<ISocialLinks> | undefined;
  const pick = (k: keyof ISocialLinks): string =>
    (s?.[k] ?? DEFAULT_SOCIAL_LINKS[k]).trim();
  return {
    facebook: pick("facebook"),
    x: pick("x"),
    instagram: pick("instagram"),
    linkedin: pick("linkedin"),
    youtube: pick("youtube"),
    tiktok: pick("tiktok"),
  };
}

/**
 * Admin-configured footer partner logos, rendered in the scrolling partners
 * band. Falls back to DEFAULT_PARTNERS only when the field is ABSENT (legacy
 * docs that predate the feature) — an admin-saved empty list is preserved as
 * "show no partners". Entries without a logo are dropped so the band never
 * renders a broken image.
 */
export async function getPartners(): Promise<IPartner[]> {
  await connectToDatabase();
  const settings = await PlatformSettings.findOne().select("partners").lean();
  const raw = settings?.partners as IPartner[] | undefined;
  const list = raw === undefined ? DEFAULT_PARTNERS : raw;
  return list
    .filter((p) => p && typeof p.logoUrl === "string" && p.logoUrl.trim())
    .map((p) => ({
      name: (p.name ?? "").trim(),
      logoUrl: p.logoUrl.trim(),
      linkUrl: (p.linkUrl ?? "").trim(),
    }));
}
