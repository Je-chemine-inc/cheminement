import { describe, it, expect } from "vitest";
import {
  parseDirectIntent,
  pickAppointmentPatch,
  pickBookingIntake,
  toWriterRole,
} from "@/lib/appointment-writable-fields";

/**
 * Pins the allow-lists that replaced writing request bodies straight into
 * appointments (2026-09-11). Every "forged" case below was accepted before.
 */

describe("pickBookingIntake", () => {
  const funnelBody = {
    type: "video",
    therapyType: "solo",
    issueType: "Anxiété",
    needs: ["Anxiété"],
    reason: [],
    notes: "Disponible le soir",
    bookingFor: "self",
    preferredAvailability: ["evening"],
    preferredPaymentMethod: "card",
    notificationLocale: "fr",
  };

  it("passes everything the booking funnel actually sends", () => {
    const { data, dropped } = pickBookingIntake(funnelBody);
    expect(data).toEqual(funnelBody);
    expect(dropped).toEqual([]);
  });

  it("drops a forged payment block, so a booking can't arrive already 'paid'", () => {
    const { data, dropped } = pickBookingIntake({
      ...funnelBody,
      payment: { status: "paid", price: 1 },
    });
    expect(data).not.toHaveProperty("payment");
    expect(dropped).toContain("payment");
  });

  it("drops every server-owned money and state field", () => {
    const forged = {
      status: "completed",
      routingStatus: "accepted",
      price: 1,
      platformFee: 0,
      professionalPayout: 1,
      invoiceNumber: "JC-2026-000001",
      sessionCompletedAt: "2026-09-01T12:00:00Z",
      sessionOutcome: "completed",
      fiscalReceiptIssuedAt: "2026-09-01T12:00:00Z",
      clientId: "someone-else",
      cascadeAttempts: 0,
      refusedBy: [],
      awaitingPaymentGuarantee: false,
      postMeetingPaymentReminderSent: true,
    };
    const { data, dropped } = pickBookingIntake({ ...funnelBody, ...forged });
    for (const key of Object.keys(forged)) {
      expect(data).not.toHaveProperty(key);
      expect(dropped).toContain(key);
    }
  });

  it("drops dotted paths and operator keys", () => {
    const { data } = pickBookingIntake({
      ...funnelBody,
      "payment.status": "paid",
      $set: { "payment.status": "paid" },
    });
    expect(data).not.toHaveProperty("payment.status");
    expect(data).not.toHaveProperty("$set");
  });

  it("keeps a client-chosen payment method, but never 'manual'", () => {
    expect(pickBookingIntake({ paymentMethod: "transfer" }).data.paymentMethod).toBe(
      "transfer",
    );
    const manual = pickBookingIntake({ paymentMethod: "manual" });
    expect(manual.data).not.toHaveProperty("paymentMethod");
    expect(manual.dropped).toContain("paymentMethod");
  });

  it("drops a professional, a date and a time sent straight in", () => {
    // Through the guest route this attached any professional to a request as
    // already accepted, with nothing holding the time (spec 003 phase 3).
    const { data, dropped } = pickBookingIntake({
      professionalId: "p1",
      date: "2026-10-01",
      time: "10:00",
      duration: 50,
    });
    expect(data).toEqual({});
    expect([...dropped].sort()).toEqual(["date", "duration", "professionalId", "time"]);
  });

  it("leaves a showcase slot request to parseDirectIntent, without logging it as dropped", () => {
    const { data, dropped } = pickBookingIntake({
      ...funnelBody,
      direct: { slug: "sassi", service: "standard", date: "2026-10-01", time: "10:00" },
    });
    expect(data).not.toHaveProperty("direct");
    expect(dropped).toEqual([]);
  });

  it("reads a showcase slot request's shape, and refuses a malformed one", () => {
    const direct = { slug: "dre-sassi", service: "quick", date: "2026-10-01", time: "10:15" };
    expect(parseDirectIntent(direct)).toEqual({ ok: true, intent: direct });
    expect(parseDirectIntent(undefined)).toEqual({ ok: true, intent: null });
    for (const bad of [
      "sassi",
      { ...direct, slug: "../x" },
      { ...direct, service: "couple" },
      { ...direct, date: "2026-02-30" },
      { ...direct, time: "9:00" },
      { ...direct, date: { $gt: "" } },
    ]) {
      expect(parseDirectIntent(bad)).toEqual({ ok: false });
    }
  });

  it("returns nothing for a non-object body", () => {
    expect(pickBookingIntake([] as unknown as object).data).toEqual({});
  });
});

