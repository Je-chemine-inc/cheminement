import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { getActiveAdminPermissions } from "@/lib/admin-rbac";

/**
 * Gate for the team's content screens used by spec 003 phase 5 (professionals'
 * products): an active admin with `manageContent`. Same shape as
 * requireProfessionalsAdmin. The older content routes inline the same check.
 */
export async function requireContentAdmin(): Promise<
  { error: NextResponse; userId?: undefined } | { error?: undefined; userId: string }
> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.isAdmin) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  await connectToDatabase();
  const permissions = await getActiveAdminPermissions(session.user.id);
  if (!permissions?.manageContent) {
    return { error: NextResponse.json({ error: "Forbidden - missing permission: manageContent" }, { status: 403 }) };
  }
  return { userId: session.user.id };
}
