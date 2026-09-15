import { describe, it, expect } from "vitest";
import {
  AMBIENCE_IMAGES,
  PAGE_IMAGE_SLOTS,
  TALL_AMBIENCE_IMAGES,
  WIDE_AMBIENCE_IMAGES,
  pageImages,
  pickAmbience,
} from "@/lib/showcase-imagery";

describe("pickAmbience", () => {
  it("always gives a page the same photo, from Je chemine's set", () => {
    expect(pickAmbience("sassi")).toBe(pickAmbience("sassi"));
    expect(AMBIENCE_IMAGES).toContain(pickAmbience("sassi", 4));
  });

  it("gives distinct photos for distinct indexes", () => {
    const picked = new Set([0, 1, 2].map((index) => pickAmbience("tremblay", index)));
    expect(picked.size).toBe(3);
  });

  it("varies between pages", () => {
    const firsts = new Set(["sassi", "tremblay", "gagnon", "roy", "cote", "bouchard"].map((slug) => pickAmbience(slug)));
    expect(firsts.size).toBeGreaterThan(1);
  });
});

describe("pageImages", () => {
  it("fills every slot with ambience photos, never the same twice, when the professional added none", () => {
    const images = pageImages("sassi");
    expect(Object.keys(images)).toEqual([...PAGE_IMAGE_SLOTS]);
    const sources = Object.values(images).map((image) => image.src);
    expect(new Set(sources).size).toBe(PAGE_IMAGE_SLOTS.length);
    expect(Object.values(images).every((image) => !image.office)).toBe(true);
  });

  it("gives the wide slots landscape photos and the tall slot a portrait photo", () => {
    for (const slug of ["sassi", "tremblay", "gagnon", "roy"]) {
      const images = pageImages(slug);
      expect(WIDE_AMBIENCE_IMAGES).toContain(images.band.src);
      expect(WIDE_AMBIENCE_IMAGES).toContain(images.closing.src);
      expect(TALL_AMBIENCE_IMAGES).toContain(images.about.src);
    }
  });

  it("puts the professional's office photos first, in their order", () => {
    const images = pageImages("sassi", ["/api/files/a", "/api/files/b"]);
    expect(images.band).toEqual({ src: "/api/files/a", office: true });
    expect(images.about).toEqual({ src: "/api/files/b", office: true });
    expect(images.closing.office).toBe(false);
    expect(WIDE_AMBIENCE_IMAGES).toContain(images.closing.src);
  });

  it("uses the library photos the professional chose, office photos still first", () => {
    const chosen = { band: WIDE_AMBIENCE_IMAGES[2], about: TALL_AMBIENCE_IMAGES[1], closing: WIDE_AMBIENCE_IMAGES[0] };
    const images = pageImages("sassi", [], chosen);
    expect([images.band.src, images.about.src, images.closing.src]).toEqual([chosen.band, chosen.about, chosen.closing]);
    const withOffice = pageImages("sassi", ["/api/files/a"], chosen);
    expect(withOffice.band).toEqual({ src: "/api/files/a", office: true });
    expect(withOffice.about.src).toBe(chosen.about);
    // A photo that is not a library photo of the slot's shape is ignored.
    expect(WIDE_AMBIENCE_IMAGES).toContain(pageImages("sassi", [], { band: TALL_AMBIENCE_IMAGES[0] }).band.src);
  });

  it("never repeats a chosen photo in a slot left automatic", () => {
    for (const slug of ["sassi", "tremblay", "gagnon", "roy", "cote"]) {
      const automatic = pageImages(slug);
      const images = pageImages(slug, [], { band: automatic.closing.src });
      expect(images.band.src).toBe(automatic.closing.src);
      expect(images.closing.src).not.toBe(images.band.src);
    }
  });

  it("uses no more office photos than there are slots", () => {
    const images = pageImages("sassi", ["/1", "/2", "/3", "/4"]);
    expect(Object.values(images).map((image) => image.src)).toEqual(["/1", "/2", "/3"]);
  });
});
