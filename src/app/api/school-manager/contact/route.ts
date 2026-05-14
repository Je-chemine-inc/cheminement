import { NextRequest, NextResponse } from "next/server";
import {
  ValidationError,
  createExternalMessage,
} from "@/lib/external-messages";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      name,
      school,
      role,
      phone,
      email,
      serviceType,
      message,
      locale,
    } = body as Record<string, string | undefined>;

    if (!school?.trim() || !role?.trim() || !phone?.trim() || !serviceType?.trim()) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    await createExternalMessage({
      source: "school-manager",
      senderName: name?.trim() ?? "",
      senderEmail: email ?? "",
      senderPhone: phone,
      message: message?.trim() ?? "",
      subject: `${serviceType} — ${school}`,
      locale: locale === "en" ? "en" : "fr",
      metadata: {
        school,
        role,
        serviceType,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("School manager form error:", error);
    return NextResponse.json(
      { error: "Failed to submit form" },
      { status: 500 },
    );
  }
}
