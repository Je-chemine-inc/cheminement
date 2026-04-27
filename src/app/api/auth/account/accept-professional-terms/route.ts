import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import { LEGAL_VERSIONS } from "@/lib/legal";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== "professional") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectToDatabase();
  await User.findByIdAndUpdate(session.user.id, {
    professionalTermsAcceptedAt: new Date(),
    professionalTermsVersion: LEGAL_VERSIONS.professionalTerms,
  });

  return NextResponse.json({ ok: true });
}
