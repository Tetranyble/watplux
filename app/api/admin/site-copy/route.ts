import { NextResponse } from "next/server";

import { revalidateSiteCopy } from "@/app/_data/site-copy";
import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { updateSiteCopySchema } from "@/src/modules/site-copy/schema";
import { listSiteCopyForAdmin } from "@/src/modules/site-copy/use-cases/list-site-copy-for-admin";
import { updateSiteCopy } from "@/src/modules/site-copy/use-cases/update-site-copy";

export async function GET() {
  try {
    const actor = await requireSessionUser();
    const entries = await listSiteCopyForAdmin(actor);
    return NextResponse.json({ entries });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireSessionUser();
    const input = updateSiteCopySchema.parse(await request.json());
    const result = await updateSiteCopy(actor, input);
    const namespaces = [
      ...new Set(input.entries.map(({ key }) => key.split(".")[0] ?? "")),
    ];
    revalidateSiteCopy(namespaces);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
