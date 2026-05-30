import crypto from "crypto";

/**
 * Pure (DB-free) helpers for account de-duplication keys. Kept separate from
 * account-dedup.ts so the User model can import them in a pre-save hook without
 * a circular dependency.
 */

/**
 * Strip a phone number to comparable digits: remove all non-digits, drop a
 * leading North-American "1" country code, keep the last 10 digits. Returns
 * null when fewer than 10 digits remain (unusable as a match key).
 */
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

/**
 * Deterministic, privacy-preserving lookup key for a phone number. Phone is
 * encrypted at rest (not queryable by value), so we persist an HMAC of the
 * normalized number to allow exact-match de-duplication without exposing the
 * plaintext. Returns null when the phone can't be normalized.
 */
export function phoneLookupHash(raw?: string | null): string | null {
  const normalized = normalizePhone(raw);
  if (!normalized) return null;
  const secret =
    process.env.FIELD_ENCRYPTION_KEY ||
    process.env.NEXTAUTH_SECRET ||
    "jechemine-phone-dedup";
  return crypto.createHmac("sha256", secret).update(normalized).digest("hex");
}

/**
 * Normalize a full name for WEAK (flag-only) duplicate detection: lowercase,
 * accent-stripped, whitespace-collapsed. Names are never an auto-merge key
 * (two different people can share a name); this just powers an admin flag.
 * Returns null when empty.
 */
export function normalizeFullName(
  firstName?: string | null,
  lastName?: string | null,
): string | null {
  const raw = `${firstName ?? ""} ${lastName ?? ""}`.trim();
  if (!raw) return null;
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
