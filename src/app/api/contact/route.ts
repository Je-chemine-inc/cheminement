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
      message,
      locale,
    } = body as {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      message?: string;
      locale?: string;
    };

    const senderName = [firstName, lastName]
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      .map((p) => p.trim())
      .join(" ")
      .trim();

    if (!firstName?.trim() || !lastName?.trim() || !phone?.trim()) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    await createExternalMessage({
      source: "contact",
      senderName,
      senderEmail: email ?? "",
      senderPhone: phone,
      message: message ?? "",
      locale: locale === "en" ? "en" : "fr",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Contact form error:", error);
    return NextResponse.json(
      { error: "Failed to submit contact form" },
      { status: 500 },
    );
  }
}
