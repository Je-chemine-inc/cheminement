import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { authOptions } from "@/lib/auth";
import { routeAppointmentToProfessionals } from "@/lib/appointment-routing";

/**
 * POST /api/appointments/[id]/refuse
 * Professional refuses a proposed appointment
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "professional") {
      return NextResponse.json(
        { error: "Only professionals can refuse appointments" },
        { status: 403 },
      );
    }

    await connectToDatabase();

    const { id } = await params;
    const { reason } = await req.json().catch(() => ({ reason: "" }));

    const appointment = await Appointment.findById(id);

    if (!appointment) {
      return NextResponse.json(
        { error: "Appointment not found" },
        { status: 404 },
      );
    }

    // Check if appointment can be refused
    if (appointment.status !== "pending") {
      return NextResponse.json(
        { error: "Appointment is no longer pending" },
        { status: 400 },
      );
    }

    if (appointment.professionalId) {
      return NextResponse.json(
        { error: "Appointment already assigned to a professional" },
        { status: 400 },
      );
    }

    // Check if this professional was proposed this appointment
    const isProposed = appointment.proposedTo?.some(
      (pId: { toString: () => string }) => pId.toString() === session.user.id,
    );

    if (!isProposed) {
      return NextResponse.json(
        { error: "You were not proposed this appointment" },
        { status: 403 },
      );
    }

    // Check if already refused
    const alreadyRefused = appointment.refusedBy?.some(
      (pId: { toString: () => string }) => pId.toString() === session.user.id,
    );

    if (alreadyRefused) {
      return NextResponse.json(
        { error: "You have already refused this appointment" },
        { status: 400 },
      );
    }

    // Record the refusal ATOMICALLY. A read-modify-write of the whole array
    // ($set) loses a refusal when two proposed pros refuse near-simultaneously
    // (the exact scenario this feature targets), which would mis-compute
    // allRefused and strand the request. $addToSet adds this pro safely (and
    // idempotently); we then read the FRESH doc to decide. Mirrors the
    // release/assign routes, which already use $addToSet for refusedBy.
    const fresh = await Appointment.findByIdAndUpdate(
      id,
      { $addToSet: { refusedBy: session.user.id } },
      { new: true },
    ).populate("clientId", "firstName lastName email phone location language");

    if (!fresh) {
      return NextResponse.json(
        { error: "Appointment not found" },
        { status: 404 },
      );
    }

    // Have ALL proposed pros now refused? Computed from the fresh doc, so it's
    // correct under concurrency: $addToSet writes are serialized, so only the
    // LAST refusal to commit sees every proposedTo id covered — exactly one
    // caller reaches the re-route below.
    const refusedSet = new Set(
      (fresh.refusedBy ?? []).map((r: { toString: () => string }) =>
        r.toString(),
      ),
    );
    const allRefused =
      (fresh.proposedTo?.length ?? 0) > 0 &&
      (fresh.proposedTo ?? []).every((pId: { toString: () => string }) =>
        refusedSet.has(pId.toString()),
      );

    // CASE 1 — other proposed pros haven't answered yet: keep the request in the
    // targeted "proposed" flow so the remaining pros can still accept.
    if (!allRefused) {
      return NextResponse.json({
        message: "Appointment refused successfully",
        movedToGeneral: false,
        rerouted: false,
        appointment: fresh,
      });
    }

    // CASE 2 — the LAST proposed pro just refused, so no targeted candidate is
    // left. Re-run jumelage (which now EXCLUDES everyone in refusedBy) to
    // propose to the next-best eligible pro, falling to the general pool only if
    // none remains. Claim the transition atomically — only the caller that flips
    // THIS exact proposed set (routingStatus "proposed" + same proposedTo) to
    // "pending" performs the re-route; any racing/duplicate caller gets null and
    // skips, preventing a double proposal/double email.
    const claimed = await Appointment.findOneAndUpdate(
      { _id: id, routingStatus: "proposed", proposedTo: fresh.proposedTo },
      {
        $set: { routingStatus: "pending" },
        $unset: { proposedTo: "", proposedAt: "" },
        // Advance the cascade — this is the ONLY genuine-refusal increment, done
        // atomically with the claim so exactly one winner counts the attempt.
        $inc: { cascadeAttempts: 1 },
      },
      { new: true },
    );

    if (!claimed) {
      // A concurrent refusal already kicked off the re-route — report the
      // current state without routing again.
      const current = await Appointment.findById(id).populate(
        "clientId",
        "firstName lastName email phone location language",
      );
      return NextResponse.json({
        message: "Appointment refused successfully",
        movedToGeneral: current?.routingStatus === "general",
        rerouted: current?.routingStatus === "proposed",
        appointment: current,
      });
    }

    // The claim above is the serialization point — exactly one caller flips this
    // proposed set to "pending" — so the actual re-route runs OUTSIDE the request
    // path. Defer it to after(): the matcher awaits its own SMTP fan-out
    // (proposal emails, or the general-pool broadcast), and after() both keeps
    // the response from blocking on those sends AND keeps the Vercel container
    // alive until they finish (the matcher's documented contract). The client
    // (proposals page) just re-fetches, so it doesn't read the body below.
    after(async () => {
      try {
        // Re-run jumelage. The matcher either re-proposes to the next eligible
        // pro ("proposed"), or — once the 2-attempt cascade is exhausted — drops
        // the dossier into the general pool ("general") so any active pro can
        // self-claim it, and alerts admins itself. "skipped" means a concurrent
        // admin action took over.
        await routeAppointmentToProfessionals(id);
      } catch (err) {
        console.error("[refuse] re-route error:", err);
      }
    });

    return NextResponse.json({
      message: "Appointment refused; re-routing to another professional",
      movedToGeneral: false,
      rerouted: false,
      processing: true,
      appointment: claimed,
    });
  } catch (error) {
    console.error("Refuse appointment error:", error);
    return NextResponse.json(
      { error: "Failed to refuse appointment" },
      { status: 500 },
    );
  }
}
