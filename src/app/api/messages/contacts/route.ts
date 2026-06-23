import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import { authOptions } from "@/lib/auth";
import {
  SUPPORT_RECIPIENT_ID,
  getAllowedRecipientIds,
  getClientPrimaryProfessionalId,
} from "@/lib/messaging-permissions";

// GET /api/messages/contacts — people I can message
//
// Permission rules (client feedback):
//  - client       → restricted to TWO entries: "Support" (sentinel, routed to
//                   all active admins server-side) + their assigned
//                   professional (most recent matched appointment), if any.
//  - professional → their clients + other professionals + admins
//  - admin        → any active user
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectToDatabase();

  if (session.user.role === "client") {
    const contacts: Array<{ id: string; name: string; role: string }> = [
      { id: SUPPORT_RECIPIENT_ID, name: "Support", role: "support" },
    ];
    const primaryProId = await getClientPrimaryProfessionalId(session.user.id);
    if (primaryProId) {
      const pro = await User.findById(primaryProId)
        .select("firstName lastName role")
        .lean<{ firstName: string; lastName: string; role: string }>();
      if (pro) {
        contacts.push({
          id: primaryProId,
          name: `${pro.firstName} ${pro.lastName}`.trim(),
          role: pro.role,
        });
      }
    }
    return NextResponse.json({ contacts });
  }

  const allowedIds = await getAllowedRecipientIds(
    session.user.id,
    session.user.role as string,
  );

  const contacts = await User.find({
    _id: {
      $in: Array.from(allowedIds).map(
        (id) => new mongoose.Types.ObjectId(id),
      ),
    },
    // Defensive: never surface a deleted/deactivated recipient in the dropdown,
    // even if an id slipped through the allowed set.
    status: "active",
  })
    .select("firstName lastName role")
    .lean();

  return NextResponse.json({
    contacts: contacts.map((c) => ({
      id: c._id,
      name: `${c.firstName} ${c.lastName}`,
      role: c.role,
    })),
  });
}
