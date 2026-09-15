import { describe, it, expect } from "vitest";
import { stripPremiumPayload } from "@/lib/content-premium";

/**
 * A professional's product (spec 003 phase 5) sells more than the text: a
 * webinar's room and replay, and a PDF. The single paywall gate removes them
 * with the body, and keeps what the public may see.
 */
describe("stripPremiumPayload for products", () => {
  it("removes the webinar room and the PDF with the paid text", () => {
    const view = stripPremiumPayload({
      title: "Atelier",
      summary: "Public",
      contentHtml: "<p>payant</p>",
      mediaUrl: "https://vimeo.com/1",
      webinar: { startsAt: "2026-10-01T23:00:00.000Z", durationMinutes: 60 },
      webinarAccess: { joinUrl: "https://zoom.us/j/123", replayUrl: "https://vimeo.com/2" },
      productFileId: "0123456789abcdef01234567",
      externalUrl: "https://example.com",
    });
    expect(view).toEqual({
      title: "Atelier",
      summary: "Public",
      webinar: { startsAt: "2026-10-01T23:00:00.000Z", durationMinutes: 60 },
      externalUrl: "https://example.com",
      locked: true,
    });
    expect(JSON.stringify(view)).not.toContain("zoom.us");
    expect(JSON.stringify(view)).not.toContain("0123456789abcdef01234567");
  });
});
