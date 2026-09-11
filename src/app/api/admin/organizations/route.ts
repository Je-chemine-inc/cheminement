import { NextRequest, NextResponse } from "next/server";
import Organization from "@/models/Organization";
import OrganizationCoverage from "@/models/OrganizationCoverage";
import { requireBillingAdmin, serializeOrganization } from "@/lib/organization-admin";
import { parseOrganizationInput } from "@/lib/organization-input";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * GET /api/admin/organizations — the payer list (spec 002), archived ones too
 * with `?includeArchived=1`. Each row carries its number of active coverages.
 */
export async function GET(req: NextRequest) {
  const gate = await requireBillingAdmin();
  if (gate.error) return gate.error;

  try {
    const includeArchived = new URL(req.url).searchParams.get("includeArchived") === "1";
    const orgs = await Organization.find(includeArchived ? {} : { active: true })
      .sort({ active: -1, name: 1 })
      .lean();
    const counts = await OrganizationCoverage.aggregate<{ _id: unknown; n: number }>([
      { $match: { status: "active", organizationId: { $in: orgs.map((o) => o._id) } } },
      { $group: { _id: "$organizationId", n: { $sum: 1 } } },
    ]);
    const byOrg = new Map(counts.map((c) => [String(c._id), c.n]));
    return NextResponse.json({
      organizations: orgs.map((o) =>
        serializeOrganization(o, { activeCoverageCount: byOrg.get(String(o._id)) ?? 0 }),
      ),
    });
  } catch (error) {
    console.error("Admin list organizations error:", error);
    return NextResponse.json({ error: "Failed to load organizations" }, { status: 500 });
  }
}

/** POST /api/admin/organizations — create. Names are unique among active organizations. */
export async function POST(req: NextRequest) {
  const gate = await requireBillingAdmin();
  if (gate.error) return gate.error;

  try {
    const parsed = parseOrganizationInput(await req.json().catch(() => null), {
      partial: false,
    });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const input = parsed.value;

    const duplicate = await Organization.exists({
      active: true,
      name: { $regex: `^${escapeRegex(input.name!)}$`, $options: "i" },
    });
    if (duplicate) {
      return NextResponse.json(
        { error: "An active organization already has this name", code: "DUPLICATE_NAME" },
        { status: 409 },
      );
    }

    // `null` means "clear" on an edit; on a create it simply means "not set".
    const fields = Object.fromEntries(
      Object.entries(input).filter(([, v]) => v !== null),
    );
    const created = await Organization.create({
      ...fields,
      active: true,
      createdBy: gate.session.user.id,
      updatedBy: gate.session.user.id,
    });
    return NextResponse.json(
      { organization: serializeOrganization(created.toObject()) },
      { status: 201 },
    );
  } catch (error) {
    console.error("Admin create organization error:", error);
    return NextResponse.json({ error: "Failed to create the organization" }, { status: 500 });
  }
}
