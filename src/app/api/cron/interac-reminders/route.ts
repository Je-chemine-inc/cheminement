import { NextRequest, NextResponse } from "next/server";
import { runInteracReminders } from "@/lib/interac-reminders";

/**
 * Appel périodique (cron toutes les heures) :
 *   Authorization: Bearer <CRON_SECRET>
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!secret || token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runInteracReminders();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    console.error("interac-reminders cron:", e);
    return NextResponse.json(
      { error: "Failed", details: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
