import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import MedicalProfile from "@/models/MedicalProfile";
import Profile from "@/models/Profile";
import Appointment from "@/models/Appointment";
import ClientDocument from "@/models/ClientDocument";
import ClientReceipt from "@/models/ClientReceipt";
import Review from "@/models/Review";
import StoredFile from "@/models/StoredFile";
import Message from "@/models/Message";
import Conversation from "@/models/Conversation";
import ExternalMessage from "@/models/ExternalMessage";
import Admin from "@/models/Admin";
import AdminAccessLog from "@/models/AdminAccessLog";
import AuthAuditLog from "@/models/AuthAuditLog";
import { ResourcePurchase } from "@/models/Resource";

/** Only client-side accounts are mergeable. Merging professionals/admins would
 * touch Profile, ledger/payouts, Stripe Connect and Admin RBAC — out of scope
 * and far riskier; the duplicate problem this solves is client-side. */
const CLIENT_ROLES = ["client", "guest", "prospect"];

/** Survivor fields backfilled from the loser ONLY when the survivor's value is
 * missing — never overwrite a value the surviving account already has. */
const GAP_FIELDS = [
  "phone",
  "dateOfBirth",
  "gender",
  "location",
  "language",
  "stripeCustomerId",
  "preferredPaymentMethod",
] as const;

export type MergeSummary = {
  survivorId: string;
  loserId: string;
  /** collection → number of documents re-pointed to the survivor */
  reassigned: Record<string, number>;
  movedMedicalProfile: boolean;
  filledFields: string[];
  deletedLoser: boolean;
};

const guaranteeRank = (s: string | undefined | null): number =>
  s === "green" ? 2 : s === "pending_admin" ? 1 : 0;

/**
 * Merge the LOSER client account into the SURVIVOR: re-point every record that
 * references the loser, backfill missing survivor fields, then delete the loser.
 *
 * Safety model (no DB transaction — matches the existing delete-cascade): all
 * re-pointing happens FIRST and the loser is deleted LAST, so a mid-way failure
 * leaves the loser intact and the operation is safe to re-run (already-moved
 * references simply no longer match the loser).
 */
