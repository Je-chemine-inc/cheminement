/**
 * The address a client needs in order to physically show up.
 *
 * Appointment reminders carried no location whatsoever — only Professionnel /
 * Date / Heure. The single address anywhere in the email was Je chemine's own,
 * rendered in the branding footer, so a client with an in-person booking either
 * saw no address or read the platform's as the meeting place. Professionals
 * practise from their own offices; the two are rarely the same building.
 *
 * This resolves what a reminder should say about *where*, for one appointment.
 * It is deliberately pure: the email builders and any UI can share it, and the
 * "what if it isn't set" decision is made in one place rather than re-guessed.
 */
import { formatStandardAddressBlock } from "@/lib/format-platform-contact";

export interface OfficeAddressLike {
  street?: string | null;
  suite?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
}

/** Appointment types that require the client to travel somewhere. */
export const IN_PERSON_TYPES = ["in-person"] as const;

export function isInPersonAppointment(type: string | null | undefined): boolean {
  return (IN_PERSON_TYPES as readonly string[]).includes(type ?? "");
}

export interface SessionLocation {
  /** Render a location block at all? False for video/phone sessions. */
  show: boolean;
  /** Address lines, already formatted. Empty when the pro has not set one. */
  lines: string[];
  /** Floor / buzzer / parking, when given. */
  notes: string | null;
  /**
   * True when this is an in-person session but no office address is on file.
   * The reminder must then say so explicitly — silence reads as "the address in
   * the footer", which is the platform's, and sends the client to the wrong
   * place.
   */
  missing: boolean;
}

const clean = (v: string | null | undefined): string =>
  typeof v === "string" ? v.trim() : "";

function hasAnyPart(address: OfficeAddressLike | null | undefined): boolean {
  if (!address) return false;
  return Boolean(
    clean(address.street) ||
      clean(address.suite) ||
      clean(address.city) ||
      clean(address.postalCode),
  );
}

/**
 * Resolve the location block for one appointment.
 *
 * `province` and a lone `country` are ignored when deciding whether an address
 * exists: the schema defaults them, so a profile that has never been filled in
 * would otherwise look "set" and render a bare province line.
 */
export function resolveSessionLocation(input: {
  appointmentType?: string | null;
  officeAddress?: OfficeAddressLike | null;
  officeNotes?: string | null;
}): SessionLocation {
  if (!isInPersonAppointment(input.appointmentType)) {
    return { show: false, lines: [], notes: null, missing: false };
  }

  if (!hasAnyPart(input.officeAddress)) {
    return { show: true, lines: [], notes: null, missing: true };
  }

  return {
    show: true,
    lines: formatStandardAddressBlock(
      {
        street: clean(input.officeAddress?.street),
        suite: clean(input.officeAddress?.suite),
        city: clean(input.officeAddress?.city),
        province: clean(input.officeAddress?.province),
        postalCode: clean(input.officeAddress?.postalCode),
      },
      undefined,
    ),
    notes: clean(input.officeNotes) || null,
    missing: false,
  };
}

/** One-line rendering for an email detail row or an SMS. */
export function formatSessionLocationLine(
  location: SessionLocation,
  locale: "fr" | "en" = "fr",
): string | null {
  if (!location.show) return null;
  if (location.missing) {
    return locale === "en"
      ? "Address to be confirmed with your professional"
      : "Adresse à confirmer avec votre professionnel";
  }
  const parts = [...location.lines];
  if (location.notes) parts.push(location.notes);
  return parts.join(" · ");
}
