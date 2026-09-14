import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { env } from "@/lib/env";
import type {
  StorageProvider,
  UploadObjectInput,
} from "@/src/integrations/storage/types";

function bucket(): string {
  if (!env.S3_BUCKET)
    throw new Error("S3_BUCKET is required when S3 media storage is enabled.");
  return env.S3_BUCKET;
}

function client(): S3Client {
  return new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials:
      env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          }
        : undefined,
  });
}

function publicUrl(key: string): string | undefined {
  if (!env.S3_PUBLIC_BASE_URL) return undefined;
  const base = env.S3_PUBLIC_BASE_URL.replace(/\/+$/, "");
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${base}/${encoded}`;
}

export class S3StorageProvider implements StorageProvider {
  readonly name = "S3" as const;

  async upload(input: UploadObjectInput) {
    await client().send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        CacheControl: input.cacheControl,
      }),
    );
    return { key: input.key, publicUrl: publicUrl(input.key) };
  }

  async read(key: string) {
    const response = await client().send(
      new GetObjectCommand({ Bucket: bucket(), Key: key }),
    );
    if (!response.Body) throw new Error("Stored media object has no body.");
    return {
      body: Buffer.from(await response.Body.transformToByteArray()),
      contentType: response.ContentType,
    };
  }

  async remove(key: string) {
    await client().send(
      new DeleteObjectCommand({ Bucket: bucket(), Key: key }),
    );
  }
}
