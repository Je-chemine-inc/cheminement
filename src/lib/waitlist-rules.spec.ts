import { describe, it, expect } from "vitest";
import {
  SMS_SEGMENT_LENGTH,
  WAITLIST_CONSENT_VERSION,
  entryFitsSlot,
  isGsm7,
  isWaitlistLeaveToken,
  isWaitlistQuietHours,
  isWaitlistOfferToken,
  parseWaitlistJoin,
  parseWaitlistPhone,
  pickOffers,
  slotPeriod,
  smsSlotLabel,
  waitlistOfferSms,
  waitlistShortName,
  waitlistStatusFields,
  weekdayOfDayKey,
  type WaitlistQueueEntry,
  type WaitlistSlot,
} from "@/lib/waitlist-rules";

describe("isWaitlistQuietHours", () => {
  it("is quiet from 21:00 to 07:59 in Montréal, in summer and in winter", () => {
    // September: Montréal is UTC-4.
    expect(isWaitlistQuietHours(new Date("2026-09-15T00:59:00Z"))).toBe(false); // 20:59
    expect(isWaitlistQuietHours(new Date("2026-09-15T01:00:00Z"))).toBe(true); // 21:00
    expect(isWaitlistQuietHours(new Date("2026-09-15T11:59:00Z"))).toBe(true); // 07:59
    expect(isWaitlistQuietHours(new Date("2026-09-15T12:00:00Z"))).toBe(false); // 08:00
    // January: UTC-5.
    expect(isWaitlistQuietHours(new Date("2027-01-15T02:00:00Z"))).toBe(true); // 21:00
    expect(isWaitlistQuietHours(new Date("2027-01-15T13:00:00Z"))).toBe(false); // 08:00
  });
});

const slot = (dayKey: string, time: string, service: "standard" | "quick" = "standard", durationMinutes = 50): WaitlistSlot => ({
  service,
  dayKey,
  time,
  durationMinutes,
});

const entry = (id: string, overrides: Partial<WaitlistQueueEntry> = {}): WaitlistQueueEntry => ({
  id,
  service: "standard",
  periods: [],
  days: [],
  offeredSlotKeys: [],
  ...overrides,
});

describe("waitlistStatusFields", () => {
  it("keeps an entry open only while it waits", () => {
    expect(waitlistStatusFields("active")).toEqual({ status: "active", isOpen: true });
    expect(waitlistStatusFields("offered")).toEqual({ status: "offered", isOpen: true });
    for (const closed of ["converted", "expired", "left", "removed"] as const) {
      expect(waitlistStatusFields(closed).isOpen).toBe(false);
    }
  });
});

describe("slot fit", () => {
  it("reads the time of day and the weekday in Montréal terms", () => {
    expect(slotPeriod("08:00")).toBe("morning");
    expect(slotPeriod("11:59")).toBe("morning");
    expect(slotPeriod("12:00")).toBe("afternoon");
    expect(slotPeriod("16:30")).toBe("afternoon");
    expect(slotPeriod("17:00")).toBe("evening");
    // 14 September 2026 is a Monday; the 20th a Sunday.
    expect(weekdayOfDayKey("2026-09-14")).toBe("monday");
    expect(weekdayOfDayKey("2026-09-20")).toBe("sunday");
  });

  it("matches the consultation, then the preferred moments and days when given", () => {
    const monday10 = { service: "standard" as const, dayKey: "2026-09-14", time: "10:00" };
    expect(entryFitsSlot({ service: "standard", periods: [], days: [] }, monday10)).toBe(true);
    expect(entryFitsSlot({ service: "quick", periods: [], days: [] }, monday10)).toBe(false);
    expect(entryFitsSlot({ service: "standard", periods: ["evening"], days: [] }, monday10)).toBe(false);
    expect(entryFitsSlot({ service: "standard", periods: ["morning"], days: ["tuesday"] }, monday10)).toBe(false);
    expect(entryFitsSlot({ service: "standard", periods: ["morning", "evening"], days: ["monday"] }, monday10)).toBe(true);
  });
});

describe("pickOffers", () => {
  it("serves the queue in order, each person the earliest time that suits them", () => {
    const slots = [slot("2026-09-15", "14:00"), slot("2026-09-14", "18:00"), slot("2026-09-14", "09:00")];
    const picks = pickOffers(
      [entry("first", { periods: ["afternoon"] }), entry("second"), entry("third")],
      slots,
    );
    expect(picks).toEqual([
      { entryId: "first", slot: slot("2026-09-15", "14:00") },
      { entryId: "second", slot: slot("2026-09-14", "09:00") },
      { entryId: "third", slot: slot("2026-09-14", "18:00") },
    ]);
  });

  it("gives one time to one person and never offers a time twice to the same person", () => {
    const picks = pickOffers(
      [entry("a", { offeredSlotKeys: ["2026-09-14 09:00"] }), entry("b"), entry("c")],
      [slot("2026-09-14", "09:00")],
    );
    expect(picks).toEqual([{ entryId: "b", slot: slot("2026-09-14", "09:00") }]);
  });

  it("never makes two offers that overlap, across consultations", () => {
    const picks = pickOffers(
      [entry("standard"), entry("quick", { service: "quick" })],
      [slot("2026-09-14", "10:00", "standard", 50), slot("2026-09-14", "10:30", "quick", 30), slot("2026-09-14", "11:00", "quick", 30)],
    );
    expect(picks).toEqual([
      { entryId: "standard", slot: slot("2026-09-14", "10:00", "standard", 50) },
      { entryId: "quick", slot: slot("2026-09-14", "11:00", "quick", 30) },
    ]);
  });

  it("offers nothing when nothing suits", () => {
    expect(pickOffers([entry("a", { days: ["sunday"] })], [slot("2026-09-14", "09:00")])).toEqual([]);
    expect(pickOffers([], [slot("2026-09-14", "09:00")])).toEqual([]);
  });
});

