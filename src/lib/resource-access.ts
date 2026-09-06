/**
 * "May this visitor read this premium resource?"
 *
 * The single authority. The reader page calls it; nothing else should answer
 * the question independently, because two implementations of a paywall drift
 * and the drift is a bypass.
 *
 * Three ways in:
 *   free    — the entry is not premium at all
 *   member  — a signed-in buyer, matched by user id (or by the email they
 *             bought as, for a guest purchase not yet merged into the account)
 *   token   — a guest following the unguessable link from their receipt email
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import ResourceEntitlement from "@/models/ResourceEntitlement";

export type AccessVia = "free" | "member" | "token" | null;

export interface ResourceAccessResult {
  granted: boolean;
  via: AccessVia;
  /** Present when access came from a real purchase — used to show "you own this". */
  entitlementId?: string;
}

const DENIED: ResourceAccessResult = { granted: false, via: null };

/** A 64-hex bearer token. Anything else is not worth a database round-trip. */
function isWellFormedToken(token: unknown): token is string {
  return typeof token === "string" && /^[0-9a-f]{64}$/.test(token);
}

export async function resolveResourceAccess(
  slug: string,
  opts: { isPremium: boolean; token?: string | null },
): Promise<ResourceAccessResult> {
  if (!opts.isPremium) return { granted: true, via: "free" };
  if (!slug) return DENIED;

  await connectToDatabase();

  // 1. Signed-in member.
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  const sessionEmail = session?.user?.email?.trim().toLowerCase();

  if (userId || sessionEmail) {
    const or: Record<string, unknown>[] = [];
    if (userId) or.push({ userId });
    // Covers the gap between "bought as a guest" and "accounts merged": the
    // person is provably the same email, so they keep what they paid for.
    if (sessionEmail) or.push({ buyerEmail: sessionEmail });

    const owned = await ResourceEntitlement.findOne({
      slug,
      status: "paid",
      $or: or,
    });
    if (owned) {
      await touch(owned._id);
      return { granted: true, via: "member", entitlementId: String(owned._id) };
    }
  }

  // 2. Guest bearer token.
  if (isWellFormedToken(opts.token)) {
    // `slug` is part of the query on purpose: without it, a token bought for
    // one resource would open every other one.
    const byToken = await ResourceEntitlement.findOne({
      slug,
      accessToken: opts.token,
      status: "paid",
    });
    if (byToken && !isExpired(byToken.accessTokenExpiry)) {
      await touch(byToken._id);
      return { granted: true, via: "token", entitlementId: String(byToken._id) };
    }
  }

  return DENIED;
}

/**
 * Purchases do not expire, so this is normally unset. Honoured anyway so a
 * future time-boxed product needs no migration and no new check.
 */
function isExpired(expiry: Date | undefined | null): boolean {
  return expiry instanceof Date && expiry.getTime() <= Date.now();
}

/**
 * Access telemetry. An unbounded bearer token needs *some* visibility, and a
 * shared link shows up here as an access count far above one reader.
 *
 * Never allowed to break a read: a buyer who paid must see their content even
 * if this write fails.
 */
async function touch(id: unknown): Promise<void> {
  try {
    await ResourceEntitlement.updateOne(
      { _id: id },
      { $set: { lastAccessedAt: new Date() }, $inc: { accessCount: 1 } },
    );
  } catch (err) {
    console.error("[resource] failed to record access", err);
  }
}
