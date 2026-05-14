import { NextRequest, NextResponse } from "next/server";
import { runAppointmentReminders } from "@/lib/appointment-reminders";

/**
 * Planifier un appel HTTP périodique (cron) avec l'en-tête :
 *   Authorization: Bearer <CRON_SECRET>
 * Fréquence recommandée : toutes les heures (les fenêtres H-72 et H-48 sont
 * de 24 h chacune, ce qui laisse de la marge).
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
