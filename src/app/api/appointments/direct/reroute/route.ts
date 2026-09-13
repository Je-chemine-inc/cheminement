import { NextRequest, NextResponse, after } from "next/server";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { rerouteDirectRequest } from "@/lib/direct-request";
import { routeAppointmentToProfessionals } from "@/lib/appointment-routing";

/**
 * POST /api/appointments/direct/reroute `{ token }` — the client chose "let Je
 * chemine match me" from the email sent after a professional declined their
 * request, or did not answer in time (spec 003 phase 3). No session: the link
 * is the proof. Works once, for 14 days, while no admin has taken the request
 * in hand; 410 otherwise.
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(`direct-reroute:${getClientIp(req)}`, 10, 15 * 60 * 1000).allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  try {
    const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
    const token = typeof body?.token === "string" ? body.token : "";
    const result = await rerouteDirectRequest(token);
    if (!result.ok) {
      return NextResponse.json(
        { error: "This link is no longer valid", code: "LINK_INVALID" },
        { status: 410 },
      );
    }
    after(() =>
      routeAppointmentToProfessionals(result.appointmentId).catch((error) =>
        console.error("[direct-reroute] matching failed:", result.appointmentId, error),
      ),
    );
    return NextResponse.json({ rerouted: true });
  } catch (error) {
    console.error("direct-reroute error:", error);
    return NextResponse.json({ error: "Failed to hand the request to matching" }, { status: 500 });
  }
}
