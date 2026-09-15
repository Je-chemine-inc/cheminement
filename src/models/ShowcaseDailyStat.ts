import mongoose, { Schema, type Model } from "mongoose";

/**
 * Daily visit counts of the showcase pages (spec 003): anonymous aggregates,
 * with nothing that identifies a visitor. Scope "page" counts a
 * professional's page (key: the ShowcasePage id, stable when its address
 * changes); scope "city" counts a city's own pages, the city page and its
 * expertise pages (key: the city key).
 */
export const SHOWCASE_STAT_SCOPES = ["page", "city"] as const;
export type ShowcaseStatScope = (typeof SHOWCASE_STAT_SCOPES)[number];

export interface IShowcaseDailyStat {
  scope: ShowcaseStatScope;
  key: string;
  /** Calendar day in Montréal, "YYYY-MM-DD". */
  day: string;
  views: number;
  ctaClicks: number;
}

const ShowcaseDailyStatSchema = new Schema<IShowcaseDailyStat>(
  {
    scope: { type: String, enum: SHOWCASE_STAT_SCOPES, required: true },
    key: { type: String, required: true },
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    views: { type: Number, default: 0, min: 0 },
    ctaClicks: { type: Number, default: 0, min: 0 },
  },
  { versionKey: false },
);

// One row per page (or city) per day; increments upsert into it.
ShowcaseDailyStatSchema.index({ scope: 1, key: 1, day: 1 }, { unique: true });

const ShowcaseDailyStat: Model<IShowcaseDailyStat> =
  (mongoose.models.ShowcaseDailyStat as Model<IShowcaseDailyStat> | undefined) ||
  mongoose.model<IShowcaseDailyStat>("ShowcaseDailyStat", ShowcaseDailyStatSchema);

export default ShowcaseDailyStat;
