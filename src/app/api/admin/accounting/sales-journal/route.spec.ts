/**
 * The sales journal — the accountant's CSV of session revenue.
 *
 * Regression: a card session counted as revenue at closure even when nothing
 * was charged (no card on file, or a declined card), so an unpaid session sat
 * in the journal as collected. Also, the professional and session id columns
 * printed "[object Object]": the rows are populated, and a populated
 * reference is a document, not an id.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  session: { user: { id: "admin1", role: "admin" } } as { user: { id: string; role: string } } | null,
  rows: [] as Array<Record<string, unknown>>,
  appointmentModelLoaded: false,
}));

// Loading the module is what registers the model populate() needs.
vi.mock("@/models/Appointment", () => {
  h.appointmentModelLoaded = true;
  return { default: {} };
});

/** Keeps only the selected (dotted) paths of a populated document, like MongoDB. */
function project(doc: unknown, select: string | undefined): unknown {
  if (!doc || typeof doc !== "object" || select === undefined) return doc;
  const src = doc as Record<string, unknown>;
  const out: Record<string, unknown> = { _id: src._id };
  for (const path of select.split(/\s+/).filter(Boolean)) {
    const parts = path.split(".");
    let from: unknown = src;
    let to = out;
    for (let i = 0; i < parts.length; i++) {
      if (!from || typeof from !== "object" || !(parts[i] in from)) break;
      const value = (from as Record<string, unknown>)[parts[i]];
      if (i === parts.length - 1) {
        to[parts[i]] = value;
      } else {
        to[parts[i]] = (to[parts[i]] as Record<string, unknown>) ?? {};
        to = to[parts[i]] as Record<string, unknown>;
        from = value;
      }
    }
  }
  return out;
}

vi.mock("next/server", () => {
  class NextResponse {
    body: string;
    status: number;
    constructor(body: string, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }
    static json(body: unknown, init?: { status?: number }) {
      return { status: init?.status ?? 200, body };
    }
  }
  return { NextResponse };
});
vi.mock("next-auth", () => ({ getServerSession: async () => h.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/models/ProfessionalLedgerEntry", () => ({
  default: {
    find: () => {
      const selects: Record<string, string> = {};
      const q = {
        populate: (path: string, select: string) => {
          selects[path] = select;
          return q;
        },
        sort: () => q,
        lean: async () =>
          h.rows.map((r) => ({
            ...r,
            professionalId: project(r.professionalId, selects.professionalId),
            appointmentId: project(r.appointmentId, selects.appointmentId),
          })),
      };
      return q;
    },
  },
}));

import { GET } from "./route";

const credit = (key: string, paymentChannel: string, status: string) => ({
  _id: `ledger-${key}`,
  entryKind: "credit",
  createdAt: new Date("2026-09-10T17:21:06Z"),
  cycleKey: "2026-B19",
  professionalId: { _id: "pro-1", firstName: "Nathalie", lastName: "Pro", email: "pro@example.com" },
  appointmentId: {
    _id: `apt-${key}`,
    date: new Date("2026-09-09T12:00:00Z"),
    time: "12:00",
    status: "completed",
    sessionActNature: "individual_psychotherapy",
    payment: { status, price: 175, method: "card" },
  },
  grossAmountCad: 175,
  platformFeeCad: 25,
  netToProfessionalCad: 150,
  paymentChannel,
});

const exportCsv = async () => {
  const res = (await GET({ url: "https://x/api/admin/accounting/sales-journal?year=2026" } as never)) as unknown as {
    status: number;
    body: string;
  };
  return { status: res.status, lines: String(res.body).replace(/^\uFEFF/, "").split("\n") };
};

beforeEach(() => {
  h.session = { user: { id: "admin1", role: "admin" } };
  h.rows = [];
});

describe("GET /api/admin/accounting/sales-journal", () => {
  it("registers the Appointment model it populates", () => {
    // Otherwise a freshly started server answers 500 "Schema hasn't been
    // registered for model Appointment" until another route loads it.
    expect(h.appointmentModelLoaded).toBe(true);
  });

  it("is refused to anyone but an admin", async () => {
    h.session = { user: { id: "u", role: "professional" } };
    const res = (await GET({ url: "https://x/api/admin/accounting/sales-journal" } as never)) as unknown as { status: number };
    expect(res.status).toBe(401);
  });

  it("lists a card session only once its payment came in", async () => {
    h.rows = [
      credit("card-unpaid", "stripe", "pending"),
      credit("card-paid", "stripe", "paid"),
      credit("card-voided", "stripe", "cancelled"),
      credit("interac-unpaid", "transfer", "pending"),
      credit("interac-paid", "transfer", "paid"),
    ];
    const { status, lines } = await exportCsv();
    expect(status).toBe(200);
    const body = lines.slice(1).join("\n");
    expect(body).toContain("apt-card-paid");
    expect(body).toContain("apt-interac-paid");
    expect(body).not.toContain("apt-card-unpaid");
    expect(body).not.toContain("apt-card-voided");
    expect(body).not.toContain("apt-interac-unpaid");
    expect(lines).toHaveLength(3);
  });

  it("prints the professional and session ids, not [object Object]", async () => {
    h.rows = [credit("card-paid", "stripe", "paid")];
    const { lines } = await exportCsv();
    const cells = lines[1].split(",");
    expect(cells[2]).toBe("pro-1");
    expect(cells[3]).toBe("Nathalie Pro");
    expect(cells[4]).toBe("apt-card-paid");
    expect(lines.join("\n")).not.toContain("[object Object]");
  });
});
