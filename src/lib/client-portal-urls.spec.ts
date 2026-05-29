/**
 * H10: payment deep-links must carry the recipient's locale (&lang=) so the
 * landing page renders in the language the email was written in (locale is
 * otherwise cookie-only, defaulting to English).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  findByIdAndUpdate: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/models/Appointment", () => ({
  default: { findByIdAndUpdate: h.findByIdAndUpdate },
}));

import { resolveBillingUrl } from "@/lib/client-portal-urls";

const appt = (payment?: {
  paymentToken?: string;
  paymentTokenExpiry?: Date;
}) => ({ _id: { toString: () => "a1" }, payment });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveBillingUrl (H10)", () => {
  it("active client → dashboard deep-link with &lang=fr", async () => {
    const url = await resolveBillingUrl({
      userStatus: "active",
      appointment: appt(),
      base: "https://app.test",
      recipientLocale: "fr",
    });
    expect(url).toBe(
      "https://app.test/client/dashboard/billing?action=addPaymentMethod&lang=fr",
    );
  });

  it("active client en → &lang=en", async () => {
    const url = await resolveBillingUrl({
      userStatus: "active",
      appointment: appt(),
      base: "https://app.test",
      recipientLocale: "en",
    });
    expect(url).toContain("&lang=en");
  });

  it("non-active with a fresh token → /pay?token=…&lang (no token re-mint)", async () => {
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const url = await resolveBillingUrl({
      userStatus: "inactive",
      appointment: appt({ paymentToken: "tok123", paymentTokenExpiry: future }),
      base: "https://app.test",
      recipientLocale: "en",
    });
    expect(url).toBe("https://app.test/pay?token=tok123&lang=en");
    expect(h.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("undefined/unknown locale normalizes to fr", async () => {
    const url = await resolveBillingUrl({
      userStatus: "active",
      appointment: appt(),
      base: "https://app.test",
      recipientLocale: undefined,
    });
    expect(url).toContain("&lang=fr");
  });
});
