import mongoose, { Schema, Document, Model } from "mongoose";

export type FaqAudience = "all" | "client" | "professional";

export interface IFaq extends Document {
  questionFr: string;
  questionEn: string;
  answerFr: string;
  answerEn: string;
  audience: FaqAudience;
  order: number;
  enabled: boolean;
  createdBy?: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const FaqSchema = new Schema<IFaq>(
  {
    questionFr: { type: String, required: true, trim: true },
    questionEn: { type: String, required: true, trim: true },
    answerFr: { type: String, required: true },
    answerEn: { type: String, required: true },
    audience: {
      type: String,
      enum: ["all", "client", "professional"],
      default: "all",
      index: true,
    },
    order: { type: Number, default: 0, index: true },
    enabled: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

FaqSchema.index({ enabled: 1, audience: 1, order: 1 });

const Faq: Model<IFaq> =
  mongoose.models.Faq || mongoose.model<IFaq>("Faq", FaqSchema);

export default Faq;
