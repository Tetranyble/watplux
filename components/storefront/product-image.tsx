import Image, { type ImageProps } from "next/image";

/**
 * Product imagery is optimized by Next for Watplux-managed media URLs
 * (`/api/media/:id`). Legacy/admin-entered remote URLs remain unoptimized so
 * existing catalog data does not break while the media library becomes the
 * default upload path. New uploads no longer depend on a guessed CDN host.
 */
export function ProductImage({ alt, src, ...props }: ImageProps) {
  const remote = typeof src === "string" && /^https?:\/\//i.test(src);
  return <Image alt={alt} src={src} unoptimized={remote} {...props} />;
}
