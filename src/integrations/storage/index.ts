import { env } from "@/lib/env";
import { LocalStorageProvider } from "@/src/integrations/storage/local";
import { S3StorageProvider } from "@/src/integrations/storage/s3";
import type {
  StorageProvider,
  StorageProviderName,
} from "@/src/integrations/storage/types";

export function defaultStorageProviderName(): StorageProviderName {
  return env.MEDIA_STORAGE_PROVIDER === "s3" ? "S3" : "LOCAL";
}

export function getStorageProvider(name: StorageProviderName): StorageProvider {
  return name === "S3" ? new S3StorageProvider() : new LocalStorageProvider();
}
