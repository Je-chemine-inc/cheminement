/**
 * Formats a free-form Canadian phone number into the local display form
 * `(514) 000-0000`. Accepts inputs like "5141234567", "514-123-4567",
 * "+1 514 123 4567", or "1.514.123.4567"; a leading country code "1" is
 * stripped when present.
 *
 * Returns the trimmed input untouched when the digit count is anything other
 * than 10 (post country-code strip) so unusual entries are not silently
 * mangled — admins still see what they typed.
 */
export function formatCanadianPhone(raw: string | undefined | null): string {
  if (!raw) return "";
  const trimmed = String(raw).trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/\D/g, "");
  const local =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return trimmed;
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

/**
 * Splits a free-form postal address into standard address-block lines.
 * Honors explicit newlines first; otherwise falls back to comma-separated
 * segments, which is how the admin field is typically captured
 * (e.g. "123 Rue Principale, Montréal, QC H3A 1B2").
 */
export function formatAddressLines(
  raw: string | undefined | null,
): string[] {
  if (!raw) return [];
  const trimmed = String(raw).trim();
  if (!trimmed) return [];
  if (/\r?\n/.test(trimmed)) {
    return trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return trimmed
    .split(",")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Normalizes a Canadian postal code to the `A1B 2C3` form (uppercase, single
 * space separator). Returns the trimmed input untouched when it does not match
 * the 6-character Canadian pattern so unusual entries are not mangled.
 */
export function formatCanadianPostalCode(
  raw: string | undefined | null,
): string {
  if (!raw) return "";
  const trimmed = String(raw).trim();
  if (!trimmed) return "";
  const compact = trimmed.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(compact)) return trimmed.toUpperCase();
  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
}

export type StandardAddress = {
  street?: string;
  suite?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
};

/**
 * Renders a structured Canadian address into the standard 3–4 line block used
 * on fiscal receipts and the public Contact page:
 *
 *     [Company name]                  ← optional, only when `companyName` is passed
 *     123, rue de l'Exemple, Bureau 101
 *     Montréal (Québec) H1A 2B3
 *     Canada
 *
 * Returns an empty array when every structured field is blank so the caller
 * can fall back to a placeholder ("—") without rendering empty lines.
 */
export function formatStandardAddressBlock(
  address: StandardAddress | undefined | null,
  companyName?: string,
): string[] {
  if (!address) return companyName?.trim() ? [companyName.trim()] : [];
  const street = address.street?.trim() ?? "";
  const suite = address.suite?.trim() ?? "";
  const city = address.city?.trim() ?? "";
  const province = address.province?.trim() ?? "";
  const postalCode = formatCanadianPostalCode(address.postalCode);
  const country = address.country?.trim() ?? "";

  if (!street && !suite && !city && !province && !postalCode && !country) {
    return companyName?.trim() ? [companyName.trim()] : [];
  }

  const lines: string[] = [];
  if (companyName?.trim()) lines.push(companyName.trim());

  // Line: street[, suite]
  const streetLine = [street, suite].filter(Boolean).join(", ");
  if (streetLine) lines.push(streetLine);

  // Line: city (province) postalCode
  const cityLineParts: string[] = [];
  if (city) cityLineParts.push(city);
  if (province) cityLineParts.push(`(${province})`);
  if (postalCode) cityLineParts.push(postalCode);
  const cityLine = cityLineParts.join(" ");
  if (cityLine) lines.push(cityLine);

  if (country) lines.push(country);
  return lines;
}
