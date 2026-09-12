import { NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import User from "@/models/User";
import type { ServiceResult } from "@/lib/showcase-service";

/**
 * The HTTP side of the showcase routes (spec 003): who may edit a page as a
 * professional, and how a service result becomes a response.
 */

/** A signed-in professional whose account is approved and active. */
export async function requireShowcaseProfessional(): Promise<
  { error: NextResponse; userId?: undefined } | { error?: undefined; userId: string }
> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== "professional") {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  await connectToDatabase();
  const user = await User.findById(session.user.id).select("status adminApproved").lean();
  if (!user || user.status !== "active" || user.adminApproved !== true) {
    return { error: NextResponse.json({ error: "ACCOUNT_NOT_ACTIVE" }, { status: 403 }) };
  }
  return { userId: session.user.id };
}

/**
 * A failure becomes `{ error: CODE, ...details }` with its status. A success
 * schedules its emails after the response and answers with `then`'s result.
 */
export async function respondShowcase<T>(
  result: ServiceResult<T>,
  then?: (value: T) => Promise<unknown> | unknown,
): Promise<NextResponse> {
  if (!result.ok) {
    return NextResponse.json(
      { error: result.code, ...(result.details ?? {}) },
      { status: result.status },
    );
  }
  for (const task of result.deferred) {
    after(() =>
      task().catch((error) => console.error("[showcase] notification failed:", error)),
    );
  }
  const body = then ? await then(result.value) : null;
  return NextResponse.json(body ?? { ok: true });
}
