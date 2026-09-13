import "server-only";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import Appointment, { type IAppointment } from "@/models/Appointment";
import User from "@/models/User";
import { calculateAppointmentPricing, type PricingResult } from "@/lib/pricing";
import { isShowcaseEnabled } from "@/lib/showcase-settings";
import { isShowcaseSlotFree, loadBookableShowcase } from "@/lib/showcase-booking";
import { slotStartsAt } from "@/lib/available-slots";
import { parseAppointmentDate } from "@/lib/appointment-date";
import {
  acquireSlotHold,
  attachSlotHoldToAppointment,
  convertOfferHoldToRequest,
  releaseSlotHold,
} from "@/lib/slot-holds";
import {
  DIRECT_REQUEST_REROUTE_TOKEN_DAYS,
  directRequestDeadline,
  directRequestExcludesProfessional,
  type DirectRequestDeclineReason,
  type DirectRequestErrorCode,
} from "@/lib/direct-request-rules";
import type { DirectIntent } from "@/lib/appointment-writable-fields";
import { generateUrlToken, hashVerificationSecret } from "@/lib/account-init";
import { absoluteShowcaseUrl } from "@/lib/showcase-hosts";
import { resolveAppointmentRecipient } from "@/lib/guardian-utils";
import {
  sendAdminDirectRequestReturnedAlert,
  sendDirectRequestConfirmationEmail,
  sendDirectRequestReceivedEmail,
  sendDirectRequestUnavailableEmail,
} from "@/lib/notifications";

/**
 * A request for one professional's slot, sent from their showcase page (spec
 * 003 phase 3).
 *
 * The lifecycle: the booking routes `prepare` the request — the page is
 * published, the consultation offered, the time still free — and HOLD the slot
 * before anything is written. The row is proposed to that professional alone,
 * like request-with-current-pro: `routingStatus: "proposed"`, `proposedTo`,
 * `professionalId` unset. The matcher never sees it. The professional accepts
 * (accept-direct: accepted and scheduled in one claim) or declines; a client may
 * withdraw it; past `respondBy` it expires. A declined or expired request goes
 * back to the admin queue, and the client is emailed two ways on: another time,
 * or Je chemine's matching through a hashed, 14-day link.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const REROUTE_TOKEN = /^[a-f0-9]{64}$/;

export type DirectRequestFailure = {
  ok: false;
  status: 404 | 409;
  code: Exclude<DirectRequestErrorCode, "INVALID_DIRECT_REQUEST">;
};

export interface PreparedDirectRequest {
  ok: true;
  holdId: string;
  professionalId: string;
  pricing: PricingResult;
  /** Written over the new appointment: routing, the slot, and the request itself. */
  fields: {
    status: "pending";
    routingStatus: "proposed";
    proposedTo: mongoose.Types.ObjectId[];
    proposedAt: Date;
    date: Date;
    time: string;
    duration: number;
    therapyType: "solo" | "couple" | "group";
    isEmergency?: true;
    directRequest: {
      showcaseSlug: string;
      cityKey: string;
      service: DirectIntent["service"];
      source: "showcase" | "waitlist";
      dayKey: string;
      time: string;
      startsAt: Date;
      professionalId: mongoose.Types.ObjectId;
      professionalName: string;
      holdId: mongoose.Types.ObjectId;
      respondBy: Date;
      state: "pending";
      waitlistEntryId?: mongoose.Types.ObjectId;
    };
  };
}

function fail(status: 404 | 409, code: DirectRequestFailure["code"]): DirectRequestFailure {
  return { ok: false, status, code };
}

/**
 * Check a visitor's chosen time and hold it. Nothing is written to the
 * appointment here: the caller saves the row with `fields`, then calls
 * attachDirectRequest — or abandonDirectRequest if the save fails.
 *
 * A quick consultation is booked as a solo session, flagged `isEmergency`
 * (the "consultation ponctuelle rapide" the rest of the platform knows), with
 * its own length and price.
 *
 * A claimed waitlist offer (phase 4) already holds its time: `waitlist` names
 * the entry and that hold, which is converted into the request's hold instead
 * of a new one being taken.
 */
