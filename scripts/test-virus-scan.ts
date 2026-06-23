/**
 * Smoke-test the malware scanner end to end — proves the Cloudmersive key works
 * WITHOUT uploading anything to the app or touching the database.
 *
 *   1) a clean PDF         -> expect "clean"   (or "skipped" if no key set)
 *   2) the EICAR test file -> expect "infected"
 *
 * EICAR is the industry-standard, completely HARMLESS 68-byte string that every
 * antivirus engine deliberately flags as a virus, precisely so you can verify
 * scanning works without using real malware. (https://www.eicar.org)
 *
 * Usage — put the key in .env.local (CLOUDMERSIVE_API_KEY=...) then:
 *     npx tsx scripts/test-virus-scan.ts
 *   or pass it inline:
 *     CLOUDMERSIVE_API_KEY=xxxxx npx tsx scripts/test-virus-scan.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { scanBufferForViruses } from "../src/lib/virus-scan";

const EICAR =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

async function main() {
  if (!process.env.CLOUDMERSIVE_API_KEY) {
    console.log(
      "\n⚠  CLOUDMERSIVE_API_KEY is not set — the scanner will report 'skipped'.\n" +
        "   Add it to .env.local (CLOUDMERSIVE_API_KEY=...) or pass it inline, then re-run.\n",
    );
  }

  const cleanPdf = Buffer.from(
    "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF",
  );
  const clean = await scanBufferForViruses(cleanPdf, "clean.pdf");
  console.log(
    `clean.pdf  -> ${clean.status}${clean.detail ? ` (${clean.detail})` : ""}`,
  );

  const eicar = await scanBufferForViruses(Buffer.from(EICAR, "ascii"), "eicar.txt");
  console.log(
    `eicar.txt  -> ${eicar.status}${eicar.detail ? ` (${eicar.detail})` : ""}`,
  );

  if (eicar.status === "infected") {
    console.log(
      "\n✅ Antivirus is WORKING — the test virus was detected and would be rejected at upload.",
    );
  } else if (eicar.status === "skipped") {
    console.log(
      "\nℹ  No key configured yet. Set CLOUDMERSIVE_API_KEY and re-run to activate scanning.",
    );
  } else {
    console.log(
      `\n❌ Expected the EICAR test file to be 'infected' but got '${eicar.status}'.` +
        "\n   Check the key is valid and the plan has the ADVANCED virus scan enabled.",
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
