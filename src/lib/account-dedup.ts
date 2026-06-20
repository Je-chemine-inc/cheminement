import type { Types } from "mongoose";
import User, { type IUser } from "@/models/User";
import MedicalProfile from "@/models/MedicalProfile";
import Appointment from "@/models/Appointment";
import { phoneLookupHash, normalizeFullName } from "@/lib/contact-keys";

/** A "real" account can actually log in; a shell (guest/prospect, no password)
 * is a lead-capture record from the booking funnel. */
function isRealAccount(u: IUser): boolean {
  return Boolean(u.password) && u.role !== "guest" && u.role !== "prospect";
}

/**
 * Whether the given email belongs to an existing REAL (loginable) account —
 * i.e. the person has actually signed up, not just a passwordless lead-capture
 * shell from the booking funnel. Used to pick the right referral email (log in
 * to an existing space vs. create an account). Returns the user when real.
 */
export async function findRealAccountByEmail(
  email?: string | null,
): Promise<IUser | null> {
  const e = email?.toLowerCase().trim();
  if (!e) return null;
  const u = await User.findOne({ email: e });
  return u && isRealAccount(u) ? u : null;
}

export type StrongMatch = { user: IUser; key: "email" | "phone" } | null;

/**
 * Find an existing user by a STRONG identity key — email first (the canonical
 * auth key), then normalized phone (HMAC lookup). Used to consolidate instead
 * of creating duplicates. Returns null when no strong match exists.
 */
export async function findUserByStrongKey(opts: {
  email?: string | null;
  phone?: string | null;
  excludeId?: string | null;
}): Promise<StrongMatch> {
  const email = opts.email?.toLowerCase().trim();
  if (email) {
    const byEmail = await User.findOne({ email });
    if (byEmail && String(byEmail._id) !== opts.excludeId) {
      return { user: byEmail, key: "email" };
    }
  }
  const hash = phoneLookupHash(opts.phone);
  if (hash) {
    const q: Record<string, unknown> = { phoneLookupHash: hash };
    if (opts.excludeId) q._id = { $ne: opts.excludeId };
    const byPhone = await User.findOne(q);
    if (byPhone) return { user: byPhone, key: "phone" };
  }
  return null;
}

/**
 * Consolidate lead-capture SHELLS (passwordless guest/prospect) that share the
 * survivor's phone into the survivor: re-point their appointments to the
 * survivor, then delete the shell + its medical profile. Real accounts (that
 * can log in) are NEVER auto-merged — that would risk merging family members
 * who share a phone, or account takeover — they're returned as `flagged` ids
 * for admin review instead.
 */
export async function consolidatePhoneShells(opts: {
  survivorId: string | Types.ObjectId;
  phone?: string | null;
}): Promise<{ merged: string[]; flagged: string[] }> {
  const merged: string[] = [];
  const flagged: string[] = [];
  const hash = phoneLookupHash(opts.phone);
  if (!hash) return { merged, flagged };
  const survivorId = String(opts.survivorId);
  const candidates = await User.find({
    phoneLookupHash: hash,
    _id: { $ne: survivorId },
  });
  for (const c of candidates) {
    if (isRealAccount(c)) {
      flagged.push(String(c._id));
      continue;
    }
    await Appointment.updateMany(
      { clientId: c._id },
      { $set: { clientId: survivorId } },
    );
    await MedicalProfile.deleteMany({ userId: c._id });
    await User.deleteOne({ _id: c._id });
    merged.push(String(c._id));
  }
  return { merged, flagged };
}

/**
 * Other accounts that share the survivor's normalized full name (weak signal →
 * admin review only, never auto-merged). Returns their ids.
 */
export async function findNameDuplicates(opts: {
  firstName?: string | null;
  lastName?: string | null;
  excludeId?: string | null;
}): Promise<string[]> {
  const name = normalizeFullName(opts.firstName, opts.lastName);
  if (!name) return [];
  const q: Record<string, unknown> = { fullNameLookup: name };
  if (opts.excludeId) q._id = { $ne: opts.excludeId };
  const matches = await User.find(q).select("_id");
  return matches.map((m) => String(m._id));
}