export async function prepareDirectRequest(input: {
  intent: DirectIntent;
  therapyType: "solo" | "couple" | "group";
  now?: Date;
  waitlist?: { entryId: string; holdId: string };
}): Promise<PreparedDirectRequest | DirectRequestFailure> {
  const now = input.now ?? new Date();
  const { intent, waitlist } = input;
  if (!(await isShowcaseEnabled())) return fail(404, "SHOWCASE_NOT_FOUND");

  const bookable = await loadBookableShowcase(intent.slug);
  if (!bookable) return fail(404, "SHOWCASE_NOT_FOUND");
  const offer = bookable.services[intent.service];
  if (!offer.offered) return fail(409, "SERVICE_UNAVAILABLE");
  const free = await isShowcaseSlotFree(bookable, intent.service, intent.date, intent.time, now, {
    exceptHoldId: waitlist?.holdId,
  });
  if (!free) return fail(409, "SLOT_TAKEN");

  const startsAt = slotStartsAt(intent.date, intent.time);
  const respondBy = startsAt ? directRequestDeadline({ now, startsAt, service: intent.service }) : null;
  const date = parseAppointmentDate(intent.date);
  if (!startsAt || !respondBy || !date) return fail(409, "SLOT_TAKEN");

  const quick = intent.service === "quick";
  const therapyType = quick ? "solo" : input.therapyType;
  const pricing = await calculateAppointmentPricing(bookable.professionalId, therapyType, { quick });

  // Last check, first write: the hold's unique index is the lock. It lasts as
  // long as the professional has to answer.
  let holdId: string;
  if (waitlist) {
    const converted = await convertOfferHoldToRequest({
      holdId: waitlist.holdId,
      waitlistEntryId: waitlist.entryId,
      expiresAt: respondBy,
      now,
    });
    if (!converted) return fail(409, "SLOT_TAKEN");
    holdId = waitlist.holdId;
  } else {
    const hold = await acquireSlotHold({
      professionalId: bookable.professionalId,
      dayKey: intent.date,
      time: intent.time,
      startsAt,
      durationMinutes: offer.durationMinutes,
      kind: "direct_request",
      expiresAt: respondBy,
      now,
    });
    if (!hold.ok) return fail(409, "SLOT_TAKEN");
    holdId = hold.holdId;
  }

  const professional = new mongoose.Types.ObjectId(bookable.professionalId);
  return {
    ok: true,
    holdId,
    professionalId: bookable.professionalId,
    pricing,
    fields: {
      status: "pending",
      routingStatus: "proposed",
      proposedTo: [professional],
      proposedAt: now,
      date,
      time: intent.time,
      duration: offer.durationMinutes,
      therapyType,
      ...(quick ? { isEmergency: true as const } : {}),
      directRequest: {
        showcaseSlug: bookable.slug,
        cityKey: bookable.cityKey,
        service: intent.service,
        source: waitlist ? "waitlist" : "showcase",
        dayKey: intent.date,
        time: intent.time,
        startsAt,
        professionalId: professional,
        professionalName: bookable.displayName,
        holdId: new mongoose.Types.ObjectId(holdId),
        respondBy,
        state: "pending",
        ...(waitlist ? { waitlistEntryId: new mongoose.Types.ObjectId(waitlist.entryId) } : {}),
      },
    },
  };
}

/** The request is saved: record it on its hold. */
export async function attachDirectRequest(prepared: PreparedDirectRequest, appointmentId: string): Promise<void> {
  await attachSlotHoldToAppointment(prepared.holdId, appointmentId);
}

/** The request could not be saved: give the slot back at once. */
export async function abandonDirectRequest(prepared: PreparedDirectRequest): Promise<void> {
  await releaseSlotHold(prepared.holdId).catch((error) =>
    console.error("[direct-request] hold not released after a failed save:", error),
  );
}

export type DirectRequestReleaseOutcome = "declined" | "expired" | "withdrawn";

/**
 * Close a pending request other than by accepting it, and free its slot.
 * Declined and expired requests return to the admin queue with their date and
 * time cleared (so assign and re-matching work as for any request), carry a
 * fresh reroute token for the client's email, and — unless only the time did
 * not suit — keep the matcher from proposing this client to that professional
 * again. A withdrawn request is cancelled by the client.
 *
 * One atomic claim on `state: "pending"`: of a decline, a timeout and a
 * withdrawal racing, exactly one wins. Null when another already did, when the
 * request is not pending, or when a decline comes from anyone but the
 * professional asked.
 */
