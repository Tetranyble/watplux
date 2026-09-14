import type { MediaAsset } from "@prisma/client";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_READ } from "@/src/modules/catalog/constants";
import * as mediaRepo from "@/src/modules/media/repo";
import type {
  MediaAssetPage,
  MediaAssetRecord,
} from "@/src/modules/media/types";

function toRecord(row: MediaAsset): MediaAssetRecord {
  return {
    id: row.id,
    provider: row.provider,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: Number(row.sizeBytes),
    publicUrl: row.publicUrl,
    width: row.width,
    height: row.height,
    createdById: row.createdById?.toString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listMediaAssets(
  actor: AuthenticatedUser,
  input: { cursor?: string; limit: number },
): Promise<MediaAssetPage> {
  requirePermission(actor, PERMISSION_PRODUCTS_READ);
  const page = await mediaRepo.listMediaAssets(input);
  return { items: page.items.map(toRecord), nextCursor: page.nextCursor };
}
