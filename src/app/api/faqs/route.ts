import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/mongodb";
import Faq, { type FaqAudience } from "@/models/Faq";

const VALID_AUDIENCES: FaqAudience[] = ["all", "client", "professional"];

export async function GET(req: NextRequest) {
  try {
    await connectToDatabase();

    const audienceParam = req.nextUrl.searchParams.get("audience");
    const audience: FaqAudience | null =
      audienceParam && VALID_AUDIENCES.includes(audienceParam as FaqAudience)
        ? (audienceParam as FaqAudience)
        : null;

    const query: Record<string, unknown> = { enabled: true };
    if (audience && audience !== "all") {
      query.audience = { $in: ["all", audience] };
    }

    const docs = await Faq.find(query)
      .sort({ order: 1, createdAt: 1 })
      .select("questionFr questionEn answerFr answerEn audience order")
      .lean();

    const faqs = docs.map((d) => ({
      id: String(d._id),
      questionFr: d.questionFr,
      questionEn: d.questionEn,
      answerFr: d.answerFr,
      answerEn: d.answerEn,
      audience: d.audience,
      order: d.order,
    }));

    return NextResponse.json({ faqs });
  } catch (error) {
    console.error("Public list FAQ error:", error);
    return NextResponse.json(
      { error: "Failed to load FAQs" },
      { status: 500 },
    );
  }
}
