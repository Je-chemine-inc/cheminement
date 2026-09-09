import { NextRequest, NextResponse } from "next/server";
import { runPaymentGuaranteeReminders } from "@/lib/payment-guarantee-reminders";

/**
 * Planifier un appel HTTP périodique (cron) avec l’en-tête :
 *   Authorization: Bearer <CRON_SECRET>
 * Ici : /etc/cron.d/jechemine sur le VPS (via run-cron.sh).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!secret || token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runPaymentGuaranteeReminders();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    console.error("payment-guarantee-reminders cron:", e);
    return NextResponse.json(
      {
        error: "Failed",
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
