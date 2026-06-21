import { NextRequest, NextResponse } from "next/server";
import { runProposalTimeouts } from "@/lib/proposal-timeout";

/**
 * Daily cron (Vercel Hobby plan allows daily crons only). Call with header:
 * Authorization: Bearer <CRON_SECRET>.
 * Advances targeted proposals left unanswered past their window (24h regular /
 * 12h urgent "Consultation ponctuelle rapide"), treating the silence like a
 * refusal (cascade advances; matcher re-runs). The cutoff is exact, but with a
 * daily run a lapsed proposal is detected up to ~24h late. Idempotent via the
 * atomic claim in the lib.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!secret || token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // The accept-stage deadline (24h regular / 12h urgent) is HARD: a lapsed
    // proposal advances the cascade exactly like a refusal (§3). No separate soft
    // accept-alert — the take-charge 12h soft reminder lives on its own cron.
    const result = await runProposalTimeouts();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    console.error("proposal-timeouts cron:", e);
    return NextResponse.json(
      {
        error: "Failed",
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
