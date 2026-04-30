import mongoose, { Schema, Document, Model } from "mongoose";

export interface IClientDocument extends Document {
  clientId: mongoose.Types.ObjectId;
  name: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  sharedBy: "client" | "professional" | "platform";
  sharedByUserId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ClientDocumentSchema = new Schema<IClientDocument>(
  {
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true },
    fileUrl: { type: String, required: true },
    fileType: { type: String, required: true },
    fileSize: { type: Number, required: true },
    sharedBy: {
      type: String,
      enum: ["client", "professional", "platform"],
      default: "client",
    },
    sharedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

ClientDocumentSchema.index({ clientId: 1, createdAt: -1 });

const ClientDocument: Model<IClientDocument> =
  mongoose.models.ClientDocument ||
  mongoose.model<IClientDocument>("ClientDocument", ClientDocumentSchema);

export default ClientDocument;
