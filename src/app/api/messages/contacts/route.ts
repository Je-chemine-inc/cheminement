import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import User from "@/models/User";
import { authOptions } from "@/lib/auth";

// GET /api/messages/contacts — people I can message (based on shared appointments)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectToDatabase();
  const userId = new mongoose.Types.ObjectId(session.user.id);
  const role = session.user.role as string;

  let contactIds: mongoose.Types.ObjectId[] = [];

  if (role === "client") {
    const appointments = await Appointment.find({ clientId: userId })
      .distinct("professionalId")
      .lean();
    contactIds = appointments as mongoose.Types.ObjectId[];
  } else if (role === "professional") {
    const appointments = await Appointment.find({ professionalId: userId })
      .distinct("clientId")
      .lean();
    contactIds = appointments as mongoose.Types.ObjectId[];
  } else if (role === "admin") {
    // Admins can message any active user
    const users = await User.find({ status: "active", _id: { $ne: userId } })
      .select("_id")
      .limit(200)
      .lean();
    contactIds = users.map((u) => u._id as mongoose.Types.ObjectId);
  }

  const contacts = await User.find({ _id: { $in: contactIds } })
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
