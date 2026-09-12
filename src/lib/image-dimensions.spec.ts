import { describe, it, expect } from "vitest";
import { readImageDimensions } from "@/lib/image-dimensions";

const u32be = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const u16be = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};

function png(width: number, height: number) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32be(13),
    Buffer.from("IHDR"),
    u32be(width),
    u32be(height),
    Buffer.alloc(5),
  ]);
}

function jpeg(width: number, height: number, { frame = 0xc0, fill = false } = {}) {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0]), u16be(16), Buffer.alloc(14)]);
  const sof = Buffer.concat([
    Buffer.from(fill ? [0xff, 0xff, frame] : [0xff, frame]),
    u16be(17),
    Buffer.from([8]),
    u16be(height),
    u16be(width),
    Buffer.alloc(10),
  ]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

function riff(chunk: string, body: Buffer) {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(4 + 8 + body.length);
  const chunkSize = Buffer.alloc(4);
  chunkSize.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from("RIFF"), size, Buffer.from("WEBP"), Buffer.from(chunk), chunkSize, body]);
}

function webpVp8x(width: number, height: number) {
  const body = Buffer.alloc(10);
  body.writeUIntLE(width - 1, 4, 3);
  body.writeUIntLE(height - 1, 7, 3);
  return riff("VP8X", body);
}

function webpVp8l(width: number, height: number) {
  const body = Buffer.alloc(10);
  body[0] = 0x2f;
  body.writeUInt32LE(((width - 1) | ((height - 1) << 14)) >>> 0, 1);
  return riff("VP8L", body);
}

function webpVp8(width: number, height: number) {
  const body = Buffer.alloc(10);
  body[3] = 0x9d;
  body[4] = 0x01;
  body[5] = 0x2a;
  body.writeUInt16LE(width, 6);
  body.writeUInt16LE(height, 8);
  return riff("VP8 ", body);
}

describe("readImageDimensions", () => {
  it("reads PNG", () => {
    expect(readImageDimensions(png(1200, 800))).toEqual({ width: 1200, height: 800 });
  });

  it("reads baseline and progressive JPEG, past other segments and fill bytes", () => {
    expect(readImageDimensions(jpeg(900, 600))).toEqual({ width: 900, height: 600 });
    expect(readImageDimensions(jpeg(4032, 3024, { frame: 0xc2 }))).toEqual({ width: 4032, height: 3024 });
    expect(readImageDimensions(jpeg(640, 480, { fill: true }))).toEqual({ width: 640, height: 480 });
  });

  it("reads the three WebP flavours", () => {
    expect(readImageDimensions(webpVp8x(2000, 1500))).toEqual({ width: 2000, height: 1500 });
    expect(readImageDimensions(webpVp8l(1024, 768))).toEqual({ width: 1024, height: 768 });
    expect(readImageDimensions(webpVp8(800, 800))).toEqual({ width: 800, height: 800 });
  });

  it("returns null for anything it cannot read", () => {
    expect(readImageDimensions(Buffer.from("<svg width='900' height='900'></svg>"))).toBeNull();
    expect(readImageDimensions(Buffer.from("GIF89a\x10\x00\x10\x00"))).toBeNull();
    expect(readImageDimensions(Buffer.alloc(0))).toBeNull();
    expect(readImageDimensions(jpeg(900, 600).subarray(0, 25))).toBeNull();
    expect(readImageDimensions(png(0, 800))).toBeNull();
    // A JPEG whose scan starts before any frame header.
    expect(readImageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
});