export async function mergeAccounts(opts: {
  survivorId: string | mongoose.Types.ObjectId;
  loserId: string | mongoose.Types.ObjectId;
}): Promise<MergeSummary> {
  await connectToDatabase();
  const survivorId = String(opts.survivorId);
  const loserId = String(opts.loserId);

  if (survivorId === loserId) {
    throw new Error("Cannot merge an account into itself");
  }
  if (
    !mongoose.Types.ObjectId.isValid(survivorId) ||
    !mongoose.Types.ObjectId.isValid(loserId)
  ) {
    throw new Error("Invalid account id");
  }

  const [survivor, loser] = await Promise.all([
    User.findById(survivorId),
    User.findById(loserId),
  ]);
  if (!survivor) throw new Error("Survivor account not found");
  if (!loser) throw new Error("Loser account not found");
  if (!CLIENT_ROLES.includes(survivor.role) || !CLIENT_ROLES.includes(loser.role)) {
    throw new Error("Only client accounts can be merged");
  }

  // Fail-safe against role corruption: never merge (and therefore delete) an
  // account that owns an Admin record — that would orphan admin RBAC.
  const hasAdminRecord = await Admin.exists({
    userId: { $in: [survivorId, loserId] },
  });
  if (hasAdminRecord) {
    throw new Error("Cannot merge an account linked to an admin record");
  }

  // A guardian and their own managed minor are different people — refuse rather
  // than silently dissolve the family relationship during the merge.
  const guardianLinked =
    (survivor.managedAccounts ?? []).some((x) => String(x) === loserId) ||
    (loser.managedAccounts ?? []).some((x) => String(x) === survivorId) ||
    String(survivor.guardianId ?? "") === loserId ||
    String(loser.guardianId ?? "") === survivorId ||
    String(survivor.accountManagerId ?? "") === loserId ||
    String(loser.accountManagerId ?? "") === survivorId;
  if (guardianLinked) {
    throw new Error(
      "Cannot merge a guardian with their own managed account — unwind the relationship first",
    );
  }

  const sId = new mongoose.Types.ObjectId(survivorId);
  const lId = new mongoose.Types.ObjectId(loserId);
  const reassigned: Record<string, number> = {};
  const bump = (key: string, n: number | undefined) => {
    if (n && n > 0) reassigned[key] = (reassigned[key] ?? 0) + n;
  };

  // 1. Single-reference collections: re-point loser → survivor.
  bump(
    "appointments",
    (await Appointment.updateMany({ clientId: lId }, { $set: { clientId: sId } }))
      .modifiedCount,
  );
  bump(
    "clientDocuments",
    (await ClientDocument.updateMany({ clientId: lId }, { $set: { clientId: sId } }))
      .modifiedCount,
  );
  bump(
    "clientDocumentsShared",
    (await ClientDocument.updateMany(
      { sharedByUserId: lId },
      { $set: { sharedByUserId: sId } },
    )).modifiedCount,
  );
  bump(
    "clientReceipts",
    (await ClientReceipt.updateMany({ clientId: lId }, { $set: { clientId: sId } }))
      .modifiedCount,
  );
  bump(
    "reviews",
    (await Review.updateMany({ clientId: lId }, { $set: { clientId: sId } }))
      .modifiedCount,
  );
  bump(
    "resourcePurchases",
    (await ResourcePurchase.updateMany({ userId: lId }, { $set: { userId: sId } }))
      .modifiedCount,
  );
  bump(
    "storedFiles",
    (await StoredFile.updateMany({ uploadedBy: lId }, { $set: { uploadedBy: sId } }))
      .modifiedCount,
  );
  bump(
    "messages",
    (await Message.updateMany({ senderId: lId }, { $set: { senderId: sId } }))
      .modifiedCount,
  );
  await ExternalMessage.updateMany({ userId: lId }, { $set: { userId: sId } });

  // Audit trails: re-point so history stays attached to the surviving person
  // instead of dangling on the deleted loser id.
  await AuthAuditLog.updateMany({ userId: lId }, { $set: { userId: sId } });
  await AdminAccessLog.updateMany(
    { resourceUserId: lId },
    { $set: { resourceUserId: sId } },
  );
  await AdminAccessLog.updateMany(
    { actorUserId: lId },
    { $set: { actorUserId: sId } },
  );

  // 2. Array-reference collections: add survivor, then drop loser (dedupes if
  // the survivor was already present).
  await Conversation.updateMany(
    { participants: lId },
    { $addToSet: { participants: sId } },
  );
  bump(
    "conversations",
    (await Conversation.updateMany(
      { participants: lId },
      { $pull: { participants: lId } },
    )).modifiedCount,
  );
  await Message.updateMany({ readBy: lId }, { $addToSet: { readBy: sId } });
  await Message.updateMany({ readBy: lId }, { $pull: { readBy: lId } });

  // 3. User self-references held by OTHER accounts (e.g. minors the loser
  // guarded, or accounts that flagged the loser as a possible duplicate).
  await User.updateMany({ guardianId: lId }, { $set: { guardianId: sId } });
  await User.updateMany(
    { accountManagerId: lId },
    { $set: { accountManagerId: sId } },
  );
  await User.updateMany(
    { managedAccounts: lId },
    { $addToSet: { managedAccounts: sId } },
  );
  await User.updateMany(
    { managedAccounts: lId },
    { $pull: { managedAccounts: lId } },
  );
  await User.updateMany(
    { possibleDuplicateOf: lId },
    { $pull: { possibleDuplicateOf: lId } },
  );

  // 4. MedicalProfile is a per-user singleton (userId unique). Keep the
  // survivor's; only move the loser's if the survivor has none.
  let movedMedicalProfile = false;
  const survivorHasMedical = await MedicalProfile.findOne({ userId: sId })
    .select("_id")
    .lean();
  if (!survivorHasMedical) {
    try {
      const res = await MedicalProfile.updateMany(
        { userId: lId },
        { $set: { userId: sId } },
      );
      movedMedicalProfile = (res.modifiedCount ?? 0) > 0;
    } catch {
      // Race: the survivor gained a MedicalProfile between the check and the
      // move (userId is unique → E11000). Keep the survivor's; the loser's is
      // removed in the cleanup below.
      movedMedicalProfile = false;
    }
  }

  // 5. Backfill missing survivor fields from the loser (never overwrite).
  const filledFields: string[] = [];
  const survivorDoc = survivor as unknown as Record<string, unknown>;
  const loserDoc = loser as unknown as Record<string, unknown>;
  for (const f of GAP_FIELDS) {
    const cur = survivorDoc[f];
    const next = loserDoc[f];
    if ((cur == null || cur === "") && next != null && next !== "") {
      survivorDoc[f] = next;
      filledFields.push(f);
    }
  }
  // Keep the stronger payment guarantee.
  if (
    guaranteeRank(loser.paymentGuaranteeStatus) >
    guaranteeRank(survivor.paymentGuaranteeStatus)
  ) {
    survivor.paymentGuaranteeStatus = loser.paymentGuaranteeStatus;
    survivor.paymentGuaranteeSource = loser.paymentGuaranteeSource;
    filledFields.push("paymentGuaranteeStatus");
  }
  // Absorb the loser's managed minors; drop self/loser refs and dedupe.
  const mergedManaged = Array.from(
    new Set(
      [
        ...(survivor.managedAccounts ?? []).map(String),
        ...(loser.managedAccounts ?? []).map(String),
      ].filter((idStr) => idStr !== survivorId && idStr !== loserId),
    ),
  );
  survivor.managedAccounts = mergedManaged.map(
    (idStr) => new mongoose.Types.ObjectId(idStr),
  );
  // The survivor must never list the loser as a possible duplicate anymore.
  if (Array.isArray(survivor.possibleDuplicateOf)) {
    survivor.possibleDuplicateOf = survivor.possibleDuplicateOf.filter(
      (x) => String(x) !== loserId,
    );
  }
  await survivor.save();

  // Audit line for incident recovery — the loser's email/id is about to be
  // permanently removed.
  console.log(
    `[account-merge] merged loser=${loserId} (${loser.email}) into survivor=${survivorId} (${survivor.email})`,
  );

  // 6. Remove the loser LAST (data already re-pointed). Clean any leftover
  // per-user singletons the loser might still own.
  await MedicalProfile.deleteMany({ userId: lId });
  await Profile.deleteMany({ userId: lId });
  await User.deleteOne({ _id: lId });

  return {
    survivorId,
    loserId,
    reassigned,
    movedMedicalProfile,
    filledFields,
    deletedLoser: true,
  };
}
