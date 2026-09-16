import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

interface CursorPayload {
  createdAt: string;
  id: string;
}

function encodeCursor(value: CursorPayload): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value?: string): CursorPayload | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as CursorPayload;
    if (!parsed.id || Number.isNaN(Date.parse(parsed.createdAt))) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function createMediaAsset(data: {
  id: string;
  provider: "LOCAL" | "S3";
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  publicUrl: string;
  width: number;
  height: number;
  checksumSha256: string;
  createdById: bigint;
}) {
  return db.mediaAsset.create({
    data: { ...data, sizeBytes: BigInt(data.sizeBytes) },
  });
}

export async function findMediaAssetById(id: string) {
  return db.mediaAsset.findUnique({ where: { id } });
}

export async function findMediaAssetByPublicUrl(publicUrl: string) {
  return db.mediaAsset.findFirst({ where: { publicUrl } });
}

export async function listMediaAssets(input: {
  cursor?: string;
  limit: number;
}) {
  const decoded = decodeCursor(input.cursor);
  const where: Prisma.MediaAssetWhereInput = {
    // Account avatars are managed by their owners and must not leak into the
    // reusable catalog picker.
    storageKey: { startsWith: "catalog/" },
    ...(decoded
      ? {
          OR: [
            { createdAt: { lt: new Date(decoded.createdAt) } },
            { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } },
          ],
        }
      : {}),
  };

  const rows = await db.mediaAsset.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
  });
  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null,
  };
}

export async function countMediaUsage(publicUrl: string) {
  const [productImages, categories, brands, users] = await Promise.all([
    db.productImage.count({ where: { url: publicUrl } }),
    db.category.count({ where: { imageUrl: publicUrl } }),
    db.brand.count({ where: { logoUrl: publicUrl } }),
    db.user.count({ where: { image: publicUrl } }),
  ]);
  return {
    productImages,
    categories,
    brands,
    users,
    total: productImages + categories + brands + users,
  };
}

export async function deleteMediaAsset(id: string) {
  return db.mediaAsset.delete({ where: { id } });
}
