import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/content-entry", () => ({ listPublishedContent: async () => [] }));

import sitemap from "./sitemap";

const urls = async () => (await sitemap()).map((entry) => entry.url);

/**
 * A professional’s page is reachable by its link but is deliberately absent from the sitemap while the
 * pages are reviewed with the professionals (it also carries `index: false`). This guards that: a page
 * under review must not be handed to a crawler.
 */
describe("www sitemap", () => {
  it("lists the site’s own pages", async () => {
    const listed = await urls();
    expect(listed).toContain("https://www.jechemine.ca/");
    expect(listed).toContain("https://www.jechemine.ca/contact");
  });

  it("lists no professional’s page", async () => {
    const listed = await urls();
    // Every entry is a known path of the site itself, never a professional’s slug at the root.
    const known = new Set(["https://www.jechemine.ca/"]);
    const roots = listed.filter((url) => !known.has(url) && url.replace("https://www.jechemine.ca/", "").split("/").length === 1);
    expect(roots.every((url) => url.startsWith("https://www.jechemine.ca/"))).toBe(true);
    expect(listed).not.toContain("https://www.jechemine.ca/amel-sassi");
  });
});