describe("the offer text message", () => {
  const url = "https://www.jechemine.ca/la/AbCdEfGhIjKlMnOpQrStUv";

  it("labels the time briefly", () => {
    expect(smsSlotLabel("2026-09-16", "09:30", "fr")).toBe("mer. 16/09 à 9 h 30");
    expect(smsSlotLabel("2026-09-16", "14:00", "en")).toBe("Wed Sep 16 at 14:00");
  });

  it("fits one segment in the GSM alphabet, whatever the name, and never cuts the link", () => {
    for (const lang of ["fr", "en"] as const) {
      for (const professionalName of ["Dre Amel Sassi", "Dre Marie-Ève Côté-Lefebvre-Tremblay de la Montagne-Saint-Hilaire"]) {
        const body = waitlistOfferSms({ lang, professionalName, dayKey: "2026-09-16", time: "10:00", url });
        expect(body.length).toBeLessThanOrEqual(SMS_SEGMENT_LENGTH);
        expect(isGsm7(body), body).toBe(true);
        expect(body.endsWith(url)).toBe(true);
      }
    }
    const short = waitlistOfferSms({ lang: "fr", professionalName: "Hélène Côté", dayKey: "2026-09-16", time: "10:00", url });
    expect(short).toContain("Hélène Coté");
  });

  it("knows the GSM alphabet", () => {
    expect(isGsm7("Réservé à 10 h")).toBe(true);
    expect(isGsm7("Côté")).toBe(false);
    expect(isGsm7("Réservé — 15 min")).toBe(false);
  });
});

describe("parseWaitlistJoin", () => {
  const valid = () => ({
    firstName: "  Amel ",
    lastName: "Sassi",
    email: "Amel@Example.com",
    phone: "438 555-0189",
    locale: "en",
    service: "standard",
    modality: "video",
    motifs: ["Anxiété", "Anxiété", "Stress"],
    periods: ["morning", "morning"],
    days: ["monday"],
    consent: true,
    consentVersion: WAITLIST_CONSENT_VERSION,
    smsConsent: true,
  });

  it("keeps a clean copy of a valid form", () => {
    expect(parseWaitlistJoin(valid())).toEqual({
      ok: true,
      value: {
        firstName: "Amel",
        lastName: "Sassi",
        email: "amel@example.com",
        phone: "438 555-0189",
        locale: "en",
        service: "standard",
        modality: "video",
        motifs: ["Anxiété", "Stress"],
        periods: ["morning"],
        days: ["monday"],
        smsConsent: true,
      },
    });
  });

  it("requires the current consent text", () => {
    expect(parseWaitlistJoin({ ...valid(), consent: false })).toEqual({ ok: false, field: "consent" });
    expect(parseWaitlistJoin({ ...valid(), consentVersion: "2020-01-01" })).toEqual({ ok: false, field: "consent" });
  });

  it("refuses a text message without a phone number", () => {
    expect(parseWaitlistJoin({ ...valid(), phone: "" })).toEqual({ ok: false, field: "smsConsent" });
    const noSms = parseWaitlistJoin({ ...valid(), phone: "", smsConsent: false });
    expect(noSms.ok && noSms.value.phone).toBe(null);
  });

  it("refuses what it cannot read", () => {
    expect(parseWaitlistJoin(null)).toEqual({ ok: false, field: "body" });
    expect(parseWaitlistJoin({ ...valid(), email: "nope" })).toEqual({ ok: false, field: "email" });
    expect(parseWaitlistJoin({ ...valid(), service: "couple" })).toEqual({ ok: false, field: "service" });
    expect(parseWaitlistJoin({ ...valid(), modality: "chat" })).toEqual({ ok: false, field: "modality" });
    expect(parseWaitlistJoin({ ...valid(), motifs: ["a", "b", "c", "d"] })).toEqual({ ok: false, field: "motifs" });
    expect(parseWaitlistJoin({ ...valid(), periods: ["night"] })).toEqual({ ok: false, field: "periods" });
    expect(parseWaitlistJoin({ ...valid(), days: "monday" })).toEqual({ ok: false, field: "days" });
    expect(parseWaitlistJoin({ ...valid(), firstName: "x".repeat(61) })).toEqual({ ok: false, field: "firstName" });
  });

  it("reads a phone number of 10 to 15 digits", () => {
    expect(parseWaitlistPhone("+1 (438) 555-0189")).toEqual({ ok: true, phone: "+1 (438) 555-0189" });
    expect(parseWaitlistPhone("555-0189")).toEqual({ ok: false });
    expect(parseWaitlistPhone(undefined)).toEqual({ ok: true, phone: null });
  });
});

describe("tokens and names", () => {
  it("tells the two link formats apart", () => {
    expect(isWaitlistOfferToken("AbCdEfGhIjKlMnOpQrSt_-")).toBe(true);
    expect(isWaitlistOfferToken("a".repeat(64))).toBe(false);
    expect(isWaitlistLeaveToken("a".repeat(64))).toBe(true);
    expect(isWaitlistLeaveToken("AbCdEfGhIjKlMnOpQrSt_-")).toBe(false);
  });

  it("names a person by first name and initial", () => {
    expect(waitlistShortName("Amel", "sassi")).toBe("Amel S.");
    expect(waitlistShortName("Amel", "")).toBe("Amel");
  });
});