export async function releaseDirectRequest(input: {
  appointmentId: string;
  outcome: DirectRequestReleaseOutcome;
  /** Required for a decline: only the professional asked may decline. */
  professionalId?: string;
  reason?: DirectRequestDeclineReason;
  note?: string;
  now?: Date;
}): Promise<{ appointment: IAppointment; rerouteToken: string | null } | null> {
  if (!mongoose.Types.ObjectId.isValid(input.appointmentId)) return null;
  await connectToDatabase();
  const now = input.now ?? new Date();

  const current = await Appointment.findById(input.appointmentId)
    .select("directRequest status professionalId")
    .lean<{ directRequest?: IAppointment["directRequest"] } | null>();
  const request = current?.directRequest;
  if (!request || request.state !== "pending") return null;

  const filter: Record<string, unknown> = {
    _id: input.appointmentId,
    status: "pending",
    professionalId: null,
    "directRequest.state": "pending",
  };
  if (input.outcome === "declined") {
    if (!input.professionalId || String(request.professionalId) !== input.professionalId) return null;
    filter["directRequest.professionalId"] = request.professionalId;
  }
  if (input.outcome === "expired") filter["directRequest.respondBy"] = { $lte: now };

  let update: Record<string, unknown>;
  let rerouteToken: string | null = null;
  if (input.outcome === "withdrawn") {
    update = {
      $set: {
        status: "cancelled",
        cancelledBy: "client",
        cancelledAt: now,
        cancelReason: "direct_request_withdrawn",
        "directRequest.state": "withdrawn",
        "directRequest.answeredAt": now,
      },
      $unset: { proposedTo: "", proposedAt: "" },
    };
  } else {
    rerouteToken = generateUrlToken();
    const set: Record<string, unknown> = {
      routingStatus: "awaiting_admin",
      "directRequest.state": input.outcome,
      "directRequest.answeredAt": now,
      "directRequest.rerouteTokenHash": hashVerificationSecret(rerouteToken),
      "directRequest.rerouteTokenExpiresAt": new Date(now.getTime() + DIRECT_REQUEST_REROUTE_TOKEN_DAYS * DAY_MS),
    };
    if (input.outcome === "declined") {
      if (input.reason) set["directRequest.declineReason"] = input.reason;
      const note = input.note?.trim();
      if (note) set["directRequest.declineNote"] = note;
    }
    update = { $set: set, $unset: { date: "", time: "", proposedTo: "", proposedAt: "" } };
    if (directRequestExcludesProfessional(input.outcome, input.reason)) {
      update.$addToSet = { refusedBy: request.professionalId };
    }
  }

  const appointment = await Appointment.findOneAndUpdate(filter, update, { new: true });
  if (!appointment) return null;
  if (request.holdId) {
    await releaseSlotHold(String(request.holdId), { appointmentId: input.appointmentId }).catch((error) =>
      console.error("[direct-request] hold not released:", error),
    );
  }
  return { appointment, rerouteToken };
}

function appUrl(path: string): string {
  const base = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base}${path}`;
}

type ClientDoc = { firstName?: string; lastName?: string; email?: string; language?: string } | null;

/** "Amel S." — enough for an email; the full name is on the dashboard. */
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts[0]} ${parts[parts.length - 1][0]?.toUpperCase() ?? ""}.`;
}

async function loadForEmail(appointmentId: string) {
  await connectToDatabase();
  const appointment = await Appointment.findById(appointmentId).populate("clientId", "firstName lastName email language");
  const request = appointment?.directRequest;
  if (!appointment || !request) return null;
  const client = appointment.clientId as unknown as ClientDoc;
  const recipient = client?.email
    ? resolveAppointmentRecipient(
        { bookingFor: appointment.bookingFor, lovedOneInfo: appointment.lovedOneInfo },
        { firstName: client.firstName, lastName: client.lastName, email: client.email, language: client.language },
      )
    : null;
  return { appointment, request, recipient };
}

async function settle(tasks: Promise<unknown>[]): Promise<void> {
  for (const result of await Promise.allSettled(tasks)) {
    if (result.status === "rejected") console.error("[direct-request] email failed:", result.reason);
  }
}