describe("pickAppointmentPatch", () => {
  it("lets a professional reschedule, add a link, notes and change status", () => {
    const res = pickAppointmentPatch(
      {
        status: "ongoing",
        date: "2026-10-01",
        time: "10:00",
        meetingLink: "https://meet.example/x",
        notes: "Appeler avant",
        cancelReason: null,
      },
      "professional",
    );
    expect(res.ok).toBe(true);
  });

  it("refuses an update operator outright", () => {
    const res = pickAppointmentPatch(
      { $set: { "payment.status": "paid" } },
      "professional",
    );
    expect(res).toEqual({
      ok: false,
      status: 400,
      error: "Field not allowed: $set",
    });
  });

  it("refuses a dotted path outright", () => {
    const res = pickAppointmentPatch({ "payment.status": "paid" }, "admin");
    expect(res).toMatchObject({ ok: false, status: 400 });
  });

  it("drops a payment object and anything else not on the list", () => {
    const res = pickAppointmentPatch(
      { notes: "ok", payment: { status: "paid" }, sessionCompletedAt: "x" },
      "professional",
    );
    expect(res).toEqual({
      ok: true,
      data: { notes: "ok" },
      dropped: ["payment", "sessionCompletedAt"],
    });
  });

  it("refuses a non-string value (an object smuggled into a string field)", () => {
    const res = pickAppointmentPatch({ notes: { $gt: "" } }, "professional");
    expect(res).toMatchObject({ ok: false, status: 400 });
  });

  it("lets a client cancel, with a reason", () => {
    const res = pickAppointmentPatch(
      { status: "cancelled", cancelReason: "Malade" },
      "client",
    );
    expect(res).toEqual({
      ok: true,
      data: { status: "cancelled", cancelReason: "Malade" },
      dropped: [],
    });
  });

  it("refuses a client setting any other status", () => {
    for (const status of ["completed", "scheduled", "no-show", "ongoing"]) {
      expect(pickAppointmentPatch({ status }, "client")).toMatchObject({
        ok: false,
        status: 403,
      });
    }
  });

  it("does not let a client overwrite the professional's notes or the slot", () => {
    const res = pickAppointmentPatch(
      { notes: "hacked", date: "2026-10-01", meetingLink: "x" },
      "client",
    );
    // Nothing a client may set is left, so the request is refused.
    expect(res).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a body that ends up empty", () => {
    expect(pickAppointmentPatch({}, "professional")).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("refuses a non-object body", () => {
    expect(pickAppointmentPatch("status=paid", "admin")).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(pickAppointmentPatch(null, "admin")).toMatchObject({ ok: false });
  });
});

describe("toWriterRole", () => {
  it("treats guests and prospects as clients", () => {
    expect(toWriterRole("guest")).toBe("client");
    expect(toWriterRole("prospect")).toBe("client");
    expect(toWriterRole(undefined)).toBe("client");
    expect(toWriterRole("professional")).toBe("professional");
    expect(toWriterRole("admin")).toBe("admin");
  });
});

describe("the third-party payer a client declares at booking (spec 002)", () => {
  const base = { type: "video", bookingFor: "self" };

  it("builds the declaration server-side: pending, dated, with the consent version", () => {
    const { data, dropped } = pickBookingIntake({
      ...base,
      thirdPartyPayer: { organizationName: "  PAE Desjardins ", caseNumber: " 4471 ", consent: true },
    }) as { data: Record<string, unknown>; dropped: string[] };
    expect(dropped).toEqual([]);
    expect(data).not.toHaveProperty("thirdPartyPayer");
    expect(data.payerDeclaration).toMatchObject({
      organizationName: "PAE Desjardins",
      caseNumber: "4471",
      consentGiven: true,
      consentTextVersion: "org-billing-2026-09",
      source: "client_booking",
      status: "pending",
    });
    expect((data.payerDeclaration as { declaredAt: unknown }).declaredAt).toBeInstanceOf(Date);
  });

  it("never takes the status, the coverage or the review from the browser", () => {
    const { data, dropped } = pickBookingIntake({
      ...base,
      payerDeclaration: { organizationName: "X", status: "confirmed", coverageId: "c1" },
      thirdPartyPayer: { organizationName: "PAE X", consent: true, status: "confirmed", coverageId: "c1" },
    }) as { data: Record<string, unknown>; dropped: string[] };
    expect(dropped).toContain("payerDeclaration");
    expect(data.payerDeclaration).toMatchObject({ status: "pending" });
    expect(data.payerDeclaration).not.toHaveProperty("coverageId");
  });

  it("records nothing without the consent box ticked, or without a name", () => {
    for (const thirdPartyPayer of [
      { organizationName: "PAE X", consent: false },
      { organizationName: "PAE X", consent: "true" },
      { organizationName: "", consent: true },
      "PAE X",
    ]) {
      const { data, dropped } = pickBookingIntake({ ...base, thirdPartyPayer }) as {
        data: Record<string, unknown>;
        dropped: string[];
      };
      expect(data).not.toHaveProperty("payerDeclaration");
      expect(dropped).toContain("thirdPartyPayer");
    }
  });

  it("caps the free text", () => {
    const { data } = pickBookingIntake({
      ...base,
      thirdPartyPayer: { organizationName: "A".repeat(500), caseNumber: "9".repeat(200), consent: true },
    }) as unknown as { data: { payerDeclaration: { organizationName: string; caseNumber: string } } };
    expect(data.payerDeclaration.organizationName).toHaveLength(120);
    expect(data.payerDeclaration.caseNumber).toHaveLength(60);
  });
});
