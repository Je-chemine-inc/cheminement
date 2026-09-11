/**
 * « Facturation et paiements » and « Comptabilité & cycles » — with their
 * exports, payouts and payment reminders — are billing rights, not merely the
 * admin role. They only checked the role, so a support admin without
 * manageBilling read every client's payments and the sales journal, and could
 * record payouts; the professional payout route even accepted managePatients.
 *
 * The list of routes is built from the filesystem: a route added later under
 * billing/ or accounting/ without the gate fails here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  permissions: null as Record<string, boolean> | null,
  touched: vi.fn(),
}));

vi.mock("next/server", () => {
  class NextResponse {
    status: number;
    constructor(_body: unknown, init?: { status?: number }) {
      this.status = init?.status ?? 200;
    }
    static json(body: unknown, init?: { status?: number }) {
      return { status: init?.status ?? 200, body };
    }
  }
  return { NextResponse };
});
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mongodb", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("@/lib/admin-rbac", () => ({
  getActiveAdminPermissions: vi.fn(async () => h.permissions),
}));
// Any database access means the gate let the request through.
const trap = new Proxy(
  {},
  {
    get: () => {
      h.touched();
      throw new Error("database reached");
    },
  },
);
vi.mock("@/models/Appointment", () => ({ default: trap }));
vi.mock("@/models/User", () => ({ default: trap }));
vi.mock("@/models/Profile", () => ({ default: trap }));
vi.mock("@/models/Admin", () => ({ default: trap }));
vi.mock("@/models/ProfessionalLedgerEntry", () => ({ default: trap }));
vi.mock("@/models/Organization", () => ({ default: trap }));
vi.mock("@/models/PlatformSettings", () => ({ default: trap }));
vi.mock("@/models/OrganizationInvoice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/models/OrganizationInvoice")>()),
  default: trap,
}));
vi.mock("@/lib/notifications", () => ({
  sendInteracTransferInstructionsEmail: () => h.touched(),
  sendSessionInvoiceEmail: () => h.touched(),
}));

const API = path.join(process.cwd(), "src/app/api/admin");

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

const routes = [
  ...["billing", "accounting"].flatMap((r) => routeFiles(path.join(API, r))),
  // Sent only from those two screens.
  path.join(API, "appointments/[id]/resend-payment/route.ts"),
];
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const ID = "0123456789abcdef01234567";
// A body every write accepts, so a billing admin gets past validation.
const req = {
  url: "http://x/api?year=2026",
  json: async () => ({ professionalId: ID, payoutAmountCad: 10, amount: 10 }),
};
const ctx = { params: Promise.resolve({ id: ID }) };

type Handler = (r: unknown, c: unknown) => Promise<{ status: number }>;

beforeEach(() => {
  h.touched.mockReset();
  h.permissions = null;
  h.getServerSession.mockResolvedValue({ user: { id: "a1", isAdmin: true, role: "admin" } });
});

describe("billing and accounting admin routes", () => {
  it("finds the routes (guards against this test silently passing)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(10);
  });

  for (const file of routes) {
    const rel = path.relative(API, file).replace(/\\/g, "/");
    const source = readFileSync(file, "utf8");
    for (const method of METHODS) {
      if (!new RegExp(`export async function ${method}\\b`).test(source)) continue;
      const handler = async () => ((await import(file)) as Record<string, Handler>)[method];

      it(`${method} ${rel} — 401 for a non-admin, no DB`, async () => {
        h.getServerSession.mockResolvedValue({ user: { id: "u1", isAdmin: false, role: "client" } });
        expect((await (await handler())(req, ctx)).status).toBe(401);
        expect(h.touched).not.toHaveBeenCalled();
      });

      it(`${method} ${rel} — 403 with patient rights but no billing rights, no DB`, async () => {
        h.permissions = { managePatients: true, manageUsers: true, manageBilling: false };
        expect((await (await handler())(req, ctx)).status).toBe(403);
        expect(h.touched).not.toHaveBeenCalled();
      });

      it(`${method} ${rel} — 403 with no Admin record, no DB`, async () => {
        h.permissions = null;
        expect((await (await handler())(req, ctx)).status).toBe(403);
        expect(h.touched).not.toHaveBeenCalled();
      });

      it(`${method} ${rel} — a billing admin gets through to the data`, async () => {
        h.permissions = { manageBilling: true };
        // The trap throws and the route logs it: expected here.
        const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { status } = await (await handler())(req, ctx);
        quiet.mockRestore();
        expect([401, 403]).not.toContain(status);
        expect(h.touched).toHaveBeenCalled();
      });
    }
  }
});
