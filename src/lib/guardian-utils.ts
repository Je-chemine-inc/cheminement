import User, { IUser } from "@/models/User";
import mongoose from "mongoose";

/**
 * Calculate age from date of birth
 */
export function calculateAge(dateOfBirth: Date | string | undefined): number | null {
  if (!dateOfBirth) return null;

  const birthDate = typeof dateOfBirth === "string" ? new Date(dateOfBirth) : dateOfBirth;
  if (isNaN(birthDate.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  return age;
}

/**
 * Check if user is a minor (under 18 in Quebec/Canada)
 */
export function isMinor(user: IUser | { dateOfBirth?: Date | string }): boolean {
  const age = calculateAge(user.dateOfBirth);
  return age !== null && age < 18;
}

/**
 * Under 14 → parent's email is the authentication identifier and the recipient
 * for all booking communications (legal protection of the minor under Quebec's
 * LSSSS art. 14, where consent to care alone starts at 14).
 */
export function isUnder14(user: { dateOfBirth?: Date | string }): boolean {
  const age = calculateAge(user.dateOfBirth);
  return age !== null && age < 14;
}

/**
 * Resolve the recipient of any transactional email for an appointment.
 *
 * Quebec LSSSS art. 14: for a loved-one booking where the beneficiary is 14+,
 * the loved one is the legal channel — the parent/requester must NOT receive
 * activation, confirmation, reminder, or follow-up emails. Under 14, the
 * parent IS the legal channel and receives everything.
 *
 * Language: the loved one's preference is not stored, so we fall back to the
 * requester's language for adult-loved-one cases.
 */
export function resolveAppointmentRecipient(
  appointment: {
    bookingFor?: "self" | "patient" | "loved-one";
    lovedOneInfo?: {
      firstName?: string;
      lastName?: string;
      email?: string;
      dateOfBirth?: Date | string;
    };
  },
  requester: {
    firstName?: string;
    lastName?: string;
    email?: string;
    language?: string;
  },
): {
  email: string;
  name: string;
  language: "fr" | "en";
  /** True when we routed to the loved one (caller may want to skip parent-only CTAs). */
  isLovedOne: boolean;
} {
  const lang: "fr" | "en" =
    requester.language === "fr" ? "fr" : requester.language === "en" ? "en" : "fr";
  const requesterPayload = {
    email: requester.email ?? "",
    name:
      `${requester.firstName ?? ""} ${requester.lastName ?? ""}`.trim() ||
      "Client",
    language: lang,
    isLovedOne: false,
  };

  if (appointment.bookingFor !== "loved-one") return requesterPayload;
  const lovedOne = appointment.lovedOneInfo;
  if (!lovedOne?.email) return requesterPayload;
  if (isUnder14({ dateOfBirth: lovedOne.dateOfBirth })) return requesterPayload;

  return {
    email: lovedOne.email,
    name:
      `${lovedOne.firstName ?? ""} ${lovedOne.lastName ?? ""}`.trim() ||
      requesterPayload.name,
    language: lang,
    isLovedOne: true,
  };
}

/**
 * Who the PROFESSIONAL notification should name as the "client". The pro is being
 * matched/assigned to the person they'll actually treat, so for a loved-one
 * booking we show the LOVED ONE's name (always — even under 14) rather than the
 * requester's. The contact email still follows LSSSS art. 14: the loved one's own
 * email at 14+, otherwise the guardian/requester's. (Self/patient bookings just
 * return the requester unchanged.)
 */
export function resolveProfessionalNotifeeParty(input: {
  bookingFor?: string | null;
  lovedOneInfo?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    dateOfBirth?: Date | string;
  } | null;
  requesterName: string;
  requesterEmail: string;
}): { name: string; email: string } {
  const { bookingFor, lovedOneInfo, requesterName, requesterEmail } = input;
  if (bookingFor !== "loved-one" || !lovedOneInfo) {
    return { name: requesterName, email: requesterEmail };
  }
  const lovedOneName =
    `${lovedOneInfo.firstName ?? ""} ${lovedOneInfo.lastName ?? ""}`.trim();
  const email =
    lovedOneInfo.email && !isUnder14({ dateOfBirth: lovedOneInfo.dateOfBirth })
      ? lovedOneInfo.email
      : requesterEmail;
  return { name: lovedOneName || requesterName, email };
}

/**
 * Get guardian/account manager for a user
 */
export async function getGuardian(
  userId: mongoose.Types.ObjectId | string,
): Promise<IUser | null> {
  try {
    const user = await User.findById(userId).populate("guardianId");
    if (!user || !user.guardianId) return null;

    const guardian = await User.findById(user.guardianId);
    return guardian;
  } catch (error) {
    console.error("Error getting guardian:", error);
    return null;
  }
}

/**
 * Get all accounts managed by a user (their children)
 */
export async function getManagedAccounts(
  userId: mongoose.Types.ObjectId | string,
): Promise<IUser[]> {
  try {
    // Convert userId to ObjectId if it's a string
    let guardianId: mongoose.Types.ObjectId;
    if (typeof userId === "string") {
      // Validate that it's a valid ObjectId string
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        console.error("Invalid userId format:", userId);
        return [];
      }
      guardianId = new mongoose.Types.ObjectId(userId);
    } else {
      guardianId = userId;
    }
    
    console.log("Searching for accounts with guardianId:", guardianId.toString());
    
    // Search for accounts where guardianId or accountManagerId matches
    const accounts = await User.find({
      $or: [
        { guardianId: guardianId },
        { accountManagerId: guardianId },
      ],
    }).select("firstName lastName email dateOfBirth phone status guardianId accountManagerId");
    
    console.log("Found accounts:", accounts.length, accounts.map(a => ({ 
      id: a._id.toString(), 
      name: `${a.firstName} ${a.lastName}`,
      guardianId: a.guardianId?.toString(),
      accountManagerId: a.accountManagerId?.toString(),
    })));
    
    return accounts;
  } catch (error) {
    console.error("Error getting managed accounts:", error);
    return [];
  }
}

