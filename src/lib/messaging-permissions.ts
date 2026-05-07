import mongoose from "mongoose";
import Appointment from "@/models/Appointment";
import User from "@/models/User";

/**
 * Returns the set of user IDs that the given user is allowed to message.
 * Permission rules (client feedback):
 *  - client       → professionals from their appointments + admins
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
    const professionalIds = (await Appointment.find({ clientId: uid })
      .distinct("professionalId")
      .lean()) as mongoose.Types.ObjectId[];
    professionalIds.forEach((id) => allowed.add(id.toString()));

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
