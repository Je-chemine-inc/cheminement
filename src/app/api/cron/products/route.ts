import { NextRequest, NextResponse } from "next/server";
import { runProductJobs } from "@/lib/product-jobs";

/**
 * Scheduled from /etc/cron.d/jechemine on the WHC VPS every ten minutes, with
 * `Authorization: Bearer <CRON_SECRET>` (spec 003 phase 5). Takes a product
 * off sale when its professional's account is no longer active — or puts it
 * back when the account is active again — wherever the change of account did
 * not already do it, then reminds webinar buyers the day before and an hour
 * before. Idempotent: each reminder is claimed on its purchase before it goes.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!secret || token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runProductJobs();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("products cron:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
