import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { getUserProfile } from "@/src/modules/auth/use-cases/get-user-profile";

/**
 * The IDOR test target (docs/PHASE_3_AUTH_RBAC_PLAN.md §3.3): fetching
 * `GET /api/users/123` does not simply `WHERE id = 123` and return the
 * result — `getUserProfile` enforces ownership-or-permission server-side.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const requester = await requireSessionUser();
    const { userId } = await params;
    const profile = await getUserProfile(requester, BigInt(userId));
    return NextResponse.json({ user: profile });
  } catch (error) {
    return errorResponse(error);
  }
}
