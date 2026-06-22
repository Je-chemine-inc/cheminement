import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import MedicalProfile from "@/models/MedicalProfile";
import { authOptions } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const medicalProfile = await MedicalProfile.findOne({
      userId: session.user.id,
    });

    if (!medicalProfile) {
      return NextResponse.json(
        { error: "Medical profile not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(medicalProfile);
  } catch (error: unknown) {
    console.error(
      "Get medical profile error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error: "Failed to fetch medical profile",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const data = await req.json();

    // Keep the legacy single `primaryIssue` in sync with primaryIssues[0] so
    // the matcher + all existing readers stay correct regardless of the client.
    if (Array.isArray(data.primaryIssues)) {
      data.primaryIssue = data.primaryIssues[0] ?? "";
    }

    const medicalProfile = await MedicalProfile.findOneAndUpdate(
      { userId: session.user.id },
      { ...data, profileCompleted: true },
      { new: true, upsert: true },
    );

    return NextResponse.json(medicalProfile);
  } catch (error: unknown) {
    console.error(
      "Update medical profile error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error: "Failed to update medical profile",
        details: error instanceof Error ? error.message : error,
      },
      { status: 500 },
    );
  }
}
