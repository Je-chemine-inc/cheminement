import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import Appointment from "@/models/Appointment";
import {
  getActiveAdminPermissions,
  mustMaskClientContactPII,
} from "@/lib/admin-rbac";
import { maskPhoneForDisplay } from "@/lib/contact-mask";
import { logAdminClientAccess } from "@/lib/admin-access-log";
import { findNameDuplicates, findUserByStrongKey } from "@/lib/account-dedup";

const CLIENT_ROLES = ["client", "guest", "prospect"];

/**
 * GET /api/admin/patients/[id]/duplicates
 * Candidate accounts that may be the same person as [id] (the prospective
 * survivor): the flagged `possibleDuplicateOf`, same normalized full name, and
 * same email / phone (strong keys). Client accounts only.
 */
export async function GET(
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
    if (perms && !perms.managePatients && !perms.manageUsers) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const survivor = await User.findById(id).select(
      "firstName lastName email phone role possibleDuplicateOf",
    );
    if (!survivor) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!CLIENT_ROLES.includes(survivor.role)) {
      // Merge is client-only; offer no candidates for pros/admins.
      return NextResponse.json({ candidates: [] });
    }

    // Audit: an admin looked up a client's contact info to find duplicates.
    void logAdminClientAccess({
      actorUserId: session.user.id,
      resourceUserId: id,
      action: "view_client_duplicates",
      req,
    });

    // Gather candidate ids from all three signals.
    const ids = new Set<string>();
    for (const x of survivor.possibleDuplicateOf ?? []) ids.add(String(x));
    for (const x of await findNameDuplicates({
      firstName: survivor.firstName,
      lastName: survivor.lastName,
      excludeId: id,
    })) {
      ids.add(x);
    }
    const strong = await findUserByStrongKey({
      email: survivor.email,
      phone: survivor.phone,
      excludeId: id,
    });
    if (strong) ids.add(String(strong.user._id));
    ids.delete(id);

    if (ids.size === 0) {
      return NextResponse.json({ candidates: [] });
    }

    const mask = perms ? mustMaskClientContactPII(perms) : false;
    const candidateDocs = await User.find({
      _id: { $in: Array.from(ids).map((x) => new mongoose.Types.ObjectId(x)) },
      role: { $in: CLIENT_ROLES },
    })
      .select("firstName lastName email phone role status createdAt")
      .limit(15);

    const candidates = await Promise.all(
      candidateDocs.map(async (c) => {
        const sessions = await Appointment.countDocuments({
          clientId: c._id,
          status: "completed",
        });
        const totalAppointments = await Appointment.countDocuments({
          clientId: c._id,
        });
        return {
          id: String(c._id),
          name: `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim(),
          email: c.email,
          phone: mask
            ? maskPhoneForDisplay(String(c.phone || ""))
            : c.phone || "",
          role: c.role,
          status: c.status,
          createdAt: c.createdAt,
          completedSessions: sessions,
          totalAppointments,
        };
      }),
    );

    return NextResponse.json({ candidates });
  } catch (error) {
    console.error("Duplicate candidates error:", error);
    return NextResponse.json(
      {
        error: "Failed to load duplicate candidates",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
