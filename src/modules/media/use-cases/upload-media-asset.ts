import { randomUUID } from "node:crypto";

import { ForbiddenError, ValidationError } from "@/lib/errors";
import { env } from "@/lib/env";
import type { AuthenticatedUser } from "@/src/modules/auth/types";
import {
  PERMISSION_PRODUCTS_CREATE,
  PERMISSION_PRODUCTS_UPDATE,
} from "@/src/modules/catalog/constants";
import { processCatalogImage } from "@/src/integrations/media/image-processor";
import {
  defaultStorageProviderName,
  getStorageProvider,
} from "@/src/integrations/storage";
import { ALLOWED_MEDIA_IMAGE_TYPES } from "@/src/modules/media/schema";
import * as mediaRepo from "@/src/modules/media/repo";
import type { MediaAssetRecord } from "@/src/modules/media/types";

function canWriteCatalog(actor: AuthenticatedUser): boolean {
  return (
    actor.permissions.has(PERMISSION_PRODUCTS_CREATE) ||
    actor.permissions.has(PERMISSION_PRODUCTS_UPDATE)
  );
}

export async function uploadMediaAsset(
  actor: AuthenticatedUser,
  file: File,
): Promise<MediaAssetRecord> {
  if (!canWriteCatalog(actor))
    throw new ForbiddenError(
      "You do not have permission to upload catalog media.",
    );
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
    processed = await processCatalogImage(
      Buffer.from(await file.arrayBuffer()),
    );
  } catch {
    throw new ValidationError(
      "The uploaded file is not a valid supported image.",
    );
  }

  const id = randomUUID();
  const now = new Date();
  const key = `catalog/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}.${processed.extension}`;
  const providerName = defaultStorageProviderName();
  const provider = getStorageProvider(providerName);
  const stored = await provider.upload({
    key,
    body: processed.body,
    contentType: processed.mimeType,
    cacheControl: "public, max-age=31536000, immutable",
  });
  // Canonical application URL intentionally decouples catalog data from the
  // physical storage provider. The object may move from local disk to S3/CDN
  // without rewriting product/category/brand rows.
  const publicUrl = `/api/media/${id}`;

  try {
    const row = await mediaRepo.createMediaAsset({
      id,
      provider: providerName,
      originalName: file.name.slice(0, 255) || "image",
      mimeType: processed.mimeType,
      sizeBytes: processed.body.length,
      storageKey: stored.key,
      publicUrl,
      width: processed.width,
      height: processed.height,
      checksumSha256: processed.checksumSha256,
      createdById: BigInt(actor.id),
    });
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
  } catch (error) {
    await provider.remove(stored.key).catch(() => undefined);
    throw error;
  }
}
