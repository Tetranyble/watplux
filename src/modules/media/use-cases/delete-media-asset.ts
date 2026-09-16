import { ConflictError, NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/src/modules/auth/use-cases/permissions";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import { PERMISSION_PRODUCTS_DELETE } from "@/src/modules/catalog/constants";
import { logger } from "@/lib/logger";
import { getStorageProvider } from "@/src/integrations/storage";
import * as mediaRepo from "@/src/modules/media/repo";

export async function deleteMediaAsset(
  actor: AuthenticatedUser,
  id: string,
): Promise<void> {
  requirePermission(actor, PERMISSION_PRODUCTS_DELETE);
  const asset = await mediaRepo.findMediaAssetById(id);
  if (!asset) throw new NotFoundError("Media asset not found.");
  const usage = await mediaRepo.countMediaUsage(asset.publicUrl);
  if (usage.total > 0) {
    throw new ConflictError(
      "This image is still in use. Remove its product, category, brand, or profile reference before deleting the stored asset.",
    );
  }

  await mediaRepo.deleteMediaAsset(id);
  try {
    await getStorageProvider(asset.provider).remove(asset.storageKey);
  } catch (error) {
    // The database record is already gone, so users cannot request a broken
    // asset. A leaked object is safer than deleting bytes first and leaving
    // a live DB row pointing at missing content. Object cleanup is operational.
    logger.error(
      { err: error, mediaId: id, storageKey: asset.storageKey },
      "Media object cleanup failed after database deletion",
    );
  }
}
