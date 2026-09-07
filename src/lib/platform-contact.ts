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
 * Admin-configured footer social links, and the single source for both the
 * footer icons and the `sameAs` block in the Organization structured data.
 *
 * Only an http(s) URL an admin actually saved comes back. An absent field, an
 * explicit "" ("hide this icon") and a legacy non-URL value all return "" —
 * there are no guessed handles left to fall back to, deliberately, because a
 * made-up profile URL sends real visitors, and Google's entity match, to a page
 * we do not control. See DEFAULT_SOCIAL_LINKS.
 */
export async function getSocialLinks(): Promise<ISocialLinks> {
  await connectToDatabase();
  const settings = await PlatformSettings.findOne().select("socialLinks").lean();
  const s = settings?.socialLinks as Partial<ISocialLinks> | undefined;
  const pick = (k: keyof ISocialLinks): string => {
    // `.lean()` returns whatever Mongo actually holds, so the declared string
    // type is not a guarantee — a legacy document can carry a number here.
    const stored = s?.[k] ?? DEFAULT_SOCIAL_LINKS[k] ?? "";
    const value = typeof stored === "string" ? stored.trim() : "";
    // Anything that is not an http(s) URL must never become an href. Parsing
    // rather than pattern-matching also rejects a bare scheme ("https://").
    try {
      const { protocol } = new URL(value);
      return protocol === "http:" || protocol === "https:" ? value : "";
    } catch {
      return "";
    }
  };
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
