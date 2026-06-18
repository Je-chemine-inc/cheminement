import mongoose, { Schema, Document, Model } from "mongoose";

export interface IClientReceipt extends Document {
  clientId: mongoose.Types.ObjectId;
  appointmentId: mongoose.Types.ObjectId;
  issuedAt: Date;
  amountCad: number;
  /** Unique invoice number carried over from the appointment (shown on the receipt). */
  invoiceNumber?: string;
  /**
   * paid = Stripe captured / Interac confirmed by admin;
   * pending_transfer = Interac instructions sent, awaiting admin confirmation;
   * refunded = payment was reversed, receipt voided (no longer client-visible)
   */
  status: "paid" | "pending_transfer" | "refunded";
}

const ClientReceiptSchema = new Schema<IClientReceipt>(
  {
    clientId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
      unique: true,
    },
    issuedAt: { type: Date, required: true, default: Date.now },
    amountCad: { type: Number, required: true },
    invoiceNumber: { type: String },
    status: {
      type: String,
      enum: ["paid", "pending_transfer", "refunded"],
      required: true,
    },
  },
  { timestamps: true },
);

ClientReceiptSchema.index({ clientId: 1, issuedAt: -1 });

const ClientReceipt: Model<IClientReceipt> =
  mongoose.models.ClientReceipt ||
  mongoose.model<IClientReceipt>("ClientReceipt", ClientReceiptSchema);

export default ClientReceipt;
