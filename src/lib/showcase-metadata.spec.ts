import { describe, it, expect } from "vitest";
import { DEFAULT_SHOWCASE_IMAGE, showcasePageMetadata } from "@/lib/showcase-metadata";

describe("showcase metadata", () => {
  it("sets an absolute canonical on www", () => {
    const meta = showcasePageMetadata({ path: "/amel-sassi", title: "Amel Sassi", description: "Psychologue à Mascouche" });
    expect(meta.alternates?.canonical).toBe("https://www.jechemine.ca/amel-sassi");
    expect(meta.openGraph?.url).toBe("https://www.jechemine.ca/amel-sassi");
    expect(JSON.stringify(meta)).not.toContain("psymascouche");
  });

  it("always sets the preview image and the twitter card, the site's own by default", () => {
    const meta = showcasePageMetadata({ path: "/x", title: "t", description: "d" });
    expect(meta.openGraph?.images).toEqual([DEFAULT_SHOWCASE_IMAGE]);
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", title: "t", images: [DEFAULT_SHOWCASE_IMAGE] });
    const photo = "https://www.jechemine.ca/api/files/0123456789abcdef01234567";
    expect(showcasePageMetadata({ path: "/x", title: "t", description: "d", image: photo }).openGraph?.images).toEqual([photo]);
  });

  it("keeps a page out of search results only when asked", () => {
    expect(showcasePageMetadata({ path: "/x", title: "t", description: "d" }).robots).toBeUndefined();
    expect(showcasePageMetadata({ path: "/x", title: "t", description: "d", index: false }).robots).toEqual({
      index: false,
      follow: true,
    });
  });
});
