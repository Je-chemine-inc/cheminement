import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";

/**
 * Après un échec NextAuth (CredentialsSignin), permet d’obtenir la raison précise
 * lorsque le mot de passe est correct (courriel / SMS / permis).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = (body.email as string | undefined)?.toLowerCase().trim();
    const password = body.password as string | undefined;
    if (!email || !password) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    await connectToDatabase();
    const user = await User.findOne({ email });
    if (!user || !user.password) {
      return NextResponse.json({ error: "invalid" }, { status: 401 });
    }

    const passwordOk = await bcrypt.compare(password, user.password);
    if (!passwordOk) {
      return NextResponse.json({ error: "invalid" }, { status: 401 });
    }

    // Self-deactivated accounts (clients & professionals) carry `deactivatedAt`.
    if (user.status === "inactive" && user.deactivatedAt) {
      return NextResponse.json({ code: "AUTH_ACCOUNT_DEACTIVATED" });
    }

    // Inactive client accounts without `deactivatedAt` are auto-provisioned
    // shells that were never claimed (professionals fall through to the
    // license-rejected check below).
    if (user.role === "client" && user.status === "inactive") {
      return NextResponse.json({ code: "AUTH_ACCOUNT_INACTIVE" });
    }

    const sec = user.accountSecurityVersion ?? 0;
    if (sec >= 1 && (user.role === "client" || user.role === "professional")) {
      if (!user.emailVerified) {
        return NextResponse.json({ code: "AUTH_EMAIL_NOT_VERIFIED" });
      }
      if (!user.phoneVerifiedAt) {
        return NextResponse.json({ code: "AUTH_PHONE_NOT_VERIFIED" });
      }
    }

    if (
      user.role === "professional" &&
      user.professionalLicenseStatus === "rejected"
    ) {
      return NextResponse.json({ code: "AUTH_LICENSE_REJECTED" });
    }

    return NextResponse.json({ code: "OK" });
  } catch (e) {
    console.error("login-reason:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
