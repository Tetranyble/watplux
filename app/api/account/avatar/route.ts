import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http-error-response";
import { requireSessionUser } from "@/lib/session";
import {
  removeAvatar,
  updateAvatar,
} from "@/src/modules/auth/use-cases/update-avatar";

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
    return NextResponse.json(await updateAvatar(actor, file));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE() {
  try {
    const actor = await requireSessionUser();
    await removeAvatar(actor);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
