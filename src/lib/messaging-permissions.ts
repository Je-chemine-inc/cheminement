import mongoose from "mongoose";
import Appointment from "@/models/Appointment";
import User from "@/models/User";

/**
 * Synthetic recipient id used in the client compose flow to address the
 * platform support team. POST /api/messages resolves it to the full set of
 * active admins so the message lands in a single group conversation.
 */
export const SUPPORT_RECIPIENT_ID = "support";

/**
 * Returns the id of the client's "currently assigned" professional — the one
 * tied to their most recent matched appointment (scheduled/completed/ongoing).
 * Drives the single allowed professional recipient in the client inbox.
 */
export async function getClientPrimaryProfessionalId(
  clientId: mongoose.Types.ObjectId | string,
): Promise<string | null> {
  const cid =
    typeof clientId === "string"
      ? new mongoose.Types.ObjectId(clientId)
      : clientId;
  const latest = await Appointment.findOne({
    clientId: cid,
    professionalId: { $ne: null },
    status: { $in: ["scheduled", "completed", "ongoing"] },
  })
    .sort({ date: -1, createdAt: -1 })
    .select("professionalId")
    .lean<{ professionalId: mongoose.Types.ObjectId | null }>();
  return latest?.professionalId ? latest.professionalId.toString() : null;
}

/**
 * Returns the ids of all active admins — the recipients targeted when a
 * client selects the synthetic "Support" entry in compose.
 */
export async function getActiveAdminIds(): Promise<string[]> {
  const admins = await User.find({ role: "admin", status: "active" })
    .select("_id")
    .lean();
  return admins.map((a) => (a._id as mongoose.Types.ObjectId).toString());
}

/**
 * Returns the set of user IDs that the given user is allowed to message.
 * Permission rules (client feedback):
 *  - client       → assigned professional only (Support sentinel handled separately)
 *  - professional → their clients + other professionals + admins
 *  - admin        → any active user
 */
export async function getAllowedRecipientIds(
  userId: mongoose.Types.ObjectId | string,
  role: string,
): Promise<Set<string>> {
  const uid =
    typeof userId === "string" ? new mongoose.Types.ObjectId(userId) : userId;
  const allowed = new Set<string>();

  if (role === "client") {
    const primaryProId = await getClientPrimaryProfessionalId(uid);
    if (primaryProId) allowed.add(primaryProId);
  } else if (role === "professional") {
    const clientIds = (await Appointment.find({ professionalId: uid })
      .distinct("clientId")
      .lean()) as mongoose.Types.ObjectId[];
    clientIds.forEach((id) => allowed.add(id.toString()));

    const otherPros = await User.find({
      role: "professional",
      status: "active",
      _id: { $ne: uid },
    })
      .select("_id")
      .lean();
    otherPros.forEach((p) =>
      allowed.add((p._id as mongoose.Types.ObjectId).toString()),
    );

    const admins = await User.find({
      role: "admin",
      status: "active",
      _id: { $ne: uid },
    })
      .select("_id")
      .lean();
    admins.forEach((a) =>
      allowed.add((a._id as mongoose.Types.ObjectId).toString()),
    );
  } else if (role === "admin") {
    const users = await User.find({ status: "active", _id: { $ne: uid } })
      .select("_id")
      .limit(2000)
      .lean();
    users.forEach((u) =>
      allowed.add((u._id as mongoose.Types.ObjectId).toString()),
    );
  }

  return allowed;
}
