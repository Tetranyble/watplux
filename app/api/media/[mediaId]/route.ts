import { errorResponse } from "@/lib/http-error-response";
import { mediaIdSchema } from "@/src/modules/media/schema";
import { getPublicMedia } from "@/src/modules/media/use-cases/get-public-media";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mediaId: string }> },
) {
  try {
    const { mediaId } = await params;
    const media = await getPublicMedia(mediaIdSchema.parse(mediaId));
    return new Response(new Uint8Array(media.body), {
      headers: {
        "Content-Type": media.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
