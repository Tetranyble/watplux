import { randomUUID } from "node:crypto";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { ValidationError } from "@/lib/errors";
import { processAvatarImage } from "@/src/integrations/media/image-processor";
import {
  defaultStorageProviderName,
  getStorageProvider,
} from "@/src/integrations/storage";
import * as authRepo from "@/src/modules/auth/repo";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import * as mediaRepo from "@/src/modules/media/repo";
import { ALLOWED_MEDIA_IMAGE_TYPES } from "@/src/modules/media/schema";

async function cleanUpOwnedAvatar(
  publicUrl: string | null,
  userId: bigint,
): Promise<void> {
  if (!publicUrl) return;
  try {
    const asset = await mediaRepo.findMediaAssetByPublicUrl(publicUrl);
    if (
      !asset ||
      asset.createdById !== userId ||
      !asset.storageKey.startsWith(`avatars/${userId}/`)
    )
      return;

    await mediaRepo.deleteMediaAsset(asset.id);
    await getStorageProvider(asset.provider).remove(asset.storageKey);
  } catch (error) {
    // The profile has already moved to its new state. Cleanup is best-effort
    // so a storage outage cannot roll back a successful account update.
    logger.error(
      { err: error, userId: userId.toString(), publicUrl },
      "Previous avatar cleanup failed",
    );
  }
}

export async function updateAvatar(
  actor: AuthenticatedUser,
  file: File,
): Promise<{ image: string }> {
  if (!ALLOWED_MEDIA_IMAGE_TYPES.has(file.type)) {
    throw new ValidationError("Use a JPEG, PNG, WebP, or AVIF image.");
  }
  const maxBytes = env.MEDIA_UPLOAD_MAX_MB * 1024 * 1024;
  if (file.size <= 0 || file.size > maxBytes) {
    throw new ValidationError(
      `Image must be between 1 byte and ${env.MEDIA_UPLOAD_MAX_MB} MB.`,
    );
  }

  let processed;
  try {
    processed = await processAvatarImage(Buffer.from(await file.arrayBuffer()));
  } catch {
    throw new ValidationError(
      "The uploaded file is not a valid supported image.",
    );
  }

  const id = randomUUID();
  const key = `avatars/${actor.id}/${id}.${processed.extension}`;
  const providerName = defaultStorageProviderName();
  const provider = getStorageProvider(providerName);
  const stored = await provider.upload({
    key,
    body: processed.body,
    contentType: processed.mimeType,
    cacheControl: "public, max-age=31536000, immutable",
  });
  const publicUrl = `/api/media/${id}`;

  try {
    await mediaRepo.createMediaAsset({
      id,
      provider: providerName,
      originalName: file.name.slice(0, 255) || "avatar",
      mimeType: processed.mimeType,
      sizeBytes: processed.body.length,
      storageKey: stored.key,
      publicUrl,
      width: processed.width,
      height: processed.height,
      checksumSha256: processed.checksumSha256,
      createdById: actor.id,
    });
  } catch (error) {
    await provider.remove(stored.key).catch(() => undefined);
    throw error;
  }

  let previousImage: string | null;
  try {
    previousImage = await authRepo.setUserImage({
      userId: actor.id,
      image: publicUrl,
      auditAction: "auth.avatar.updated",
    });
  } catch (error) {
    await mediaRepo.deleteMediaAsset(id).catch(() => undefined);
    await provider.remove(stored.key).catch(() => undefined);
    throw error;
  }

  await cleanUpOwnedAvatar(previousImage, actor.id);
  return { image: publicUrl };
}

export async function removeAvatar(actor: AuthenticatedUser): Promise<void> {
  const previousImage = await authRepo.setUserImage({
    userId: actor.id,
    image: null,
    auditAction: "auth.avatar.removed",
  });
  await cleanUpOwnedAvatar(previousImage, actor.id);
}
