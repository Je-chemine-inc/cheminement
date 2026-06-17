import { NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import { authOptions } from "@/lib/auth";
import { recordAccountActionRequest } from "@/lib/account-action-alerts";

/**
 * POST /api/users/me/deactivate
 *
 * Désactivation volontaire (libre-service) du compte de l'utilisateur courant
 * depuis la zone de danger des paramètres (client ou professionnel). Marque le
 * compte `inactive` et horodate la désactivation pour le distinguer d'une
 * coquille auto-provisionnée jamais réclamée. Le blocage de la connexion est
 * géré dans `authorize()` (voir lib/auth.ts) / login-reason.
 */
export async function POST() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Self-service deactivation is for clients and professionals only. Admins
    // have a dedicated, hierarchy-aware flow and must not lock themselves out.
    if (session.user.role !== "client" && session.user.role !== "professional") {
      return NextResponse.json(
        { error: "This account type cannot be deactivated here" },
        { status: 403 },
      );
    }

    await connectToDatabase();

    // Only transition active/pending -> inactive. Guarding on status keeps a
    // replayed POST from a still-valid session from re-stamping `deactivatedAt`
    // and re-alerting admins for an account that is already deactivated.
    const user = await User.findOneAndUpdate(
      { _id: session.user.id, status: { $ne: "inactive" } },
      { $set: { status: "inactive", deactivatedAt: new Date() } },
      { new: true },
    ).select("_id status firstName lastName email role");

    if (!user) {
      // No match: either the account no longer exists, or it was already
      // inactive. A valid session almost always means the latter — acknowledge
      // idempotently (without re-alerting).
      const exists = await User.exists({ _id: session.user.id });
      if (!exists) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    }

    // Notify admins (email + in-app inbox) that the user deactivated their
    // account. Best-effort, after the response — the deactivation already
    // succeeded and the client signs out immediately.
    after(() =>
      recordAccountActionRequest({
        kind: "deactivation",
        userId: user._id.toString(),
        userName: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
        userEmail: user.email,
        userRole: user.role,
      }).catch((err) =>
        console.error("deactivate admin alert failed:", err),
      ),
    );

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error(
      "Self-deactivate error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Failed to deactivate account" },
      { status: 500 },
    );
  }
}
