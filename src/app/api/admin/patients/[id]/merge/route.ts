import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { getActiveAdminPermissions } from "@/lib/admin-rbac";
import { logAdminClientAccess } from "@/lib/admin-access-log";
import { mergeAccounts } from "@/lib/account-merge";

/**
 * POST /api/admin/patients/[id]/merge
 * Merge the duplicate account `loserId` (from the body) INTO this patient
 * ([id] = survivor): re-point all of the loser's data to the survivor, then
 * delete the loser. Admin + managePatients only; client accounts only
 * (enforced in mergeAccounts).
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
    const perms = await getActiveAdminPermissions(session.user.id);
    // A granular admin must hold managePatients; a legacy admin with no Admin
    // record (perms === null) falls back to the role check above.
    if (perms && !perms.managePatients) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: survivorId } = await params;
    const { loserId } = (await req.json()) as { loserId?: string };

    if (!mongoose.Types.ObjectId.isValid(survivorId)) {
      return NextResponse.json({ error: "Invalid survivor id" }, { status: 400 });
    }
    if (!loserId || !mongoose.Types.ObjectId.isValid(loserId)) {
      return NextResponse.json({ error: "loserId is required" }, { status: 400 });
    }
    if (loserId === survivorId) {
      return NextResponse.json(
        { error: "Cannot merge an account into itself" },
        { status: 400 },
      );
    }

    const summary = await mergeAccounts({ survivorId, loserId });
    // Audit: an admin consolidated (and deleted) a client account.
    void logAdminClientAccess({
      actorUserId: session.user.id,
      resourceUserId: survivorId,
      action: "merge_client_accounts",
      req,
    });
    return NextResponse.json({ success: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Account merge error:", message);
    // Surface the guard messages from mergeAccounts as 400s; everything else 500.
    const isClientError =
      /only client accounts|into itself|not found|invalid|admin record|guardian/i.test(
        message,
      );
    return NextResponse.json(
      { error: "Failed to merge accounts", details: message },
      { status: isClientError ? 400 : 500 },
    );
  }
}
