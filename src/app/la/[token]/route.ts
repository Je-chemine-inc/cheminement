import { NextResponse } from "next/server";
import { isWaitlistOfferToken } from "@/lib/waitlist-rules";

/**
 * www/la/<token> — the short link in a waitlist offer's text message (spec 003
 * phase 4), so the message fits one segment. Sends the person to the claim
 * page; nothing is claimed here. The Location is relative: the scheme behind
 * the proxy is never trusted.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const location = isWaitlistOfferToken(token) ? `/liste-attente/reclamer?t=${token}` : "/";
  return new NextResponse(null, { status: 307, headers: { Location: location, "Cache-Control": "no-store" } });
}
