import crypto from "crypto";
import bcrypt from "bcryptjs";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import MedicalProfile from "@/models/MedicalProfile";

/**
 * When a professional schedules a first appointment for a guest/prospect, provision a
 * permanent client account (one request → one account) with minimal clinical record.
 *
 * By default the account is created as `inactive` (client hasn't claimed it yet).
 * Pass `activate: true` to set status to `active` immediately (e.g. when the client
 * completed signup themselves).
 *
 * Password is set randomly; the user can use "Forgot password" to sign in.
 */
export async function provisionGuestAsClient(
  userId: string,
  opts: { issueType?: string; activate?: boolean },
): Promise<{ promoted: boolean }> {
  await connectToDatabase();
  const user = await User.findById(userId);
  if (!user || (user.role !== "guest" && user.role !== "prospect")) {
    return { promoted: false };
  }

  const tempPassword = crypto.randomBytes(32).toString("hex");
  user.role = "client";
  user.password = await bcrypt.hash(tempPassword, 12);
  // Default: inactive until the client claims the account via the invitation link.
  // Active only when explicitly requested (e.g. client completed the full signup form).
  user.status = opts.activate === true ? "active" : "inactive";
  await user.save();

  const existing = await MedicalProfile.findOne({ userId: user._id });
  if (!existing) {
    await MedicalProfile.create({
      userId: user._id,
      primaryIssue: opts.issueType || "",
      profileCompleted: false,
    });
  }

  return { promoted: true };
}
