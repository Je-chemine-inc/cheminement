/**
 * Width and height of a JPEG, PNG or WebP image, read from its header bytes.
 *
 * No image library: `sharp` is only bundled for Next's own image optimizer,
 * not for application code. Returns null for anything it cannot read, which
 * callers treat as "not a usable photo". Pure.
 */
export interface ImageDimensions {
  width: number;
  height: number;
}

function positive(width: number, height: number): ImageDimensions | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Start-of-frame markers that carry the frame size (not DHT/JPG/DAC). */
const JPEG_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function readJpeg(buf: Buffer): ImageDimensions | null {
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) return null;
    let marker = buf[offset + 1];
    // Any number of 0xFF fill bytes may precede a marker.
    while (marker === 0xff && offset + 2 < buf.length) {
      offset++;
      marker = buf[offset + 1];
    }
    // Markers without a length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    // End of image, or the scan began before any frame header.
    if (marker === 0xd9 || marker === 0xda) return null;
    if (offset + 4 > buf.length) return null;
    const length = buf.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (JPEG_FRAME_MARKERS.has(marker)) {
      // FF Cx | length(2) | precision(1) | height(2) | width(2)
      if (offset + 9 > buf.length) return null;
      return positive(buf.readUInt16BE(offset + 7), buf.readUInt16BE(offset + 5));
    }
    offset += 2 + length;
  }
  return null;
}

function readWebp(buf: Buffer): ImageDimensions | null {
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    // Canvas width-1 and height-1, 3 bytes little-endian each.
    return positive(1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3));
  }
  if (chunk === "VP8L") {
    if (buf[20] !== 0x2f) return null;
    const b0 = buf[21];
    const b1 = buf[22];
    const b2 = buf[23];
    const b3 = buf[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return positive(width, height);
  }
  if (chunk === "VP8 ") {
    // Key frame start code, then 14-bit width and height.
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return positive(buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff);
  }
  return null;
}

export function readImageDimensions(buf: Buffer): ImageDimensions | null {
  if (
    buf.length >= 24 &&
    buf.readUInt32BE(0) === 0x89504e47 &&
    buf.toString("ascii", 12, 16) === "IHDR"
  ) {
    return positive(buf.readUInt32BE(16), buf.readUInt32BE(20));
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    return readJpeg(buf);
  }
  if (
    buf.length >= 30 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return readWebp(buf);
  }
  return null;
}
