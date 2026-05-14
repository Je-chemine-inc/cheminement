import { NextRequest } from "next/server";
import connectToDatabase from "@/lib/mongodb";
import PlatformSettings from "@/models/PlatformSettings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_DURATION_MS = 50_000;
const HEARTBEAT_INTERVAL_MS = 15_000;

type StructuredAddress = {
  street: string;
  suite: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
};

type ContactPayload = {
  physicalAddress: StructuredAddress;
  phoneNumber: string;
  supportEmail: string;
  interacDepositEmail: string;
  companyName: string;
};

const EMPTY_ADDRESS: StructuredAddress = {
  street: "",
  suite: "",
  city: "",
  province: "",
  postalCode: "",
  country: "",
};

function normalizeAddress(raw: unknown): StructuredAddress {
  if (typeof raw === "string") {
    return { ...EMPTY_ADDRESS, street: raw.trim() };
  }
  if (raw && typeof raw === "object") {
    const a = raw as Partial<StructuredAddress>;
    return {
      street: a.street?.trim() ?? "",
      suite: a.suite?.trim() ?? "",
      city: a.city?.trim() ?? "",
      province: a.province?.trim() ?? "",
      postalCode: a.postalCode?.trim() ?? "",
      country: a.country?.trim() ?? "",
    };
  }
  return { ...EMPTY_ADDRESS };
}

function buildPayload(doc: unknown): ContactPayload {
  const d = (doc ?? {}) as {
    platformContact?: {
      physicalAddress?: unknown;
      phoneNumber?: string;
      supportEmail?: string;
    };
    emailSettings?: { branding?: { companyName?: string } };
    interacDepositEmail?: string;
  };
  return {
    physicalAddress: normalizeAddress(d.platformContact?.physicalAddress),
    phoneNumber: d.platformContact?.phoneNumber?.trim() ?? "",
    supportEmail: d.platformContact?.supportEmail?.trim() ?? "",
    interacDepositEmail: d.interacDepositEmail?.trim() ?? "",
    companyName: d.emailSettings?.branding?.companyName?.trim() ?? "",
  };
}

export async function GET(req: NextRequest) {
  await connectToDatabase();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch {
          /* controller already closed */
        }
      };

      const initial = await PlatformSettings.findOne().lean().catch(() => null);
      send("contact", buildPayload(initial));

      let changeStream:
        | ReturnType<typeof PlatformSettings.watch>
        | undefined;
      try {
        changeStream = PlatformSettings.watch([], {
          fullDocument: "updateLookup",
        });
        changeStream.on("change", (change: { fullDocument?: unknown }) => {
          send("contact", buildPayload(change.fullDocument));
        });
        changeStream.on("error", () => {
          /* will close at timeout; client reconnects */
        });
      } catch {
        /* change streams unavailable — page still works via reconnect cycle */
      }

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: keep-alive\n\n`));
        } catch {
          /* controller already closed */
        }
      }, HEARTBEAT_INTERVAL_MS);

      const closeAll = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        try {
          changeStream?.close();
        } catch {
          /* noop */
        }
        try {
          controller.close();
        } catch {
          /* noop */
        }
      };

      const timeout = setTimeout(closeAll, MAX_DURATION_MS);
      req.signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        closeAll();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