/**
 * True if the session user may initiate payment / billing for this client account
 * (same user, guardian/account manager, or client listed in managedAccounts).
 */
export async function canSessionUserActForClient(
  sessionUserId: string,
  clientUserId: string,
): Promise<boolean> {
  if (!sessionUserId || !clientUserId) return false;
  if (sessionUserId === clientUserId) return true;

  const client = await User.findById(clientUserId).select(
    "guardianId accountManagerId",
  );
  if (!client) return false;
  const g = client.guardianId?.toString();
  const a = client.accountManagerId?.toString();
  if (g === sessionUserId || a === sessionUserId) return true;

  const actor = await User.findById(sessionUserId).select("managedAccounts");
  if (!actor?.managedAccounts?.length) return false;
  return actor.managedAccounts.some((id) => id.toString() === clientUserId);
}

/**
 * Link a minor account to a guardian/parent account
 */
export async function linkGuardian(
  minorUserId: mongoose.Types.ObjectId | string,
  guardianUserId: mongoose.Types.ObjectId | string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const minor = await User.findById(minorUserId);
    const guardian = await User.findById(guardianUserId);

    if (!minor) {
      return { success: false, error: "Minor user not found" };
    }

    if (!guardian) {
      return { success: false, error: "Guardian user not found" };
    }

    // Verify the minor is actually a minor
    if (!isMinor(minor)) {
      return { success: false, error: "User is not a minor" };
    }

    // Update minor's guardian reference
    minor.guardianId = guardian._id;
    minor.accountManagerId = guardian._id;
    await minor.save();

    // Add minor to guardian's managed accounts if not already present
    if (!guardian.managedAccounts) {
      guardian.managedAccounts = [];
    }
    // Check if minor._id is already in the array (compare as strings)
    const minorIdString = minor._id.toString();
    const isAlreadyManaged = guardian.managedAccounts.some(
      (id) => id.toString() === minorIdString
    );
    
    if (!isAlreadyManaged) {
      guardian.managedAccounts.push(minor._id);
      await guardian.save();
    }

    return { success: true };
  } catch (error) {
    console.error("Error linking guardian:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to link guardian",
    };
  }
}

/**
 * Unlink a guardian from a minor account
 */
export async function unlinkGuardian(
  minorUserId: mongoose.Types.ObjectId | string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const minor = await User.findById(minorUserId);

    if (!minor) {
      return { success: false, error: "User not found" };
    }

    const guardianId = minor.guardianId;

    // Remove guardian reference from minor
    minor.guardianId = undefined;
    minor.accountManagerId = undefined;
    await minor.save();

    // Remove minor from guardian's managed accounts
    if (guardianId) {
      const guardian = await User.findById(guardianId);
      if (guardian && guardian.managedAccounts) {
        guardian.managedAccounts = guardian.managedAccounts.filter(
          (id) => id.toString() !== minorUserId.toString(),
        );
        await guardian.save();
      }
    }

    return { success: true };
  } catch (error) {
    console.error("Error unlinking guardian:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to unlink guardian",
    };
  }
}

/**
 * Check if a user can access another user's account (is guardian or is the user)
 */
export async function canAccessAccount(
  requestingUserId: mongoose.Types.ObjectId | string,
  targetUserId: mongoose.Types.ObjectId | string,
): Promise<boolean> {
  if (requestingUserId.toString() === targetUserId.toString()) {
    return true; // User can always access their own account
  }

  try {
    const targetUser = await User.findById(targetUserId);
    if (!targetUser) return false;

    // Check if requesting user is the guardian
    if (
      targetUser.guardianId &&
      targetUser.guardianId.toString() === requestingUserId.toString()
    ) {
      return true;
    }

    return false;
  } catch (error) {
    console.error("Error checking account access:", error);
    return false;
  }
}
