import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import Admin from "@/models/Admin";
import connectToDatabase from "@/lib/mongodb";
import {
  anonymizeExpiredAccounts,
  anonymizeSingleUser,
} from "@/lib/data-lifecycle";

async function getAuthorizedAdmin(session: Session | null) {
  if (!session?.user?.id || session.user.role !== "admin") return null;
  await connectToDatabase();
  const admin = await Admin.findOne({ userId: session.user.id, isActive: true }).lean();
  if (!admin?.permissions.manageUsers && !admin?.permissions.managePlatform) return null;
  return admin;
}

/**
 * POST /api/admin/data-lifecycle
 *
 * Body: { action: "run_bulk" }          — anonymize all expired accounts
 *       { action: "anonymize_user", userId: string } — right-to-erasure for one user
 *
 * Requires: admin with manageUsers or managePlatform permission.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const admin = await getAuthorizedAdmin(session);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { action, userId } = body as { action?: string; userId?: string };

  if (action === "run_bulk") {
    const report = await anonymizeExpiredAccounts();
    return NextResponse.json({ ok: true, report });
  }

  if (action === "anonymize_user") {
    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }
    const done = await anonymizeSingleUser(userId);
    if (!done) {
      return NextResponse.json(
        { error: "User not found or already anonymized" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

/**
 * GET /api/admin/data-lifecycle — returns retention policy info
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const admin = await getAuthorizedAdmin(session);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoffDate = new Date(Date.now() - 7 * 365.25 * 24 * 60 * 60 * 1000);

  return NextResponse.json({
    retentionPolicy: {
      retentionYears: 7,
      cutoffDate,
      description:
        "Client accounts with no activity for 7+ years are anonymized in compliance with Loi 25 (Quebec) and PCI-DSS accounting retention requirements.",
    },
    actions: ["run_bulk", "anonymize_user"],
  });
}
