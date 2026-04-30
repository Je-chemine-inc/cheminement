import mongoose, { Schema, Document, Model } from "mongoose";

export interface IConversation extends Document {
  participants: mongoose.Types.ObjectId[];
  subject: string;
  lastMessageAt: Date;
  lastMessagePreview: string;
  unreadCounts: Map<string, number>;
  createdAt: Date;
  updatedAt: Date;
}

const ConversationSchema = new Schema<IConversation>(
  {
    participants: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    lastMessageAt: { type: Date, default: Date.now },
    lastMessagePreview: { type: String, default: "", maxlength: 300 },
    unreadCounts: { type: Map, of: Number, default: {} },
  },
  { timestamps: true },
);

ConversationSchema.index({ participants: 1, lastMessageAt: -1 });

const Conversation: Model<IConversation> =
  mongoose.models.Conversation ||
  mongoose.model<IConversation>("Conversation", ConversationSchema);

export default Conversation;
