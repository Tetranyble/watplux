import { createHash } from "node:crypto";
import sharp from "sharp";

const OUTPUT_MIME = "image/webp";
const MAX_DIMENSION = 3200;
const AVATAR_DIMENSION = 512;

export interface ProcessedImage {
  body: Buffer;
  mimeType: typeof OUTPUT_MIME;
  extension: "webp";
  width: number;
  height: number;
  checksumSha256: string;
}

/**
 * Re-encodes every accepted upload rather than trusting client bytes.
 * This normalizes orientation, strips EXIF/ICC metadata by default, limits
 * dimensions, and gives the storefront a predictable modern image format.
 */
export async function processCatalogImage(
  input: Buffer,
): Promise<ProcessedImage> {
  const pipeline = sharp(input, {
    failOn: "warning",
    limitInputPixels: 64_000_000,
  })
    .rotate()
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 84, effort: 5 });

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  if (!info.width || !info.height)
    throw new Error("Could not determine image dimensions.");
  return {
    body: data,
    mimeType: OUTPUT_MIME,
    extension: "webp",
    width: info.width,
    height: info.height,
    checksumSha256: createHash("sha256").update(data).digest("hex"),
  };
}

/** Produces a predictable square avatar and strips source metadata. */
export async function processAvatarImage(
  input: Buffer,
): Promise<ProcessedImage> {
  const pipeline = sharp(input, {
    failOn: "warning",
    limitInputPixels: 64_000_000,
  })
    .rotate()
    .resize(AVATAR_DIMENSION, AVATAR_DIMENSION, {
      fit: "cover",
      position: "attention",
      withoutEnlargement: false,
    })
    .webp({ quality: 82, effort: 5 });

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  if (!info.width || !info.height)
    throw new Error("Could not determine image dimensions.");
  return {
    body: data,
    mimeType: OUTPUT_MIME,
    extension: "webp",
    width: info.width,
    height: info.height,
    checksumSha256: createHash("sha256").update(data).digest("hex"),
  };
}
