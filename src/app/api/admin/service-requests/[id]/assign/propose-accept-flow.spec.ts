/**
 * Integration test for the guest-booking propose → accept flow.
 *
 * Drives the REAL admin-assign and professional-accept route handlers with the
 * DB / auth / email layers mocked (no DB writes, no emails sent). Verifies:
 *   1. Admin assign PROPOSES (routingStatus "proposed", proposedTo=[pro]) and
 *      does NOT lock in a professional or send the jumelage/match email.
 *   2. The proposed professional can then ACCEPT (guards pass), which flips the
 *      appointment to "scheduled"/"accepted" and fires the jumelage + payment
 *      email at that point.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// 24-hex ids so the real mongoose ObjectId.isValid()/constructor accept them.
const APPT_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const PRO_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";
const CLIENT_ID = "cccccccccccccccccccccccc";
const ADMIN_ID = "dddddddddddddddddddddddd";
const NEW_PRO_ID = "eeeeeeeeeeeeeeeeeeeeeeee";

const h = vi.hoisted(() => {
  const notif = {
    sendProfessionalNotification: vi.fn().mockResolvedValue(true),
    sendJumelageSuccessEmail: vi.fn().mockResolvedValue(true),
    sendGuestPaymentConfirmation: vi.fn().mockResolvedValue(true),
    sendPaymentInvitation: vi.fn().mockResolvedValue(true),
    sendAppointmentTakenNotification: vi.fn().mockResolvedValue(true),
    sendAdminAppointmentMovedToGeneralAlert: vi.fn().mockResolvedValue(true),
    sendMatchUpdatedEmail: vi.fn().mockResolvedValue(true),
  };
  const getServerSession = vi.fn();
  const store: { appointment: Record<string, unknown> } = { appointment: {} };

  // Minimal chainable query stub: awaitable AND supports .populate()/.select()/.lean()
  const makeQuery = (result: unknown) => ({
    populate() {
      return this;
    },
    select() {
      return this;
    },
    lean() {
      return Promise.resolve(result);
    },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve(result).then(res, rej);
    },
  });

  return { notif, getServerSession, store, makeQuery };
});

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
  // Run after() callbacks synchronously so we can assert which emails fired.
  after: (cb: () => unknown) => {
    const r = cb();
    if (r && typeof (r as Promise<unknown>).catch === "function") {
      (r as Promise<unknown>).catch(() => {});
    }
  },
}));

vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/notifications", () => h.notif);
vi.mock("@/lib/pricing", () => ({
  calculateAppointmentPricing: vi.fn().mockResolvedValue({
    sessionPrice: 120,
    platformFee: 20,
    professionalPayout: 100,
  }),
}));
vi.mock("@/lib/provision-guest-as-client", () => ({
  provisionGuestAsClient: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/guardian-utils", () => ({
  resolveAppointmentRecipient: () => ({
    name: "Alex Test",
    email: "client@example.com",
    language: "en",
  }),
}));
vi.mock("@/lib/client-portal-urls", () => ({
  resolveBillingUrl: vi.fn().mockResolvedValue("https://app.test/pay?token=tok"),
}));

vi.mock("@/models/Admin", () => ({
  default: { findOne: () => Promise.resolve({ permissions: { manageUsers: true } }) },
}));
vi.mock("@/models/User", () => ({
  default: {
    findOne: (q: { _id?: string }) =>
      Promise.resolve({
        _id: q?._id ?? PRO_ID,
        firstName: "Dr",
        lastName: "Pro",
        email: "pro@example.com",
      }),
    findById: (id: string) =>
      h.makeQuery(
        String(id) === CLIENT_ID
          ? {
              _id: CLIENT_ID,
              firstName: "Alex",
              lastName: "Test",
              email: "client@example.com",
              language: "en",
              role: "prospect",
              status: "prospect",
            }
          : { _id: PRO_ID, firstName: "Dr", lastName: "Pro", email: "pro@example.com" },
      ),
    find: () => h.makeQuery([]),
  },
}));
vi.mock("@/models/Appointment", () => ({
  default: {
    findById: () => h.makeQuery(h.store.appointment),
    findByIdAndUpdate: (_id: string, update: Record<string, unknown>) => {
      const u = update as Record<string, Record<string, unknown>>;
      if (u.$set || u.$unset || u.$addToSet) {
        if (u.$set) Object.assign(h.store.appointment, u.$set);
        if (u.$unset)
          for (const k of Object.keys(u.$unset)) delete h.store.appointment[k];
        if (u.$addToSet)
          for (const [k, v] of Object.entries(u.$addToSet)) {
            const arr = (h.store.appointment[k] ||= []) as unknown[];
            if (!arr.includes(v)) arr.push(v);
          }
      } else {
        Object.assign(h.store.appointment, update);
      }
      return h.makeQuery(h.store.appointment);
    },
    // Atomic claim used by the accept route. The filter asserts the request is
    // still unassigned + pending; the seeded appointment satisfies it, so we
    // apply the update and return the doc (a real lost-race would return null).
    // Operator-aware ($set/$unset/$addToSet) to mirror Mongoose, since the accept
    // route now uses $set + $unset (clears proposedTo/proposedAt on lock-in).
    findOneAndUpdate: (
      _filter: Record<string, unknown>,
      update: Record<string, unknown>,
    ) => {
      const u = update as Record<string, Record<string, unknown>>;
      if (u.$set || u.$unset || u.$addToSet) {
        if (u.$set) Object.assign(h.store.appointment, u.$set);
        if (u.$unset)
          for (const k of Object.keys(u.$unset)) delete h.store.appointment[k];
        if (u.$addToSet)
          for (const [k, v] of Object.entries(u.$addToSet)) {
            const arr = (h.store.appointment[k] ||= []) as unknown[];
            if (!arr.includes(v)) arr.push(v);
          }
      } else {
        Object.assign(h.store.appointment, update);
      }
      return h.makeQuery(h.store.appointment);
    },
    findOne: () => Promise.resolve(null), // no double-booking conflict
  },
}));

import { POST as assignPOST } from "@/app/api/admin/service-requests/[id]/assign/route";
import { POST as acceptPOST } from "@/app/api/appointments/[id]/accept/route";
import { POST as schedulePOST } from "@/app/api/appointments/[id]/schedule-first/route";
import { POST as releasePOST } from "@/app/api/appointments/[id]/release/route";

beforeEach(() => {
  vi.clearAllMocks();
  h.store.appointment = {
    _id: APPT_ID,
    clientId: {
      _id: CLIENT_ID,
      firstName: "Alex",
      lastName: "Test",
      email: "client@example.com",
      language: "en",
      role: "prospect",
      status: "prospect",
    },
    professionalId: null,
    routingStatus: "pending",
    status: "pending",
    proposedTo: [],
    therapyType: "solo",
    type: "video",
    duration: 60,
    bookingFor: "self",
    payment: { price: 0, platformFee: 0, professionalPayout: 0, status: "pending", method: "card" },
    save: async () => {},
  };
});

describe("guest booking: admin propose → professional accept", () => {
  it("admin assign proposes (no lock-in, no match email)", async () => {
    h.getServerSession.mockResolvedValueOnce({ user: { id: ADMIN_ID, role: "admin" } });

    const res = (await assignPOST(
      { json: async () => ({ professionalId: PRO_ID }) } as never,
      { params: Promise.resolve({ id: APPT_ID }) },
    )) as unknown as { status: number; body: Record<string, unknown> };

    const appt = h.store.appointment;
    expect(res.status).toBe(200);
    expect(appt.routingStatus).toBe("proposed");
    expect(Array.isArray(appt.proposedTo)).toBe(true);
    expect((appt.proposedTo as unknown[]).map(String)).toEqual([PRO_ID]);
    // KEY: no professional locked in, still pending
    expect(appt.professionalId == null).toBe(true);
    expect(appt.status).toBe("pending");
    // KEY: the match/payment email must NOT fire at propose time
    expect(h.notif.sendJumelageSuccessEmail).not.toHaveBeenCalled();
    // the proposed pro IS notified to review/accept
    expect(h.notif.sendProfessionalNotification).toHaveBeenCalledTimes(1);
    // first assignment is NOT a re-match → client gets no "match updated" email
    expect(h.notif.sendMatchUpdatedEmail).not.toHaveBeenCalled();
  });

  it("proposed professional accepts → MATCH only (pending, jumelage, no payment email)", async () => {
    // Arrange: appointment already in the post-assign proposed state.
    Object.assign(h.store.appointment, {
      routingStatus: "proposed",
      proposedTo: [PRO_ID],
      professionalId: null,
      status: "pending",
    });
    h.getServerSession.mockResolvedValueOnce({
      user: { id: PRO_ID, role: "professional" },
    });

    const res = (await acceptPOST({} as never, {
      params: Promise.resolve({ id: APPT_ID }),
    })) as unknown as { status: number; body: Record<string, unknown> };

    const appt = h.store.appointment;
    expect(res.status).toBe(200);
    // KEY: acceptance matches only — status stays "pending" (no real date yet)
    expect(appt.status).toBe("pending");
    expect(appt.routingStatus).toBe("accepted");
    expect(String(appt.professionalId)).toBe(PRO_ID);
    // KEY: only the jumelage email fires; NO payment email at acceptance
    expect(h.notif.sendJumelageSuccessEmail).toHaveBeenCalledTimes(1);
    expect(h.notif.sendGuestPaymentConfirmation).not.toHaveBeenCalled();
    expect(h.notif.sendPaymentInvitation).not.toHaveBeenCalled();
  });

  it("pro confirms 1st RDV (schedule-first) → scheduled + single payment/confirmation email", async () => {
    // Arrange: appointment in the matched state (accepted but not scheduled).
    Object.assign(h.store.appointment, {
      routingStatus: "accepted",
      proposedTo: [PRO_ID],
      professionalId: PRO_ID,
      status: "pending",
      date: undefined,
      time: undefined,
    });
    h.getServerSession.mockResolvedValueOnce({
      user: { id: PRO_ID, role: "professional" },
    });

    const res = (await schedulePOST(
      { json: async () => ({ date: "2099-01-15", time: "10:00" }) } as never,
      { params: Promise.resolve({ id: APPT_ID }) },
    )) as unknown as { status: number; body: Record<string, unknown> };

    const appt = h.store.appointment;
    expect(res.status).toBe(200);
    // KEY: confirming the 1st RDV is what flips it to scheduled with a real date
    expect(appt.status).toBe("scheduled");
    expect(appt.time).toBe("10:00");
    expect(appt.date).toBeInstanceOf(Date);
    // KEY: a single confirmation/payment email fires now (unclaimed → guest variant)
    expect(h.notif.sendGuestPaymentConfirmation).toHaveBeenCalledTimes(1);
    expect(h.notif.sendPaymentInvitation).not.toHaveBeenCalled();
    // jumelage is NOT re-sent at scheduling
    expect(h.notif.sendJumelageSuccessEmail).not.toHaveBeenCalled();
  });

  it("pro releases a matched (unscheduled) request → back to general pool", async () => {
    // Arrange: matched state (accepted, no date), assigned to PRO.
    Object.assign(h.store.appointment, {
      routingStatus: "accepted",
      proposedTo: [PRO_ID],
      professionalId: PRO_ID,
      status: "pending",
      refusedBy: [],
      firstRdvReminderSent: true,
    });
    h.getServerSession.mockResolvedValueOnce({
      user: { id: PRO_ID, role: "professional" },
    });

    const res = (await releasePOST({} as never, {
      params: Promise.resolve({ id: APPT_ID }),
    })) as unknown as { status: number; body: Record<string, unknown> };

    const appt = h.store.appointment;
    expect(res.status).toBe(200);
    // KEY: pro is unset, request returns to the general pool
    expect(appt.professionalId).toBeUndefined();
    expect(appt.routingStatus).toBe("general");
    // releasing pro is excluded from re-matching; reminder flag reset
    expect((appt.refusedBy as unknown[]).map(String)).toContain(PRO_ID);
    expect(appt.firstRdvReminderSent).toBe(false);
    // admins are alerted that a match was released to general
    expect(
      h.notif.sendAdminAppointmentMovedToGeneralAlert,
    ).toHaveBeenCalledTimes(1);
    // §3.1: the client is NOT emailed when a pro backs out — silent until a new
    // pro accepts (admin-only alert above), to avoid the confusing message.
    expect(h.notif.sendMatchUpdatedEmail).not.toHaveBeenCalled();
  });

  it("admin reassigns a stuck matched request to a different pro", async () => {
    // Arrange: matched to PRO, never scheduled, both reminder flags in play.
    Object.assign(h.store.appointment, {
      status: "pending",
      routingStatus: "accepted",
      professionalId: PRO_ID,
      proposedTo: [PRO_ID],
      matchedAt: new Date("2099-01-01"),
      firstRdvReminderSent: true,
      firstRdvAdminEscalatedSent: true,
      refusedBy: [],
    });
    h.getServerSession.mockResolvedValueOnce({
      user: { id: ADMIN_ID, role: "admin" },
    });

    const res = (await assignPOST(
      { json: async () => ({ professionalId: NEW_PRO_ID }) } as never,
      { params: Promise.resolve({ id: APPT_ID }) },
    )) as unknown as {
      status: number;
      body: { reassigned?: boolean };
    };

    const appt = h.store.appointment;
    expect(res.status).toBe(200);
    expect(res.body.reassigned).toBe(true);
    // KEY: handed to the new pro as a fresh proposal, old pro dropped
    expect(appt.professionalId).toBeUndefined();
    expect(appt.routingStatus).toBe("proposed");
    expect((appt.proposedTo as unknown[]).map(String)).toEqual([NEW_PRO_ID]);
    // reminder/escalation windows reset; matched timestamp cleared
    expect(appt.firstRdvReminderSent).toBe(false);
    expect(appt.firstRdvAdminEscalatedSent).toBe(false);
    expect(appt.matchedAt).toBeUndefined();
    // previous pro excluded from re-matching; new pro notified
    expect((appt.refusedBy as unknown[]).map(String)).toContain(PRO_ID);
    expect(h.notif.sendProfessionalNotification).toHaveBeenCalledTimes(1);
    // §3.1: reassignment is SILENT to the client — no email until the new pro
    // accepts (the jumelage confirmation). Only the new pro is notified.
    expect(h.notif.sendMatchUpdatedEmail).not.toHaveBeenCalled();
  });

  it("a professional CANNOT accept an awaiting_admin dossier (admin-only state)", async () => {
    // §3: after a failed auto-match cascade the dossier sits in routingStatus
    // "awaiting_admin" awaiting a MANUAL admin decision. Even if a stale
    // proposedTo entry survives, a pro must not be able to self-claim it.
    Object.assign(h.store.appointment, {
      routingStatus: "awaiting_admin",
      proposedTo: [PRO_ID],
      professionalId: null,
      status: "pending",
    });
    h.getServerSession.mockResolvedValueOnce({
      user: { id: PRO_ID, role: "professional" },
    });

    const res = (await acceptPOST({} as never, {
      params: Promise.resolve({ id: APPT_ID }),
    })) as unknown as { status: number; body: Record<string, unknown> };

    expect(res.status).toBe(403);
    // not locked in, still awaiting the admin, and no match email fired
    expect(h.store.appointment.routingStatus).toBe("awaiting_admin");
    expect(h.store.appointment.professionalId == null).toBe(true);
    expect(h.notif.sendJumelageSuccessEmail).not.toHaveBeenCalled();
  });
});
