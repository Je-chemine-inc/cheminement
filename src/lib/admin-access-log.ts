import connectToDatabase from "@/lib/mongodb";
import AdminAccessLog from "@/models/AdminAccessLog";
import type { NextRequest } from "next/server";

export type AdminAccessAction =
  | "view_client_user"
  | "view_client_medical_profile"
  | "view_client_duplicates"
  | "merge_client_accounts";

export async function logAdminClientAccess(params: {
  actorUserId: string;
  resourceUserId: string;
  action: AdminAccessAction;
  req?: NextRequest | null;
}): Promise<void> {
  try {
    await connectToDatabase();
    const forwarded = params.req?.headers.get("x-forwarded-for");
    const ip =
      forwarded?.split(",")[0]?.trim() ||
      params.req?.headers.get("x-real-ip") ||
      undefined;
    const userAgent = params.req?.headers.get("user-agent") || undefined;

    await AdminAccessLog.create({
      actorUserId: params.actorUserId,
      resourceUserId: params.resourceUserId,
      action: params.action,
      ip,
      userAgent,
    });
  } catch (e) {
    console.error("[admin-access-log] Failed to record access:", e);
  }
}
