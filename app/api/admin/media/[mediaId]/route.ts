import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { mediaIdSchema } from "@/src/modules/media/schema";
import { deleteMediaAsset } from "@/src/modules/media/use-cases/delete-media-asset";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ mediaId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { mediaId } = await params;
    await deleteMediaAsset(actor, mediaIdSchema.parse(mediaId));
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
