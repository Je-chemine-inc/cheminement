/**
 * Inbound-email ingestion helpers: normalizing a fetched IMAP message into the
 * ExternalMessage shape and resolving RFC threading ids (so a client's reply is
 * grouped under the admin message it answers).
 */
import { describe, it, expect } from "vitest";
import {
  parseReferenceIds,
  htmlToText,
  normalizeInboundEmail,
  isAutomatedEmail,
  type RawInboundEmail,
} from "./inbound-email";

describe("parseReferenceIds", () => {
  it("normalizes bare + bracketed ids and de-duplicates", () => {
    const ids = parseReferenceIds("<a@x>", "b@x <a@x> <c@x>");
    expect(ids).toEqual(["<b@x>", "<a@x>", "<c@x>"]);
  });

  it("accepts an array of references", () => {
    expect(parseReferenceIds(undefined, ["<a@x>", "b@x"])).toEqual([
      "<a@x>",
      "<b@x>",
    ]);
  });

  it("returns [] when there is nothing to thread", () => {
    expect(parseReferenceIds(undefined, undefined)).toEqual([]);
    expect(parseReferenceIds("", "")).toEqual([]);
  });
});

describe("htmlToText", () => {
  it("strips tags and decodes basic entities", () => {
    expect(htmlToText("<p>Bonjour&nbsp;&amp; merci</p><p>2e ligne</p>")).toBe(
      "Bonjour & merci\n2e ligne",
    );
  });

  it("drops script/style content", () => {
    expect(htmlToText("<style>a{}</style><p>Hi</p><script>x()</script>")).toBe(
      "Hi",
    );
  });
});

describe("normalizeInboundEmail", () => {
  const base: RawInboundEmail = {
    messageId: "abc@mailpro5",
    from: { name: "Jean Client", email: "Jean@Example.COM" },
    subject: "Re: votre demande",
    text: "Merci beaucoup!",
    to: "support@jechemine.ca",
    date: "2026-07-26T22:00:00.000Z",
  };

  it("wraps the message-id, lowercases the sender, keeps the name", () => {
    const n = normalizeInboundEmail(base)!;
    expect(n.messageId).toBe("<abc@mailpro5>");
    expect(n.senderEmail).toBe("jean@example.com");
    expect(n.senderName).toBe("Jean Client");
    expect(n.subject).toBe("Re: votre demande");
    expect(n.message).toBe("Merci beaucoup!");
    expect(n.metadata.to).toBe("support@jechemine.ca");
  });

  it("returns null without a message-id or a valid sender", () => {
    expect(normalizeInboundEmail({ ...base, messageId: "" })).toBeNull();
    expect(normalizeInboundEmail({ ...base, from: { email: "not-an-email" } })).toBeNull();
    expect(normalizeInboundEmail({ ...base, from: {} })).toBeNull();
  });

  it("falls back to the email local-part when no display name", () => {
    const n = normalizeInboundEmail({ ...base, from: { email: "sam@x.io" } })!;
    expect(n.senderName).toBe("sam");
  });

  it("derives text from html when there is no text/plain part", () => {
    const n = normalizeInboundEmail({
      ...base,
      text: undefined,
      html: "<p>Allô</p>",
    })!;
    expect(n.message).toBe("Allô");
    expect(n.htmlBody).toBe("<p>Allô</p>");
  });

  it("builds a normalized references chain from IRT + References", () => {
    const n = normalizeInboundEmail({
      ...base,
      inReplyTo: "<parent@jechemine.ca>",
      references: "<root@jechemine.ca> <parent@jechemine.ca>",
    })!;
    expect(n.inReplyTo).toBe("<parent@jechemine.ca>");
    expect(n.references).toBe("<root@jechemine.ca> <parent@jechemine.ca>");
  });

  it("never stores an empty body (schema requires one)", () => {
    const n = normalizeInboundEmail({ ...base, text: "", html: "" })!;
    expect(n.message).toBe("Re: votre demande"); // falls back to subject
  });

  it("records which mailbox the message arrived in", () => {
    const n = normalizeInboundEmail({
      ...base,
      mailbox: "paiement@jechemine.ca",
    })!;
    expect(n.metadata.mailbox).toBe("paiement@jechemine.ca");
  });
});

describe("isAutomatedEmail", () => {
  const human: RawInboundEmail = {
    messageId: "<x@m>",
    from: { name: "Jean", email: "jean@example.com" },
    subject: "Bonjour",
    text: "une vraie question",
  };

  it("does NOT filter a genuine client email", () => {
    expect(isAutomatedEmail(human)).toBe(false);
  });

  it("filters delivery bounces by sender (mailer-daemon / postmaster)", () => {
    expect(
      isAutomatedEmail({ ...human, from: { email: "mailer-daemon@se3.web-dns1.com" } }),
    ).toBe(true);
    expect(
      isAutomatedEmail({ ...human, from: { email: "postmaster@example.com" } }),
    ).toBe(true);
  });

  it("filters auto-replies via the Auto-Submitted header (RFC 3834)", () => {
    expect(isAutomatedEmail({ ...human, autoSubmitted: "auto-replied" })).toBe(true);
    expect(isAutomatedEmail({ ...human, autoSubmitted: "auto-generated" })).toBe(true);
    // "no" means a real human message — must NOT be filtered.
    expect(isAutomatedEmail({ ...human, autoSubmitted: "no" })).toBe(false);
  });

  it("filters an empty return-path envelope and DSN reports", () => {
    expect(isAutomatedEmail({ ...human, returnPath: "<>" })).toBe(true);
    expect(
      isAutomatedEmail({
        ...human,
        contentType: "multipart/report; report-type=delivery-status; boundary=abc",
      }),
    ).toBe(true);
  });

  it("filters Precedence: auto_reply but keeps a normal return-path", () => {
    expect(isAutomatedEmail({ ...human, precedence: "auto_reply" })).toBe(true);
    expect(isAutomatedEmail({ ...human, returnPath: "<jean@example.com>" })).toBe(false);
  });
});
