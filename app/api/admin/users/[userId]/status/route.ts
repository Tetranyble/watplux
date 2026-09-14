import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { setUserStatus } from "@/src/modules/auth/use-cases/set-user-status";

const schema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) });
export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { userId } = await params;
    const body = schema.parse(await request.json());
    await setUserStatus(actor, BigInt(userId), body.status);
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    return errorResponse(error);
  }
}
