import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * Records the id of every Stripe webhook event we have successfully processed,
 * so a redelivery (Stripe retries on any non-2xx, and may deliver more than
 * once even on success) is a no-op instead of re-firing side effects (duplicate
 * confirmation emails, double state writes). The unique index on `eventId` is
 * the dedup guarantee.
 */
export interface IStripeWebhookEvent extends Document {
  eventId: string;
  type: string;
  processedAt: Date;
}

const StripeWebhookEventSchema = new Schema<IStripeWebhookEvent>({
  eventId: { type: String, required: true, unique: true },
  type: { type: String, required: true },
  processedAt: { type: Date, required: true, default: Date.now },
});

const StripeWebhookEvent: Model<IStripeWebhookEvent> =
  mongoose.models.StripeWebhookEvent ||
  mongoose.model<IStripeWebhookEvent>(
    "StripeWebhookEvent",
    StripeWebhookEventSchema,
  );

export default StripeWebhookEvent;
