import { z } from "zod";

export const mediaListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

export const mediaIdSchema = z.string().uuid();

export const ALLOWED_MEDIA_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);
