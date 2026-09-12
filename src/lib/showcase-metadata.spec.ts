import { describe, it, expect } from "vitest";
import {
  DEFAULT_SHOWCASE_IMAGE,
  showcaseLayoutMetadata,
  showcasePageMetadata,
} from "@/lib/showcase-metadata";

describe("showcase metadata", () => {
  it("resolves relative URLs against the city host", () => {
    expect(String(showcaseLayoutMetadata("mascouche").metadataBase)).toBe(
      "https://psymascouche.jechemine.ca/",
    );
  });

  it("sets an absolute canonical on the city host, never the internal path", () => {
    const meta = showcasePageMetadata({
      cityKey: "mascouche",
      path: "/sassi",
      title: "Sassi",
      description: "Psychologue à Mascouche",
    });
    expect(meta.alternates?.canonical).toBe("https://psymascouche.jechemine.ca/sassi");
    expect(JSON.stringify(meta)).not.toContain("/showcase/");
    expect(meta.openGraph?.url).toBe("https://psymascouche.jechemine.ca/sassi");
  });

  it("always sets the preview image and the twitter card, the site's own by default", () => {
    const meta = showcasePageMetadata({ cityKey: "quebec", path: "/", title: "t", description: "d" });
    expect(meta.openGraph?.images).toEqual([DEFAULT_SHOWCASE_IMAGE]);
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", title: "t", images: [DEFAULT_SHOWCASE_IMAGE] });
    const withPhoto = showcasePageMetadata({
      cityKey: "quebec",
      path: "/x",
      title: "t",
      description: "d",
      image: "https://psyquebec.jechemine.ca/api/files/0123456789abcdef01234567",
    });
    expect(withPhoto.openGraph?.images).toEqual([
      "https://psyquebec.jechemine.ca/api/files/0123456789abcdef01234567",
    ]);
  });

  it("keeps a page out of search results only when asked", () => {
    expect(showcasePageMetadata({ cityKey: "quebec", path: "/", title: "t", description: "d" }).robots).toBeUndefined();
    expect(
      showcasePageMetadata({ cityKey: "quebec", path: "/", title: "t", description: "d", index: false }).robots,
    ).toEqual({ index: false, follow: true });
  });
});
