/**
 * Spec 002 — who hears what about a coverage, exactly once.
 *
 * The hourly cron and closure retries can reach these more than once, so every
 * notice is CLAIMED on the coverage before it is sent (a conditional stamp),
 * and the claim is given back when nothing could be sent — the next pass
 * retries instead of the notice being lost.
 */
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import Organization from "@/models/Organization";
import OrganizationCoverage from "@/models/OrganizationCoverage";
import User from "@/models/User";
import { resolveAppointmentRecipient } from "@/lib/guardian-utils";
import {
  sendAdminCoverageCapWarning,
  sendClientCoverageCapEmail,
  sendClientCoverageConfirmedEmail,
} from "@/lib/notifications";

type ClientContact = {
  firstName?: string;
  lastName?: string;
  email?: string;
  language?: string;
};

const localeOf = (lang?: string): "fr" | "en" => (lang === "en" ? "en" : "fr");
const nameOf = (c: ClientContact) => `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();

/** After an admin confirms a declaration: tell the person the sessions are covered. */
export async function notifyCoverageConfirmed(appointmentId: string): Promise<boolean> {
  await connectToDatabase();
  const apt = await Appointment.findById(appointmentId)
    .select("clientId bookingFor lovedOneInfo payerDeclaration")
    .populate("clientId", "firstName lastName email language")
    .lean();
  const coverageId = apt?.payerDeclaration?.coverageId;
  if (!apt || !coverageId) return false;
  const coverage = await OrganizationCoverage.findById(coverageId)
    .select("organizationId maxSessions")
    .lean();
  const org = coverage
    ? await Organization.findById(coverage.organizationId).select("name").lean()
    : null;
  if (!org) return false;

  const client = apt.clientId as unknown as ClientContact & { _id: unknown };
  // LSSSS art. 14: an adult loved one's mail goes to them, not the guardian.
  const recipient = resolveAppointmentRecipient(
    { bookingFor: apt.bookingFor, lovedOneInfo: apt.lovedOneInfo },
    {
      firstName: client.firstName ?? "",
      lastName: client.lastName ?? "",
      email: client.email ?? "",
      language: client.language,
    },
  );
  if (!recipient.email) return false;
  return sendClientCoverageConfirmedEmail({
    clientEmail: recipient.email,
    clientName: recipient.name,
    organizationName: org.name,
    maxSessions: coverage?.maxSessions ?? null,
    locale: localeOf(recipient.language),
  });
}

/**
 * After a session used one of a capped coverage's slots: warn at one session
 * left (client + team), and tell the client when none are left.
 */
export async function notifyCoverageCap(
  coverageId: string,
  opts: {
    /** Who the session emails go to (the loved one when LSSSS art. 14 says so). */
    recipient?: { email: string; name: string; language: "fr" | "en" } | null;
    now?: Date;
  } = {},
): Promise<{ lastSession: boolean; exhausted: boolean }> {
  const now = opts.now ?? new Date();
  const result = { lastSession: false, exhausted: false };
  await connectToDatabase();
  const coverage = await OrganizationCoverage.findById(coverageId)
    .select("clientId organizationId maxSessions consumedAppointmentIds lastSessionWarningSentAt exhaustedNotifiedAt")
    .lean();
  if (!coverage?.maxSessions) return result;
  const used = coverage.consumedAppointmentIds?.length ?? 0;
  const max = coverage.maxSessions;
  const remaining = max - used;
  if (remaining > 1) return result;

  const stamp = remaining === 1 ? "lastSessionWarningSentAt" : "exhaustedNotifiedAt";
  if (coverage[stamp]) return result;
  const claim = await OrganizationCoverage.updateOne(
    { _id: coverage._id, [stamp]: { $exists: false } },
    { $set: { [stamp]: now } },
  );
  if (claim.modifiedCount !== 1) return result;

  const [org, client] = await Promise.all([
    Organization.findById(coverage.organizationId).select("name").lean(),
    User.findById(coverage.clientId).select("firstName lastName email language").lean() as Promise<ClientContact | null>,
  ]);
  const organizationName = org?.name ?? "";
  const to = opts.recipient?.email
    ? opts.recipient
    : client?.email
      ? { email: client.email, name: nameOf(client) || client.email, language: localeOf(client.language) }
      : null;
  let sent = false;
  if (to) {
    sent = await sendClientCoverageCapEmail({
      kind: remaining === 1 ? "last_session" : "exhausted",
      clientEmail: to.email,
      clientName: to.name,
      organizationName,
      used,
      max,
      locale: to.language,
    });
  }
  if (remaining === 1) {
    const adminSent = await sendAdminCoverageCapWarning({
      clientName: (client && nameOf(client)) || "Client",
      clientId: String(coverage.clientId),
      organizationName,
      used,
      max,
    });
    sent = sent || adminSent;
  }

  if (!sent) {
    // Nobody was told: give the claim back so a later pass retries.
    await OrganizationCoverage.updateOne({ _id: coverage._id }, { $unset: { [stamp]: 1 } });
    return result;
  }
  if (remaining === 1) result.lastSession = true;
  else result.exhausted = true;
  return result;
}
