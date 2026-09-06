import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import ContentEntry from "@/models/ContentEntry";
import ResourceEntitlement from "@/models/ResourceEntitlement";
import User from "@/models/User";
import type { ContentLocale } from "@/models/ContentEntry";

/**
 * The signed-in member's purchased resources, for the dashboard library.
 *
 * Returns listing data only — title, summary, thumbnail, date. The paid body
 * is never included here; it is served by /book/[slug], which re-checks
 * entitlement on every request.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const user = await User.findById(session.user.id);
    const email = user?.email?.trim().toLowerCase();

    // Match on the account OR the email they bought as, so a guest purchase
    // shows up even before an account merge has re-pointed it.
    const or: Record<string, unknown>[] = [{ userId: session.user.id }];
    if (email) or.push({ buyerEmail: email });

    const rows = await ResourceEntitlement.find({ status: "paid", $or: or }).sort({
      paidAt: -1,
      createdAt: -1,
    });
    if (rows.length === 0) return NextResponse.json({ items: [] });

    const slugs = [...new Set(rows.map((r) => r.slug))];
    const entries = await ContentEntry.find({
      kind: "resource",
      slug: { $in: slugs },
    });

    const items = rows.map((row) => {
      const locale: ContentLocale = row.locale === "en" ? "en" : "fr";
      const entry =
        entries.find((e) => e.slug === row.slug && e.locale === locale) ??
        entries.find((e) => e.slug === row.slug);
      return {
        slug: row.slug,
        title: entry?.title ?? row.slug,
        summary: entry?.summary ?? "",
        iconUrl: entry?.iconUrl,
        amountCents: row.amountCents,
        purchasedAt: (row.paidAt ?? row.createdAt)?.toISOString(),
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    console.error("[resource] my purchases error:", error);
    return NextResponse.json(
      { error: "Failed to load purchases" },
      { status: 500 },
    );
  }
}
