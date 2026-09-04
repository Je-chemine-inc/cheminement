import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import connectToDatabase from "@/lib/mongodb";
import Appointment from "@/models/Appointment";
import { authOptions } from "@/lib/auth";
import {
  SESSION_ACT_NATURE_VALUES,
  SESSION_OUTCOME_VALUES,
  getAppointmentStatusForOutcome,
  getBillingFraction,
  isLateOrNoShow,
  roundMoney,
  type SessionActNature,
  type SessionOutcome,
} from "@/lib/session-closure";
import User from "@/models/User";
import {
  chargeSavedPaymentMethodAfterSession,
  resolveCustomerChargeablePaymentMethod,
} from "@/lib/stripe-off-session-charge";
import { buildInteracReferenceCode } from "@/lib/interac-reference";
import { parseAppointmentDate } from "@/lib/appointment-date";
import { calculateAppointmentPricing } from "@/lib/pricing";
import { encryptPaymentMethodReference } from "@/lib/field-encryption";
import { runSessionClosureSideEffects } from "@/lib/session-post-closure";
import { getAppointmentStartAt } from "@/lib/appointment-start";
import { sessionClosureWindow } from "@/lib/session-closure-window";

function parseNextAppointmentAt(
  dateStr: string | undefined,
  timeStr: string | undefined,
): Date | undefined {
  if (!dateStr?.trim() || !timeStr?.trim()) return undefined;
  const [h, m] = timeStr.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return undefined;
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return undefined;
  d.setHours(h, m, 0, 0);
  return d;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Track the atomic closure claim so the catch can release it if we fail
  // before finalizing — lets the professional retry safely. Declared outside
  // the try so they're in scope of the catch block.
  let claimedAppointmentId: string | null = null;
  let closureFinalized = false;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.role !== "professional") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();
    const { id } = await params;

    const body = await req.json();
    const sessionActNature = body.sessionActNature as string | undefined;
    const sessionActNatureOther = body.sessionActNatureOther as
      | string
      | undefined;
    const sessionOutcome = body.sessionOutcome as string | undefined;
    const nextAppointmentDate = body.nextAppointmentDate as string | undefined;
    const nextAppointmentTime = body.nextAppointmentTime as string | undefined;

    if (
      !sessionOutcome ||
      !SESSION_OUTCOME_VALUES.includes(sessionOutcome as SessionOutcome)
    ) {
      return NextResponse.json(
        { error: "Invalid or missing sessionOutcome" },
        { status: 400 },
      );
    }

    const outcome = sessionOutcome as SessionOutcome;

    // sessionActNature is required ONLY for completed sessions (drives the
    // receipt line). For >48h cancellations no receipt is issued. For late
    // cancellations / no-shows the invoice is auto-labelled "Frais de gestion
    // de dossier" because no clinical act was performed.
    const skipActRequirement = outcome !== "completed";
    if (!skipActRequirement) {
      if (
        !sessionActNature ||
        !SESSION_ACT_NATURE_VALUES.includes(
          sessionActNature as SessionActNature,
        )
      ) {
        return NextResponse.json(
          { error: "Invalid or missing sessionActNature" },
          { status: 400 },
        );
      }
    } else if (
      sessionActNature &&
      !SESSION_ACT_NATURE_VALUES.includes(sessionActNature as SessionActNature)
    ) {
      return NextResponse.json(
        { error: "Invalid sessionActNature" },
        { status: 400 },
      );
    }
    const autoLabelManagementFees = isLateOrNoShow(outcome);
    const nextAt = parseNextAppointmentAt(
      nextAppointmentDate,
      nextAppointmentTime,
    );

    const apt = await Appointment.findById(id);
    if (!apt) {
      return NextResponse.json(
        { error: "Appointment not found" },
        { status: 404 },
      );
    }

    if (!apt.professionalId) {
      return NextResponse.json(
        { error: "Appointment has no assigned professional" },
        { status: 400 },
      );
    }

    if (apt.professionalId.toString() !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!["ongoing", "scheduled"].includes(apt.status)) {
      return NextResponse.json(
        {
          error:
            "Session can only be closed when status is ongoing or scheduled",
        },
        { status: 400 },
      );
    }

    if (apt.sessionCompletedAt) {
      return NextResponse.json(
        { error: "Session has already been closed" },
        { status: 400 },
      );
    }

    // A session cannot be closed before it has (nearly) started. Closing is
    // what issues the invoice, creates the receipt and starts the dunning
    // clock, so closing a FUTURE session bills a client for a session they
    // have not attended — exactly what produced JC-2026-000014: a 9 September
    // session closed on 31 August, then chased through the whole reminder
    // cascade while the client had in fact paid everything she owed.
    // See lib/session-closure-window.ts.
    if (!sessionClosureWindow(getAppointmentStartAt(apt)).closable) {
      return NextResponse.json(
        {
          error:
            "This session has not started yet, so it cannot be closed. Check the date on the appointment.",
          code: "SESSION_NOT_STARTED",
        },
        { status: 400 },
      );
    }

    // Atomically claim the closure BEFORE charging. The guard above is a
    // non-atomic read (findById here; sessionCompletedAt is only persisted by
    // the findByIdAndUpdate near the end of this handler), so two concurrent
    // requests — pro double-click, network retry, second tab — could both pass
    // it and then both charge the saved card / re-run the closure side effects
    // (duplicate receipt emails). Claiming via findOneAndUpdate on
    // sessionCompletedAt:null (Mongo equality-to-null also matches a missing
    // field) lets exactly one request win; the loser short-circuits here.
    const now = new Date();
    const claimed = await Appointment.findOneAndUpdate(
      { _id: id, sessionCompletedAt: null },
      { $set: { sessionCompletedAt: now } },
    );
    if (!claimed) {
      return NextResponse.json(
        { error: "Session has already been closed" },
        { status: 400 },
      );
    }
    claimedAppointmentId = id;

    const newStatus = getAppointmentStatusForOutcome(outcome);
    const fraction = getBillingFraction(outcome);

    const listPrice = roundMoney(
      apt.payment.listPrice ?? apt.payment.price ?? 0,
    );

    const paymentLocked =
      apt.payment.status === "paid" || apt.payment.status === "refunded";

    let price = apt.payment.price;
    let platformFee = apt.payment.platformFee;
    let professionalPayout = apt.payment.professionalPayout;
    let paymentStatus = apt.payment.status;

    if (!paymentLocked) {
      price = roundMoney(listPrice * fraction);
      // Preserve the split agreed at booking (or set by an admin re-price):
      // the professional keeps their share, the platform keeps the spread.
      // Re-deriving the fee from a percentage here silently overrode an
      // admin-configured split — and did it from PLATFORM_FEE_PERCENTAGE (env)
      // while booking used PlatformSettings.platformFeePercentage (db), so the
      // two disagreed and the charge used the wrong one.
      const storedPrice = roundMoney(apt.payment.price ?? 0);
      const storedPayout = roundMoney(apt.payment.professionalPayout ?? 0);
      const payoutRatio = storedPrice > 0 ? storedPayout / storedPrice : 0;
      professionalPayout = roundMoney(price * payoutRatio);
      // Derived last so `price === platformFee + professionalPayout` always holds.
      platformFee = roundMoney(price - professionalPayout);
      if (price <= 0) {
        paymentStatus = "cancelled";
      } else {
        paymentStatus = "pending";
      }
    }

    // Trigger payment / Interac reference for every outcome that bills
    // (completed = 100%, cancelled_late = 100%, no_show = 100%). The
    // free 48h-plus cancellation has fraction = 0 and is skipped.
    const billableForPayment =
      !paymentLocked && price > 0 && getBillingFraction(outcome) > 0;

    let stripeChargePaymentIntentId: string | undefined;
    let interacRefToSet: string | undefined;

    // Tracks whether closure had to skip the auto-charge so the caller can
    // surface a soft warning ("billing profile incomplete — invoice is pending").
    let chargeSkippedReason: string | undefined;

    // When the charge falls back to the customer's stored instrument, record
    // it on the appointment. Persistence here goes through `$set` +
    // findByIdAndUpdate, so mutating `apt` in place would be silently lost.
    let persistPaymentMethodRef: string | undefined;
    let persistPaymentMethod: "card" | "direct_debit" | undefined;

    if (billableForPayment) {
      const payMethod = apt.payment.method || "card";
      if (payMethod === "card" || payMethod === "direct_debit") {
        const clientUser = await User.findById(apt.clientId);
        if (!clientUser?.stripeCustomerId) {
          // Soft-skip: allow closure to proceed; invoice stays pending.
          paymentStatus = "pending";
          chargeSkippedReason = "MISSING_BILLING_PROFILE";
        } else {
          // The appointment usually carries its own payment-method reference
          // (written by the appointment-setup routes). When it does not — a
          // repeat booking by a client who already saved a card, an
          // admin-scheduled session — fall back to what Stripe holds on the
          // CUSTOMER. Without this the session closed unbilled with a
          // perfectly good card on file. See lib/chargeable-payment-method.ts.
          let chargePaymentMethod: string | undefined =
            apt.payment.stripePaymentMethodId;
          let chargeMethod: "card" | "direct_debit" = payMethod;
          let resolvedFromCustomer: string | undefined;

          if (!chargePaymentMethod) {
            const fallback = await resolveCustomerChargeablePaymentMethod(
              clientUser.stripeCustomerId,
            );
            if (fallback) {
              // The instrument decides the rails, not the appointment: a PAD
              // charged as a card is rejected outright by Stripe.
              chargeMethod = fallback.method;
              resolvedFromCustomer = fallback.paymentMethodId;
              chargePaymentMethod =
                encryptPaymentMethodReference(fallback.paymentMethodId) ??
                fallback.paymentMethodId;
            }
          }

          if (!chargePaymentMethod) {
            paymentStatus = "pending";
            chargeSkippedReason = "MISSING_PAYMENT_METHOD";
          } else {
          try {
            const { paymentIntentId, settled } =
              await chargeSavedPaymentMethodAfterSession({
                appointmentId: id,
                customerId: clientUser.stripeCustomerId,
                encryptedPaymentMethodId: chargePaymentMethod,
                amountCad: price,
                method: chargeMethod,
              });
            // Record what we actually charged, so the receipt, any refund and
            // the dunning gate all agree with reality.
            if (resolvedFromCustomer) {
              persistPaymentMethodRef = chargePaymentMethod;
              persistPaymentMethod = chargeMethod;
            }
            stripeChargePaymentIntentId = paymentIntentId;
            // M1: ACSS/PAD confirms async as "processing" — record it as such
            // and let the payment_intent.succeeded webhook flip it to "paid".
            paymentStatus = settled ? "paid" : "processing";
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            // Auto-charge failure no longer blocks closure — leave invoice
            // pending and surface a warning so the professional knows.
            paymentStatus = "pending";
            chargeSkippedReason = msg || "CHARGE_FAILED";
          }
          }
        }
      } else if (payMethod === "transfer") {
        interacRefToSet =
          apt.payment.interacReferenceCode ||
          buildInteracReferenceCode(
            String(apt._id),
            apt.professionalId?.toString(),
          );
      }
    }

    const due = new Date();
    due.setHours(due.getHours() + 24);

    const $set: Record<string, unknown> = {
      status: newStatus,
      sessionOutcome: outcome,
      sessionCompletedAt: now,
      "payment.listPrice": apt.payment.listPrice ?? listPrice,
    };

    if (sessionActNature) {
      $set.sessionActNature = sessionActNature;
    } else if (autoLabelManagementFees) {
      $set.sessionActNature = "";
    }

    if (sessionActNatureOther?.trim()) {
      $set.sessionActNatureOther = sessionActNatureOther.trim();
    } else if (autoLabelManagementFees) {
      $set.sessionActNatureOther = "Frais de gestion de dossier";
    }

    if (!paymentLocked) {
      $set["payment.price"] = price;
      $set["payment.platformFee"] = platformFee;
      $set["payment.professionalPayout"] = professionalPayout;
      $set["payment.status"] = paymentStatus;
      if (persistPaymentMethodRef) {
        $set["payment.stripePaymentMethodId"] = persistPaymentMethodRef;
        $set["payment.method"] = persistPaymentMethod;
      }
    }

    if (stripeChargePaymentIntentId) {
      $set["payment.stripePaymentIntentId"] = stripeChargePaymentIntentId;
      // M1: only stamp paidAt when the charge actually settled. An ACSS/PAD
      // charge still "processing" gets paidAt from the succeeded webhook later.
      if (paymentStatus === "paid") {
        $set["payment.paidAt"] = now;
      }
    }

    if (interacRefToSet) {
      $set["payment.interacReferenceCode"] = interacRefToSet;
    }

    if (nextAt) {
      $set.nextAppointmentAt = nextAt;
    }

    if (newStatus === "cancelled") {
      $set.cancelReason =
        outcome === "cancelled_late"
          ? "cancelled_late"
          : "cancelled_48h_advance";
      $set.cancelledBy = "professional";
      $set.cancelledAt = now;
    }

    const shouldSetTransferDue =
      !paymentLocked &&
      price > 0 &&
      apt.payment.method === "transfer" &&
      getBillingFraction(outcome) > 0;

    if (shouldSetTransferDue) {
      $set["payment.transferDueAt"] = due;
    }

    const updated = await Appointment.findByIdAndUpdate(
      id,
      { $set },
      { new: true },
    )
      .populate("clientId", "firstName lastName email phone location")
      .populate("professionalId", "firstName lastName email phone");

    if (!updated) {
      return NextResponse.json(
        { error: "Appointment not found" },
        { status: 404 },
      );
    }
    // Closure is persisted — from here on the claim must never be rolled back,
    // even if a later step (side effects, re-fetch) throws.
    closureFinalized = true;

    try {
      await runSessionClosureSideEffects(id);
    } catch (e) {
      console.error("runSessionClosureSideEffects:", e);
    }

    // Create the follow-up appointment the professional entered.
    //
    // `nextAppointmentAt` used to be stored as a bare note on the session
    // being closed and nothing ever read it back — so a "prochain
    // rendez-vous" typed here never reached the schedule, and the client was
    // never told. The professional believed the next session was booked.
    //
    // Runs AFTER the closure is persisted and never throws outward: the
    // session is already closed and billed, so a follow-up that cannot be
    // created must not undo that. The date goes through parseAppointmentDate
    // (UTC-noon anchor) like every other appointment date.
    if (nextAt && nextAppointmentDate && nextAppointmentTime) {
      try {
        const followUpDate = parseAppointmentDate(nextAppointmentDate);
        const alreadyLinked = (updated as { nextAppointmentId?: unknown })
          .nextAppointmentId;

        if (followUpDate && !alreadyLinked) {
          // Never double-book the professional.
          const clash = await Appointment.findOne({
            professionalId: apt.professionalId,
            date: followUpDate,
            time: nextAppointmentTime,
            status: "scheduled",
          });

          if (clash) {
            console.warn(
              `[complete-session] follow-up ${nextAppointmentDate} ${nextAppointmentTime} clashes with ${clash._id} — not created`,
            );
          } else {
            const followUpPricing = await calculateAppointmentPricing(
              String(apt.professionalId),
              apt.therapyType,
            );
            const followUp = await Appointment.create({
              clientId: apt.clientId,
              professionalId: apt.professionalId,
              date: followUpDate,
              time: nextAppointmentTime,
              duration: apt.duration || 60,
              type: apt.type,
              therapyType: apt.therapyType,
              // Carry the context forward so the new session is a real
              // continuation of the file, not an orphan row.
              bookingFor: apt.bookingFor,
              lovedOneInfo: apt.lovedOneInfo,
              referralInfo: apt.referralInfo,
              issueType: apt.issueType,
              needs: apt.needs,
              location: apt.location,
              status: "scheduled",
              routingStatus: "accepted",
              firstScheduledAt: new Date(),
              payment: {
                price: followUpPricing.sessionPrice,
                platformFee: followUpPricing.platformFee,
                professionalPayout: followUpPricing.professionalPayout,
                status: "pending",
                method: apt.payment?.method || "card",
                stripePaymentMethodId: apt.payment?.stripePaymentMethodId,
              },
            });
            await Appointment.findByIdAndUpdate(id, {
              $set: { nextAppointmentId: followUp._id },
            });
            console.log(
              `[complete-session] follow-up ${followUp._id} created for ${nextAppointmentDate} ${nextAppointmentTime}`,
            );
          }
        }
      } catch (e) {
        console.error("[complete-session] follow-up creation failed:", e);
      }
    }

    const finalDoc = await Appointment.findById(id)
      .populate("clientId", "firstName lastName email phone location")
      .populate("professionalId", "firstName lastName email phone");

    const responseDoc = finalDoc ?? updated;
    if (chargeSkippedReason) {
      const responseObj =
        typeof (responseDoc as { toObject?: () => unknown }).toObject ===
        "function"
          ? (responseDoc as { toObject: () => Record<string, unknown> }).toObject()
          : (responseDoc as unknown as Record<string, unknown>);
      return NextResponse.json({
        ...responseObj,
        chargeSkippedReason,
      });
    }
    return NextResponse.json(responseDoc);
  } catch (error: unknown) {
    // If we claimed the closure but never finalized it, release the claim so
    // the professional can retry. The Stripe charge is idempotency-keyed, so a
    // retry won't double-charge; and if the charge already succeeded, the
    // payment_intent.succeeded webhook still reconciles the payment status.
    if (claimedAppointmentId && !closureFinalized) {
      await Appointment.findByIdAndUpdate(claimedAppointmentId, {
        $unset: { sessionCompletedAt: "" },
      }).catch(() => {});
    }
    console.error("complete-session error:", error);
    return NextResponse.json(
      {
        error: "Failed to complete session",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
