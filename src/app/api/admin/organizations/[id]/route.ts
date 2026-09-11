import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import Organization from "@/models/Organization";
import OrganizationCoverage from "@/models/OrganizationCoverage";
import { requireBillingAdmin, serializeOrganization } from "@/lib/organization-admin";
import { parseOrganizationInput } from "@/lib/organization-input";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * PATCH /api/admin/organizations/[id] — edit an organization's details and
 * terms. New terms apply to sessions closed from now on; a closed session keeps
 * the amounts frozen in its payer snapshot.
 */
export async function PATCH(
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
    const parsed = parseOrganizationInput(await req.json().catch(() => null), {
      partial: true,
    });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const input = parsed.value;

    if (input.name) {
      const duplicate = await Organization.exists({
        _id: { $ne: new mongoose.Types.ObjectId(id) },
        active: true,
        name: { $regex: `^${escapeRegex(input.name)}$`, $options: "i" },
      });
      if (duplicate) {
        return NextResponse.json(
          { error: "An active organization already has this name", code: "DUPLICATE_NAME" },
          { status: 409 },
        );
      }
    }

    const $set: Record<string, unknown> = { updatedBy: gate.session.user.id };
    const $unset: Record<string, 1> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value === null) $unset[key] = 1;
      else $set[key] = value;
    }
    const updated = await Organization.findByIdAndUpdate(
      id,
      { $set, ...(Object.keys($unset).length ? { $unset } : {}) },
      { new: true, runValidators: true },
    ).lean();
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const activeCoverageCount = await OrganizationCoverage.countDocuments({
      organizationId: updated._id,
      status: "active",
    });
    return NextResponse.json({
      organization: serializeOrganization(updated, { activeCoverageCount }),
    });
  } catch (error) {
    console.error("Admin update organization error:", error);
    return NextResponse.json({ error: "Failed to update the organization" }, { status: 500 });
  }
}
