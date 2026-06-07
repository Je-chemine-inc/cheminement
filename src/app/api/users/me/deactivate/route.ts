import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import { authOptions } from "@/lib/auth";

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

    const user = await User.findByIdAndUpdate(
      session.user.id,
      { $set: { status: "inactive", deactivatedAt: new Date() } },
      { new: true },
    ).select("_id status");

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

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
