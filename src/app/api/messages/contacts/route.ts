import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import { authOptions } from "@/lib/auth";
import { getAllowedRecipientIds } from "@/lib/messaging-permissions";

// GET /api/messages/contacts — people I can message
//
// Permission rules (client feedback):
//  - client       → their professional(s) + admins (support)
//  - professional → their clients + other professionals + admins
//  - admin        → any active user
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectToDatabase();
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
