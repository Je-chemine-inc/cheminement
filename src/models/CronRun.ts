import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * Heartbeat record for the in-app "lazy cron" (src/lib/lazy-cron.ts). One doc
 * per job key holds the last time the job ran, so an opportunistic trigger fired
 * from hot API routes runs the job at most once per window — and exactly once
 * across concurrent serverless instances (the claim is an atomic findOneAndUpdate
 * on `lastRunAt`). This lets the matching cascade advance off normal traffic
 * without depending on an external scheduler (GitHub Actions / Vercel Pro).
 */
export interface ICronRun extends Document {
  key: string;
  lastRunAt: Date;
}

const CronRunSchema = new Schema<ICronRun>({
  key: { type: String, required: true, unique: true },
  lastRunAt: { type: Date, required: true, default: () => new Date(0) },
});

const CronRun: Model<ICronRun> =
  mongoose.models.CronRun || mongoose.model<ICronRun>("CronRun", CronRunSchema);

export default CronRun;
