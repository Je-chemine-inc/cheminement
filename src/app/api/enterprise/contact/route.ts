import { NextRequest, NextResponse } from "next/server";
import {
  ValidationError,
  createExternalMessage,
} from "@/lib/external-messages";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      firstName,
      lastName,
      email,
      phone,
      company,
      position,
      coordinates,
      locale,
    } = body as Record<string, string | undefined>;

    if (
      !firstName?.trim() ||
      !lastName?.trim() ||
      !email?.trim() ||
      !phone?.trim() ||
      !company?.trim() ||
      !position?.trim()
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    const senderName = `${firstName.trim()} ${lastName.trim()}`.trim();

    await createExternalMessage({
      source: "enterprise",
      senderName,
      senderEmail: email,
      senderPhone: phone,
      message: coordinates?.trim() ?? "",
      subject: `${company} — ${position}`,
      locale: locale === "en" ? "en" : "fr",
      metadata: {
        company,
        position,
        coordinates,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Contact request submitted successfully",
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Error processing enterprise contact:", error);
    return NextResponse.json(
      { error: "Failed to process contact request" },
      { status: 500 },
    );
  }
}
