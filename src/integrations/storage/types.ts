export type StorageProviderName = "LOCAL" | "S3";

export interface UploadObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
  cacheControl?: string;
}

export interface StoredObject {
  key: string;
  publicUrl?: string;
}

export interface StorageObject {
  body: Buffer;
  contentType?: string;
}

export interface StorageProvider {
  readonly name: StorageProviderName;
  upload(input: UploadObjectInput): Promise<StoredObject>;
  read(key: string): Promise<StorageObject>;
  remove(key: string): Promise<void>;
}
