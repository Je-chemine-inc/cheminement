import mongoose, { Schema, Model } from "mongoose";

/**
 * Atomic named counters (e.g. fiscal invoice sequence). Each document is one
 * named sequence; `$inc` under findOneAndUpdate gives a race-safe monotonic
 * value even under concurrent closures. `_id` is the sequence name (a string),
 * so the interface intentionally does NOT extend mongoose's Document (whose
 * `_id` is an ObjectId).
 */
export interface ICounter {
  _id: string;
  seq: number;
}

const CounterSchema = new Schema<ICounter>({
  _id: { type: String },
  seq: { type: Number, default: 0 },
});

const Counter: Model<ICounter> =
  mongoose.models.Counter || mongoose.model<ICounter>("Counter", CounterSchema);

export default Counter;
