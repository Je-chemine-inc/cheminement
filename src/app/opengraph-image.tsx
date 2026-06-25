import { ImageResponse } from "next/og";
import { readFile } from "fs/promises";
import { join } from "path";

// Site-wide social/link-preview card (Open Graph + Twitter). Without an explicit
// og:image, sharing the link showed no thumbnail on most platforms — and the SMS
// scraper grabbed the wrong (Clinique Averroès) logo. This renders a clean
// 1200×630 Je chemine card that all platforms can use.
export const runtime = "nodejs";
export const alt = "Je chemine — Soins en santé mentale";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const logo = await readFile(join(process.cwd(), "public", "Logo.png"));
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#ffffff",
          padding: 80,
        }}
      >
        {/* Logo is 423×84 (~5:1); keep that ratio at a larger size. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} width={780} height={155} alt="Je chemine" />
        <div
          style={{
            marginTop: 60,
            fontSize: 58,
            fontWeight: 600,
            color: "#1f4e46",
            display: "flex",
          }}
        >
          Soins en santé mentale
        </div>
        <div
          style={{
            marginTop: 28,
            fontSize: 32,
            color: "#6b7280",
            display: "flex",
          }}
        >
          www.jechemine.ca
        </div>
      </div>
    ),
    { ...size },
  );
}
