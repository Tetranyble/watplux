import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import { mediaListQuerySchema } from "@/src/modules/media/schema";
import { listMediaAssets } from "@/src/modules/media/use-cases/list-media-assets";
import { uploadMediaAsset } from "@/src/modules/media/use-cases/upload-media-asset";

export async function GET(request: Request) {
  try {
    const actor = await requireSessionUser();
    const url = new URL(request.url);
    const query = mediaListQuerySchema.parse({
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    return NextResponse.json(await listMediaAssets(actor, query));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSessionUser();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Choose an image to upload." },
        { status: 400 },
      );
    }
    const asset = await uploadMediaAsset(actor, file);
    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
