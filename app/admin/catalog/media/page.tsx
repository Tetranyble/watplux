import type { Metadata } from "next";

import { CatalogSubNav } from "@/components/admin/catalog-sub-nav";
import { MediaLibrary } from "@/components/admin/media-library";
import { getSessionUser } from "@/lib/session";
import {
  PERMISSION_PRODUCTS_CREATE,
  PERMISSION_PRODUCTS_DELETE,
  PERMISSION_PRODUCTS_UPDATE,
} from "@/src/modules/catalog/constants";
import { listMediaAssets } from "@/src/modules/media/use-cases/list-media-assets";

export const metadata: Metadata = { title: "Media library" };
export const instant = false;

export default async function AdminMediaPage() {
  const actor = await getSessionUser();
  if (!actor) return null;
  const page = await listMediaAssets(actor, { limit: 40 });
  const canUpload =
    actor.permissions.has(PERMISSION_PRODUCTS_CREATE) ||
    actor.permissions.has(PERMISSION_PRODUCTS_UPDATE);
  const canDelete = actor.permissions.has(PERMISSION_PRODUCTS_DELETE);

  return (
    <div className="flex flex-col gap-6">
      <CatalogSubNav active="/admin/catalog/media" />
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Catalog assets
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Media library</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Upload once and reuse imagery across products, categories and brands.
          Storage details stay behind the media layer instead of leaking into
          catalog forms.
        </p>
      </div>
      <MediaLibrary
        initialItems={page.items}
        initialNextCursor={page.nextCursor}
        canUpload={canUpload}
        canDelete={canDelete}
      />
    </div>
  );
}
