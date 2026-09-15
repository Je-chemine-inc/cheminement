import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import ContentEntry from "@/models/ContentEntry";
import StoredFile from "@/models/StoredFile";
import { resolveResourceAccess } from "@/lib/resource-access";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

/**
 * GET /api/products/<slug>/file?token=&locale= — the PDF a professional sells
 * (spec 003 phase 5), to the people who bought it (session or the emailed
 * token, through resolveResourceAccess), its professional and admins. A buyer
 * keeps the file after the product is taken down.
 *
 * Always an attachment under a fixed name, never cached, never sniffed, in a
 * sandbox. 403 without access; 404 for no such product or file.
 */
export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

type Row = { locale: "fr" | "en"; productFileId?: unknown; ownerProfessionalId?: unknown };

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (!rateLimit(`product-file:${getClientIp(req)}`, 60, 60 * 1000).allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const { slug } = await params;
  if (!SLUG.test(slug)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await connectToDatabase();
  const rows = await ContentEntry.find({
    kind: "resource",
    slug,
    productType: "pdf",
    ownerProfessionalId: { $exists: true },
  })
    .select("locale productFileId ownerProfessionalId")
    .lean<Row[]>();
  if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const session = await getServerSession(authOptions);
  const isOwnerOrAdmin =
    session?.user?.isAdmin === true || (session?.user?.id && String(rows[0].ownerProfessionalId) === session.user.id);
  if (!isOwnerOrAdmin) {
    const access = await resolveResourceAccess(slug, { isPremium: true, token: req.nextUrl.searchParams.get("token") });
    if (!access.granted) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const locale = req.nextUrl.searchParams.get("locale") === "en" ? "en" : "fr";
  const fileId =
    rows.find((row) => row.locale === locale)?.productFileId ?? rows.find((row) => row.locale === "fr")?.productFileId;
  const file = fileId ? await StoredFile.findOne({ _id: fileId, kind: "product-file" }).lean() : null;
  if (!file || file.scanStatus === "infected") return NextResponse.json({ error: "Not found" }, { status: 404 });

  // A BSON Binary from `.lean()` keeps its bytes under `.buffer` (see /api/files/[id]).
  const raw = file.data as unknown;
  const bytes = Buffer.isBuffer(raw)
    ? raw
    : raw && typeof raw === "object" && "buffer" in raw
      ? Buffer.from((raw as { buffer: Uint8Array }).buffer)
      : Buffer.from(raw as Uint8Array);
  const body = new Uint8Array(bytes);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(body.length),
      "Content-Disposition": `attachment; filename="${slug}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Referrer-Policy": "no-referrer",
    },
  });
}
