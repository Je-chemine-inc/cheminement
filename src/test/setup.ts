import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "fr",
}));

// Mock process.env
process.env.FIELD_ENCRYPTION_KEY = "aG9sYW11bmRvcGxhdGZvcm1rZXkyMDI0MDEyMzQ1Njc=";
// Satisfy the module-load guard in src/lib/mongodb.ts so libs that import it
// (transitively, e.g. appointment-routing → notifications → mongodb) can be
// imported in unit tests. No real connection is opened by pure-function tests.
process.env.MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/jechemine-test";
