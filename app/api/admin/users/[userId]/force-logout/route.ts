import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { forceLogoutUser } from "@/src/modules/auth/use-cases/force-logout-user";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { userId } = await params;
    await forceLogoutUser(actor, BigInt(userId));
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    return errorResponse(error);
  }
}
