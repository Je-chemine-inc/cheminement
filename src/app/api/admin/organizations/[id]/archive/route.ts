import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import Organization from "@/models/Organization";
import OrganizationCoverage from "@/models/OrganizationCoverage";
import { requireBillingAdmin, serializeOrganization } from "@/lib/organization-admin";

/**
 * POST /api/admin/organizations/[id]/archive — `{ archived: boolean }`.
 *
 * Organizations are archived, never deleted: closed sessions and invoices point
 * at them. Archiving is refused while it still covers someone — closure would
 * hold every one of those sessions for a decision. End the coverages first.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireBillingAdmin();
  if (gate.error) return gate.error;

  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const body = (await req.json().catch(() => null)) as { archived?: unknown } | null;
    if (typeof body?.archived !== "boolean") {
      return NextResponse.json({ error: "archived must be true or false" }, { status: 400 });
    }

    if (body.archived) {
      const activeCoverageCount = await OrganizationCoverage.countDocuments({
        organizationId: id,
        status: "active",
      });
      if (activeCoverageCount > 0) {
        return NextResponse.json(
          {
            error: `This organization still covers ${activeCoverageCount} client(s). End those coverages first.`,
            code: "HAS_ACTIVE_COVERAGES",
            activeCoverageCount,
          },
          { status: 409 },
        );
      }
    }

    const updated = await Organization.findByIdAndUpdate(
      id,
      body.archived
        ? { $set: { active: false, archivedAt: new Date(), updatedBy: gate.session.user.id } }
        : {
            $set: { active: true, updatedBy: gate.session.user.id },
            $unset: { archivedAt: 1 },
          },
      { new: true },
    ).lean();
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ organization: serializeOrganization(updated) });
  } catch (error) {
    console.error("Admin archive organization error:", error);
    return NextResponse.json({ error: "Failed to update the organization" }, { status: 500 });
  }
}
