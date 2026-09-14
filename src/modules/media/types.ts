export interface MediaAssetRecord {
  id: string;
  provider: "LOCAL" | "S3";
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  publicUrl: string;
  width: number;
  height: number;
  createdById: string | null;
  createdAt: string;
}

export interface MediaAssetPage {
  items: MediaAssetRecord[];
  nextCursor: string | null;
}

export interface MediaUsage {
  productImages: number;
  categories: number;
  brands: number;
  total: number;
}
