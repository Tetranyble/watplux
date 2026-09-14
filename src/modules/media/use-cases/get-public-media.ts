import { NotFoundError } from "@/lib/errors";
import { getStorageProvider } from "@/src/integrations/storage";
import * as mediaRepo from "@/src/modules/media/repo";

export async function getPublicMedia(id: string) {
  const asset = await mediaRepo.findMediaAssetById(id);
  if (!asset) throw new NotFoundError("Media asset not found.");
  const object = await getStorageProvider(asset.provider).read(
    asset.storageKey,
  );
  return {
    body: object.body,
    contentType: object.contentType ?? asset.mimeType,
  };
}
