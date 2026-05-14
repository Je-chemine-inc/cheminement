import { NextResponse } from "next/server";
import { getPlatformContactInfo } from "@/lib/platform-contact";

export const revalidate = 0;
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

const EMPTY_PAYLOAD = {
  physicalAddress: {
    street: "",
    suite: "",
    city: "",
    province: "",
    postalCode: "",
    country: "",
  },
  phoneNumber: "",
  supportEmail: "",
  interacDepositEmail: "",
  companyName: "",
};

export async function GET() {
  try {
    const contact = await getPlatformContactInfo();
    return NextResponse.json(contact, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("Get platform contact error:", error);
    return NextResponse.json(EMPTY_PAYLOAD, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  }
}
