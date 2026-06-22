import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import MedicalProfile from "@/models/MedicalProfile";
import { authOptions } from "@/lib/auth";
import {
  getActiveAdminPermissions,
  mustMaskClientContactPII,
  applyMedicalProfileContactMask,
} from "@/lib/admin-rbac";
import { logAdminClientAccess } from "@/lib/admin-access-log";
import { professionalCanAccessClient } from "@/lib/professional-client-access";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/medical-profile/[id]">,
) {
  try {
    const session = await getServerSession(authOptions);
    const params = await ctx.params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const userId = params.id;

    // Only allow admins to fetch other users' medical profiles, or users to fetch their own, or professionals to fetch clients they have appointments with
    if (session.user.role !== "admin" && session.user.id !== userId) {
      // Professionals can view the medical profile of a client they have a link
      // with — assigned, proposed (cascade), or in the general pool they can
      // claim — so the request modal's "Informations médicales" tab resolves.
      const allowed =
        session.user.role === "professional" &&
        (await professionalCanAccessClient(session.user.id, userId));
      if (!allowed) {
        return NextResponse.json(
          {
            error:
              "Forbidden: You can only access medical profiles of clients you are linked to",
          },
          { status: 403 },
        );
      }
    }

    const medicalProfile = await MedicalProfile.findOne({ userId });

    if (!medicalProfile) {
      return NextResponse.json(
        { error: "Medical profile not found" },
        { status: 404 },
      );
    }

    if (session.user.role === "admin" && session.user.id !== userId) {
      void logAdminClientAccess({
        actorUserId: session.user.id,
        resourceUserId: userId,
        action: "view_client_medical_profile",
        req,
      });
      const perms = await getActiveAdminPermissions(session.user.id);
      const mask = mustMaskClientContactPII(perms);
      const plain = medicalProfile.toObject() as unknown as Record<
        string,
        unknown
      >;
      return NextResponse.json(applyMedicalProfileContactMask(plain, mask));
    }

    return NextResponse.json(medicalProfile);
  } catch (error: unknown) {
    console.error("Get medical profile by ID error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch medical profile",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