/** A request was saved: tell the professional, and confirm to the client. */
export async function notifyDirectRequestCreated(appointmentId: string): Promise<void> {
  const loaded = await loadForEmail(appointmentId);
  if (!loaded) return;
  const { request, recipient } = loaded;
  const professional = await User.findById(request.professionalId)
    .select("firstName lastName email language")
    .lean();
  const tasks: Promise<unknown>[] = [];
  if (professional?.email) {
    tasks.push(
      sendDirectRequestReceivedEmail({
        professionalName: `${professional.firstName ?? ""} ${professional.lastName ?? ""}`.trim(),
        professionalEmail: professional.email,
        clientName: shortName(recipient?.name ?? ""),
        service: request.service,
        dayKey: request.dayKey,
        time: request.time,
        respondBy: request.respondBy,
        locale: professional.language,
      }),
    );
  }
  if (recipient) {
    tasks.push(
      sendDirectRequestConfirmationEmail({
        clientName: recipient.name,
        clientEmail: recipient.email,
        professionalName: request.professionalName,
        service: request.service,
        dayKey: request.dayKey,
        time: request.time,
        respondBy: request.respondBy,
        locale: recipient.language,
      }),
    );
  }
  await settle(tasks);
}

/** A request was declined or expired: the client's two ways on, and the team's alert. */
export async function notifyDirectRequestReleased(appointmentId: string, rerouteToken: string | null): Promise<void> {
  if (!rerouteToken) return;
  const loaded = await loadForEmail(appointmentId);
  if (!loaded) return;
  const { request, recipient } = loaded;
  if (request.state !== "declined" && request.state !== "expired") return;
  const outcome = request.state;
  const tasks: Promise<unknown>[] = [];
  if (recipient) {
    tasks.push(
      sendDirectRequestUnavailableEmail({
        clientName: recipient.name,
        clientEmail: recipient.email,
        professionalName: request.professionalName,
        outcome,
        service: request.service,
        dayKey: request.dayKey,
        time: request.time,
        pageUrl: absoluteShowcaseUrl(request.cityKey, `/${request.showcaseSlug}`),
        rerouteUrl: appUrl(`/demande-directe/rejumeler?t=${rerouteToken}`),
        locale: recipient.language,
      }),
    );
  }
  tasks.push(
    sendAdminDirectRequestReturnedAlert({
      outcome,
      clientName: recipient?.name ?? "Client",
      professionalName: request.professionalName,
      service: request.service,
      dayKey: request.dayKey,
      time: request.time,
      reason: request.declineReason ?? null,
      note: request.declineNote ?? null,
    }),
  );
  await settle(tasks);
}

/**
 * Expire every pending request past its deadline. Run with the proposal
 * timeouts (hourly cron and the lazy trigger); idempotent through the claim.
 */
export async function runDirectRequestTimeouts(now: Date = new Date()): Promise<{ expired: number }> {
  await connectToDatabase();
  const due = await Appointment.find({
    status: "pending",
    "directRequest.state": "pending",
    "directRequest.respondBy": { $lte: now },
  })
    .select("_id")
    .limit(200)
    .lean<{ _id: unknown }[]>();

  let expired = 0;
  for (const row of due) {
    const id = String(row._id);
    const released = await releaseDirectRequest({ appointmentId: id, outcome: "expired", now });
    if (!released) continue;
    expired++;
    await notifyDirectRequestReleased(id, released.rerouteToken).catch((error) =>
      console.error("[direct-request] expiry emails failed:", id, error),
    );
  }
  return { expired };
}

/**
 * The client chose "let Je chemine match me" from their email. Hands a
 * declined or expired request back to the ordinary matching, once, while the
 * link is valid and no admin has taken the request in hand. The caller runs
 * the matcher.
 */
export async function rerouteDirectRequest(
  token: string,
  now: Date = new Date(),
): Promise<{ ok: true; appointmentId: string } | { ok: false }> {
  if (typeof token !== "string" || !REROUTE_TOKEN.test(token)) return { ok: false };
  await connectToDatabase();
  const claimed = await Appointment.findOneAndUpdate(
    {
      "directRequest.rerouteTokenHash": hashVerificationSecret(token),
      "directRequest.rerouteTokenExpiresAt": { $gt: now },
      "directRequest.state": { $in: ["declined", "expired"] },
      status: "pending",
      routingStatus: "awaiting_admin",
      professionalId: null,
    },
    {
      $set: { "directRequest.state": "rerouted", routingStatus: "pending" },
      $unset: { "directRequest.rerouteTokenHash": "", "directRequest.rerouteTokenExpiresAt": "" },
    },
    { new: true },
  ).select("_id");
  return claimed ? { ok: true, appointmentId: String(claimed._id) } : { ok: false };
}
