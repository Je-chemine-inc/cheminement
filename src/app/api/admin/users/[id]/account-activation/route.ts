import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import Admin from "@/models/Admin";
import { authOptions } from "@/lib/auth";

// Allow headroom for cold-start Mongo.
export const maxDuration = 30;

/**
 * Admin action: force-activate or force-deactivate a client/professional
 * account.
 *
 * Why this exists: re-sending a password setup link (see
 * `send-password-setup-link`) never touches `status`, so a deactivated account
 * stays `inactive` and login keeps being blocked in `authorize()` (lib/auth.ts).
 * Admins needed an explicit, immediate "Réactiver le compte" control.
 *
 * - activate=true  → status: "active", clears `deactivatedAt`. The user can sign
 *   in again immediately. A professional's `professionalLicenseStatus` is left
 *   untouched on purpose (a rejected licence is a separate gate handled by the
 *   admin "Valider" flow; a self-deactivated pro was already "verified").
 * - activate=false → status: "inactive", stamps `deactivatedAt` so the login
 *   screen shows the "account deactivated" reason (vs. the unclaimed-shell
 *   "claim your account" message) — see /api/auth/account/login-reason.
 *
 * The data is never deleted: a deactivated account keeps all of its records and
 * can be reactivated at any time.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await connectToDatabase();

    // Mirror the status-editing PUT on /api/admin/users/[id]: gate on
    // `managePatients` when a granular Admin record exists, otherwise rely on
    // the session role.
    const adminRecord = await Admin.findOne({
      userId: session.user.id,
      isActive: true,
    })
      .select("permissions")
      .lean();
    if (adminRecord?.permissions && !adminRecord.permissions.managePatients) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    if (!id || id === "undefined" || id.length !== 24) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    if (typeof body?.activate !== "boolean") {
      return NextResponse.json(
        { error: "Missing 'activate' boolean" },
        { status: 400 },
      );
    }
    const activate: boolean = body.activate;

    const user = await User.findById(id).select("_id role status");
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Self-service deactivation/reactivation is for clients and professionals.
    // Admins have a dedicated, hierarchy-aware flow (admins page) and must not
    // be toggled here.
    if (user.role !== "client" && user.role !== "professional") {
      return NextResponse.json(
        { error: "This account type cannot be toggled here" },
        { status: 400 },
      );
    }

    // Confine this endpoint to the deactivate <-> reactivate transition it is
    // meant for. Reactivation only makes sense for a currently-inactive
    // account; deactivation only for an active one. This blocks a second,
    // less-guarded path from "pending" straight to "active" (the dedicated
    // /professionals/[id]/validate flow owns approval + licence side-effects).
    if (activate && user.status !== "inactive") {
      return NextResponse.json(
        { error: "Account is not deactivated", code: "NOT_INACTIVE" },
        { status: 409 },
      );
    }
    if (!activate && user.status !== "active") {
      return NextResponse.json(
        { error: "Account is not active", code: "NOT_ACTIVE" },
        { status: 409 },
      );
    }

    const update = activate
      ? { $set: { status: "active" }, $unset: { deactivatedAt: "" } }
      : { $set: { status: "inactive", deactivatedAt: new Date() } };

    await User.findByIdAndUpdate(id, update);

    return NextResponse.json({
      success: true,
      status: activate ? "active" : "inactive",
    });
  } catch (error) {
    console.error("Admin account-activation error:", error);
    return NextResponse.json(
      {
        error: "Failed to update account status",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}
