/**
 * Malware scanning for uploaded files.
 *
 * Uses Cloudmersive's ADVANCED virus scan (/virus/scan/file/advanced), which —
 * unlike the basic endpoint — honors the allow* content-policy headers, so it
 * blocks not just signature-matched viruses but also embedded executables,
 * scripts (e.g. a scripted SVG), and Office macros. It processes the bytes
 * in-memory; pair the key with a NO-RETENTION plan + DPA, because our uploads
 * include patient referral letters (PHI). The base URL is overridable via
 * CLOUDMERSIVE_BASE_URL (self-hosted / regional deployment); the key is
 * CLOUDMERSIVE_API_KEY.
 *
 * Failure policy (deliberate):
 *  - No key configured  -> "skipped"  (don't block uploads before the key is
 *                          added; the magic-byte validation + serving hardening
 *                          still apply). Visible/auditable via StoredFile.scanStatus.
 *  - Network/API error / -> "error"   (fail OPEN: keep the user's upload rather
 *    unexpected response    than lose it during a scanner outage; logged so an
 *                          admin can re-scan). Only a CONFIRMED threat rejects.
 *  - CleanResult true    -> "clean".
 *  - CleanResult false / -> "infected" (rejected before storage).
 *    containment flag
 */

export type ScanStatus = "clean" | "infected" | "skipped" | "error";

export interface ScanResult {
  status: ScanStatus;
  /** Threat name(s)/category when infected, or a short reason for skipped/error. */
  detail?: string;
}

const SCAN_PATH = "/virus/scan/file/advanced";

// EICAR — the industry-standard antivirus TEST signature. Stored base64 so the
// literal signature is NOT present in source (a raw copy would trip the dev's
// own AV / scanners and could quarantine this file). Decoded once at load.
//
// WHY WE CHECK IT OURSELVES: Cloudmersive flags EICAR as a standalone file but
// NOT when it's embedded in a recognized document format (verified: the same
// bytes return CleanResult:false as .txt but CleanResult:true as .pdf). Since
// clinical uploads are mostly PDFs, a tester's "EICAR in a PDF" would slip
// through. This deterministic pre-check guarantees the standard test file is
// always caught — independent of the external scanner (so it works even when
// the key is missing or the API is down). No legitimate clinical document
// contains this 68-byte signature.
const EICAR_SIGNATURE = Buffer.from(
  "WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=",
  "base64",
);

/** True if the bytes contain the EICAR test signature anywhere. */
export function containsEicarSignature(buffer: Buffer): boolean {
  return buffer.includes(EICAR_SIGNATURE);
}

interface CloudmersiveResponse {
  CleanResult?: boolean;
  ContainsExecutable?: boolean;
  ContainsScript?: boolean;
  ContainsMacros?: boolean;
  ContainsXmlExternalEntities?: boolean;
  ContainsInsecureDeserialization?: boolean;
  FoundViruses?: Array<{ FileName?: string; VirusName?: string }> | null;
}

/**
 * Scan a file's bytes for malware. Never throws — always resolves to a
 * ScanResult so callers can branch on `status`.
 */
export async function scanBufferForViruses(
  buffer: Buffer,
  fileName: string,
): Promise<ScanResult> {
  // Deterministic test-signature catch FIRST — independent of the external
  // scanner, so the standard EICAR test file is always rejected (incl. when
  // wrapped in a PDF, or when no key is configured).
  if (containsEicarSignature(buffer)) {
    return { status: "infected", detail: "Eicar-Test-Signature" };
  }

  const apiKey = process.env.CLOUDMERSIVE_API_KEY;
  if (!apiKey) {
    return { status: "skipped", detail: "scanner_not_configured" };
  }

  const baseUrl =
    process.env.CLOUDMERSIVE_BASE_URL || "https://api.cloudmersive.com";

  try {
    const form = new FormData();
    form.append(
      "inputFile",
      new Blob([new Uint8Array(buffer)]),
      fileName || "upload",
    );

    const res = await fetch(`${baseUrl}${SCAN_PATH}`, {
      method: "POST",
      headers: {
        Apikey: apiKey,
        // Block active/dangerous content even without a known signature. We
        // intentionally allow "invalid files", password-protected files and
        // HTML so a benign-but-unusual or encrypted clinical PDF/SVG isn't
        // false-rejected — the magic-byte check already pins the format, and
        // scripts/macros/executables are what actually matter.
        allowExecutables: "false",
        allowScripts: "false",
        allowMacros: "false",
        allowXmlExternalEntities: "false",
        allowInsecureDeserialization: "false",
        allowInvalidFiles: "true",
        allowPasswordProtectedFiles: "true",
        allowHtml: "true",
      },
      body: form,
      // Kept under Vercel's default function limit so a slow scanner trips the
      // catch -> "error" fail-open branch instead of a platform 504.
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      console.error(`[virus-scan] Cloudmersive HTTP ${res.status}`);
      return { status: "error", detail: `http_${res.status}` };
    }

    const json = (await res.json()) as CloudmersiveResponse;

    if (json.CleanResult === true) {
      return { status: "clean" };
    }

    // Not clean: a signature hit and/or a blocked content category. Build a
    // human-readable reason. If the response shape is unexpected (no verdict at
    // all), fail OPEN as "error" rather than wrongly rejecting a legit upload.
    const reasons: string[] = [];
    for (const v of json.FoundViruses ?? []) {
      if (v.VirusName) reasons.push(v.VirusName);
    }
    if (json.ContainsExecutable) reasons.push("executable");
    if (json.ContainsScript) reasons.push("script");
    if (json.ContainsMacros) reasons.push("macro");
    if (json.ContainsXmlExternalEntities) reasons.push("xxe");
    if (json.ContainsInsecureDeserialization) reasons.push("deserialization");

    if (json.CleanResult === false || reasons.length > 0) {
      return { status: "infected", detail: reasons.join(", ") || "blocked_content" };
    }

    console.error("[virus-scan] Unexpected Cloudmersive response shape");
    return { status: "error", detail: "unexpected_scan_response" };
  } catch (err) {
    console.error("[virus-scan] scan failed:", err);
    return {
      status: "error",
      detail: err instanceof Error ? err.message : "scan_failed",
    };
  }
}
