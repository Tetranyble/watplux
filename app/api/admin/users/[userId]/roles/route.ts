import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { assignRole } from "@/src/modules/auth/use-cases/assign-role";
import { removeRole } from "@/src/modules/auth/use-cases/remove-role";

const bodySchema = z.object({ roleName: z.string().min(1) });

/**
 * Admin-only. Authorization is NOT decided here — `assignRole`/`removeRole`
 * call `requirePermission` internally (docs/PHASE_3_AUTH_RBAC_PLAN.md §3.2).
 * This route's only job is: authenticate, validate, delegate, return safe
 * output. A `customer`-role caller reaching this route directly (bypassing
 * any UI) is denied by the use-case, not by this file.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { userId } = await params;
    const { roleName } = bodySchema.parse(await request.json());
    await assignRole(actor, { userId: BigInt(userId), roleName });
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { userId } = await params;
    const { roleName } = bodySchema.parse(await request.json());
    await removeRole(actor, { userId: BigInt(userId), roleName });
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    return errorResponse(error);
  }
}
