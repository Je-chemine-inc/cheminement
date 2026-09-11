import { NextResponse } from "next/server";
import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { getActiveAdminPermissions } from "@/lib/admin-rbac";

/**
 * Gate for every organization-billing admin action (spec 002): an active admin
 * with `manageBilling`. Same shape as `requireContentAdmin` in pro-catalog.ts.
 */
export async function requireBillingAdmin(): Promise<
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
  if (!permissions?.manageBilling) {
    return {
      error: NextResponse.json(
        { error: "Forbidden - missing permission: manageBilling" },
        { status: 403 },
      ),
    };
  }
  return { session };
}
