import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Admin from "@/models/Admin";
import { emailTransportStatus, resolveFromAddress } from "@/lib/email-transport";
import { getEmailSettings } from "@/lib/notifications";

/**
 * Admin diagnostic endpoint — answers "why aren't my emails sending?"
 * without exposing any secret values. Returns:
 *   - backend: "mailgun" | "smtp" | "none"  (which transport will be used)
 *   - configured: boolean                    (any transport reachable at all)
 *   - globallyEnabled: boolean               (admin email-notifications toggle)
 *   - mailFrom: string                       (effective From address)
 *   - envVars: { name: boolean }             (which env vars are populated;
 *                                            never the values themselves)
 *
 * Use it from the prod host to confirm Vercel env vars are loaded — if
 * `backend === "none"` and every `envVars` entry is false, the transport
 * never had a chance to send.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectToDatabase();
  const adminRecord = await Admin.findOne({
    userId: session.user.id,
    isActive: true,
  })
    .select("permissions")
    .lean();
  if (!adminRecord) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const transport = emailTransportStatus();
  const settings = await getEmailSettings();

  return NextResponse.json({
    backend: transport.backend,
    configured: transport.configured,
    globallyEnabled: settings.enabled,
    mailFrom: resolveFromAddress(
      undefined,
      settings.branding?.companyName ?? undefined,
    ),
    nodeEnv: process.env.NODE_ENV,
    envVars: {
      MAILGUN_API_KEY: Boolean(process.env.MAILGUN_API_KEY),
      MAILGUN_DOMAIN: Boolean(process.env.MAILGUN_DOMAIN),
      MAILGUN_WEBHOOK_SIGNING_KEY: Boolean(
        process.env.MAILGUN_WEBHOOK_SIGNING_KEY,
      ),
      MAILGUN_REGION: Boolean(process.env.MAILGUN_REGION),
      SMTP_HOST: Boolean(process.env.SMTP_HOST),
      SMTP_PORT: Boolean(process.env.SMTP_PORT),
      SMTP_USER: Boolean(process.env.SMTP_USER),
      SMTP_PASS: Boolean(process.env.SMTP_PASS),
      MAIL_FROM: Boolean(process.env.MAIL_FROM),
      MAIL_FROM_NAME: Boolean(process.env.MAIL_FROM_NAME),
      SUPPORT_EMAIL: Boolean(process.env.SUPPORT_EMAIL),
    },
  });
}
