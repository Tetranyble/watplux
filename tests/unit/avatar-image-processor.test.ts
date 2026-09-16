import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { processAvatarImage } from "@/src/integrations/media/image-processor";

describe("processAvatarImage", () => {
  it("normalizes an uploaded image to a square WebP avatar", async () => {
    const source = await sharp({
      create: {
        width: 900,
        height: 500,
        channels: 3,
        background: "#fbbf24",
      },
    })
      .png()
      .toBuffer();

    const result = await processAvatarImage(source);
    const metadata = await sharp(result.body).metadata();

    expect(result.mimeType).toBe("image/webp");
    expect(result.extension).toBe("webp");
    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(512);
    expect(result.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
