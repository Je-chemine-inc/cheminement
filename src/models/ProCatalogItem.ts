import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * Admin-managed catalogs of professional attributes that pros tick when filling
 * their signup / profile form: "mandats", "approches" and "expertises". Mirrors
 * the Motif model (bilingual label + active flag + audit refs) but adds a
 * `category` so all three live in one collection / admin UI.
 *
 * The pro's ticked items are merged into existing Profile arrays so the matcher
 * and public profile keep working unchanged: "approche" → Profile.approaches,
 * "mandat" + "expertise" → Profile.problematics (the field the matcher scores).
 */
export type ProCatalogCategory = "mandat" | "approche" | "expertise";

export const PRO_CATALOG_CATEGORIES: ProCatalogCategory[] = [
  "mandat",
  "approche",
  "expertise",
];

export interface IProCatalogItem extends Document {
  category: ProCatalogCategory;
  labelFr: string;
  labelEn?: string;
  aliases: string[];
  active: boolean;
  createdBy?: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ProCatalogItemSchema = new Schema<IProCatalogItem>(
  {
    category: {
      type: String,
      enum: PRO_CATALOG_CATEGORIES,
      required: true,
      index: true,
    },
    labelFr: {
      type: String,
      required: [true, "Le libellé français est obligatoire"],
      trim: true,
    },
    labelEn: { type: String, trim: true, default: "" },
    aliases: { type: [String], default: [] },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// Same label may exist in different categories, but is unique within one.
ProCatalogItemSchema.index({ category: 1, labelFr: 1 }, { unique: true });
ProCatalogItemSchema.index({ category: 1, active: 1 });

const ProCatalogItem: Model<IProCatalogItem> =
  mongoose.models.ProCatalogItem ||
  mongoose.model<IProCatalogItem>("ProCatalogItem", ProCatalogItemSchema);

export default ProCatalogItem;
