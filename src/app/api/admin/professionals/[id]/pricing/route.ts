import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/mongodb";
import Profile from "@/models/Profile";
import { authOptions } from "@/lib/auth";
import {
  ratesToSetPaths,
  ratesToUnsetPaths,
  spreadOf,
  THERAPY_TYPES,
  validateRatesInput,
  type RatesInput,
} from "@/lib/professional-pricing";

/**
 * Admin-only per-professional pricing.
 *
 * The client pays `clientPrice`, the professional receives `professionalRate`,
 * and the platform keeps the spread. Both are stored explicitly; a percentage is
 * a UI affordance only (spec 001 AC-6/AC-7).
 *
 * A professional cannot set these on themselves — `pricing` was removed from the
 * self-writable allowlist in `PUT /api/profile` so this route is the only way in.
 *
 * `clientPrice` left unset means the professional follows
 * `PlatformSettings.defaultPricing` for that therapy type.
 */

/** Shape returned to the admin UI: stored values plus the derived spread. */
function serialise(rates: RatesInput | undefined) {
  return THERAPY_TYPES.reduce(
    (acc, type) => {
      const entry = rates?.[type];
      const clientPrice = entry?.clientPrice ?? null;
      const professionalRate = entry?.professionalRate ?? null;
      acc[type] = {
        clientPrice,
        professionalRate,
        spread: spreadOf(clientPrice, professionalRate),
        // AC-17: a zero or negative spread is legal but must never be silent.
        zeroOrNegativeSpread:
          typeof clientPrice === "number" &&
          typeof professionalRate === "number" &&
          clientPrice - professionalRate <= 0,
      };
      return acc;
    },
    {} as Record<string, unknown>,
  );
}

async function requireAdminAndProfile(id: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== "admin") {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return {
      error: NextResponse.json({ error: "Invalid professional id" }, { status: 400 }),
    };
  }

  await connectToDatabase();

  const profile = await Profile.findOne({ userId: id });
  if (!profile) {
    return {
      error: NextResponse.json({ error: "Profile not found" }, { status: 404 }),
    };
  }
  return { profile };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { error, profile } = await requireAdminAndProfile(id);
    if (error) return error;

    return NextResponse.json({ rates: serialise(profile!.rates) });
  } catch (err: unknown) {
    console.error("Get professional pricing error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { error, profile } = await requireAdminAndProfile(id);
    if (error) return error;

    const body = await req.json();

    // Validate against the stored pair so a partial update (changing only one
    // side) is still checked against the other's current value.
    const result = validateRatesInput(body?.rates, profile!.rates ?? {});
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, field: result.field },
        { status: 400 },
      );
    }

    const $set = ratesToSetPaths(result.rates);
    const $unset = ratesToUnsetPaths(result.rates);

    if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) {
      return NextResponse.json({ rates: serialise(profile!.rates) });
    }

    const updated = await Profile.findOneAndUpdate(
      { userId: id },
      {
        ...(Object.keys($set).length ? { $set } : {}),
        ...(Object.keys($unset).length ? { $unset } : {}),
      },
      { new: true },
    );

    return NextResponse.json({ rates: serialise(updated?.rates) });
  } catch (err: unknown) {
    console.error("Update professional pricing error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
