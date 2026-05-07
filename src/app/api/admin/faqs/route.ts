import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { getActiveAdminPermissions } from "@/lib/admin-rbac";
import Faq, { type FaqAudience } from "@/models/Faq";

const AUDIENCES: FaqAudience[] = ["all", "client", "professional"];

async function requireContentAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.isAdmin) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  await connectToDatabase();
  const permissions = await getActiveAdminPermissions(session.user.id);
  if (!permissions?.manageContent) {
    return {
      error: NextResponse.json(
        { error: "Forbidden - missing permission: manageContent" },
        { status: 403 },
      ),
    };
  }
  return { session };
}

function serialize(doc: {
  _id: unknown;
  questionFr: string;
  questionEn: string;
  answerFr: string;
  answerEn: string;
  audience: string;
  order: number;
  enabled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: String(doc._id),
    questionFr: doc.questionFr,
    questionEn: doc.questionEn,
    answerFr: doc.answerFr,
    answerEn: doc.answerEn,
    audience: doc.audience,
    order: doc.order,
    enabled: doc.enabled,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function GET() {
  const auth = await requireContentAdmin();
  if (auth.error) return auth.error;

  try {
    const docs = await Faq.find({})
      .sort({ audience: 1, order: 1, createdAt: 1 })
      .lean();
    return NextResponse.json({ faqs: docs.map(serialize) });
  } catch (error) {
    console.error("Admin list FAQ error:", error);
    return NextResponse.json(
      { error: "Failed to load FAQs" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireContentAdmin();
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const questionFr = typeof body?.questionFr === "string" ? body.questionFr.trim() : "";
    const questionEn = typeof body?.questionEn === "string" ? body.questionEn.trim() : "";
    const answerFr = typeof body?.answerFr === "string" ? body.answerFr.trim() : "";
    const answerEn = typeof body?.answerEn === "string" ? body.answerEn.trim() : "";
    const audience = AUDIENCES.includes(body?.audience) ? body.audience : "all";
    const order = Number.isFinite(body?.order) ? Number(body.order) : 0;
    const enabled = body?.enabled !== false;

    if (!questionFr || !questionEn) {
      return NextResponse.json(
        { error: "Both French and English questions are required" },
        { status: 400 },
      );
    }
    if (!answerFr || !answerEn) {
      return NextResponse.json(
        { error: "Both French and English answers are required" },
        { status: 400 },
      );
    }

    const created = await Faq.create({
      questionFr,
      questionEn,
      answerFr,
      answerEn,
      audience,
      order,
      enabled,
      createdBy: auth.session!.user.id,
      updatedBy: auth.session!.user.id,
    });

    return NextResponse.json({ faq: serialize(created) }, { status: 201 });
  } catch (error) {
    console.error("Admin create FAQ error:", error);
    return NextResponse.json(
      { error: "Failed to create FAQ" },
      { status: 500 },
    );
  }
}
