import { NextRequest, NextResponse } from "next/server";
import { runAppointmentReminders } from "@/lib/appointment-reminders";

/**
 * Planifier un appel HTTP périodique (cron) avec l'en-tête :
 *   Authorization: Bearer <CRON_SECRET>
 * Fréquence : une fois par jour (limite du plan Vercel Hobby). Les fenêtres
 * H-72 (24 h) et H-48 (48 h) avec drapeaux de déduplication garantissent
 * qu'un passage quotidien capte chaque rendez-vous une seule fois.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!secret || token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runAppointmentReminders();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    console.error("appointment-reminders cron:", e);
    return NextResponse.json(
      {
        error: "Failed",
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
