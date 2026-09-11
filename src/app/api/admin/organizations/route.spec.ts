/**
 * Spec 002 — every organization-billing admin route sits behind manageBilling.
 * A route added later without the gate fails here, because the list below is
 * built from the filesystem, not typed by hand.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  permissions: null as Record<string, boolean> | null,
  touched: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }),
  },
}));
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
vi.mock("@/models/Organization", () => ({ default: trap }));
vi.mock("@/models/OrganizationCoverage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/models/OrganizationCoverage")>()),
  default: trap,
}));
vi.mock("@/models/PlatformSettings", () => ({ default: trap }));
vi.mock("server-only", () => ({}));
vi.mock("@/models/OrganizationInvoice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/models/OrganizationInvoice")>()),
  default: trap,
}));
vi.mock("@/lib/organization-invoice", () => ({
  draftForSession: () => h.touched(),
  draftStatement: () => h.touched(),
  refreshDraft: () => h.touched(),
  issueAndSend: () => h.touched(),
  resendInvoice: () => h.touched(),
  voidInvoice: () => h.touched(),
  recordOrganizationPayment: () => h.touched(),
  unbilledSummary: () => h.touched(),
  renderInvoicePdf: () => h.touched(),
}));
vi.mock("@/lib/coverage-admin", () => ({
  createCoverage: () => h.touched(),
  updateCoverageTerms: () => h.touched(),
  endCoverage: () => h.touched(),
  applyConsent: () => h.touched(),
}));

const API = path.join(process.cwd(), "src/app/api/admin");
const ROOTS = ["organizations", "coverages", "organization-billing", "organization-invoices"];

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

const routes = ROOTS.flatMap((r) => routeFiles(path.join(API, r)));
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const req = {
  url: "http://x/api?clientId=0123456789abcdef01234560",
  json: async () => ({ name: "X", archived: true, enabled: true, action: "end" }),
};
const ctx = { params: Promise.resolve({ id: "0123456789abcdef01234567" }) };

beforeEach(() => {
  h.touched.mockReset();
  h.permissions = null;
});

describe("organization-billing admin routes", () => {
  it("finds the routes (guards against this test silently passing)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(6);
  });

  for (const file of routes) {
    const rel = path.relative(API, file).replace(/\\/g, "/");
    const source = readFileSync(file, "utf8");
    for (const method of METHODS) {
      if (!new RegExp(`export async function ${method}\\b`).test(source)) continue;

      it(`${method} ${rel} — 401 for a non-admin, 403 without manageBilling, no DB either way`, async () => {
        const mod = (await import(file)) as Record<string, (r: unknown, c: unknown) => Promise<{ status: number }>>;
        h.getServerSession.mockResolvedValue({ user: { id: "u1", isAdmin: false, role: "client" } });
        expect((await mod[method](req, ctx)).status).toBe(401);
        h.getServerSession.mockResolvedValue({ user: { id: "a1", isAdmin: true, role: "admin" } });
        h.permissions = { manageUsers: true, manageContent: true, manageBilling: false };
        expect((await mod[method](req, ctx)).status).toBe(403);
        expect(h.touched).not.toHaveBeenCalled();
      });
    }
  }
});
