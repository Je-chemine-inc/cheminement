import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getInteracDepositEmail } from "@/lib/interac-deposit-email";

/**
 * The inbound mailboxes the platform receives mail in (support@, paiement@, …).
 * Powers the Réception panel's per-mailbox filter so BOTH boxes always show —
 * even one with no mail yet. Sourced from INBOUND_MAILBOXES (the sync fetcher's
 * list) plus the two canonical inboxes (support = MAIL_FROM, payment = the
 * Interac deposit email). Addresses only — never the passwords.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const set = new Set<string>();
  const add = (v?: string | null) => {
    const t = v?.trim().toLowerCase();
    if (t) set.add(t);
  };

  const raw = process.env.INBOUND_MAILBOXES;
  if (raw) {
    try {
      const list = JSON.parse(raw) as Array<{ user?: string }>;
      for (const acc of list) add(acc?.user);
    } catch {
      // Malformed env — fall through to the canonical inboxes below.
    }
  }
  add(process.env.SMTP_USER || process.env.MAIL_FROM);
  try {
    add(await getInteracDepositEmail());
  } catch {
    // Non-fatal — the DB read is best-effort.
  }

  return NextResponse.json({ mailboxes: Array.from(set).sort() });
}
