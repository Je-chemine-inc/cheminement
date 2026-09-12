import { NextResponse } from "next/server";
import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { getActiveAdminPermissions } from "@/lib/admin-rbac";

/**
 * Gate for the screens that decide what the public sees of a professional
 * (spec 003's showcase pages): an active admin with `manageProfessionals`.
 * Same shape as `requireBillingAdmin`. Fails closed: no Admin record, an
 * inactive one, or another permission is 403. Connects to the database.
 *
 * The first route to enforce `manageProfessionals` — the permission existed,
 * editable on the admins screen, but no route read it until now.
 */
export async function requireProfessionalsAdmin(): Promise<
  { error: NextResponse; session?: undefined } | { error?: undefined; session: Session }
> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.isAdmin) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  await connectToDatabase();
  const permissions = await getActiveAdminPermissions(session.user.id);
  if (!permissions?.manageProfessionals) {
    return {
      error: NextResponse.json(
        { error: "Forbidden - missing permission: manageProfessionals" },
        { status: 403 },
      ),
    };
  }
  return { session };
}
