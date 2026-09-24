import "server-only";

import { cacheLife, cacheTag, revalidateTag } from "next/cache";

import { db } from "@/lib/db";
import { SITE_COPY_CACHE_TAG } from "@/src/modules/site-copy/constants";
import type { SiteCopyDictionary } from "@/src/modules/site-copy/copy";

export {
  copyValue,
  interpolateCopy,
  type SiteCopyDictionary,
} from "@/src/modules/site-copy/copy";

export async function getSiteCopy(): Promise<SiteCopyDictionary> {
  "use cache";
  cacheTag(SITE_COPY_CACHE_TAG);
  cacheLife("hours");

  const entries = await db.siteCopy.findMany({
    select: { key: true, value: true },
  });
  return Object.fromEntries(entries.map((entry) => [entry.key, entry.value]));
}

export async function getSiteCopyNamespace(
  namespace: string,
): Promise<SiteCopyDictionary> {
  "use cache";
  cacheTag(SITE_COPY_CACHE_TAG);
  cacheTag(`${SITE_COPY_CACHE_TAG}:${namespace}`);
  cacheLife("hours");

  const entries = await db.siteCopy.findMany({
    where: { namespace },
    select: { key: true, value: true },
  });
  return Object.fromEntries(entries.map((entry) => [entry.key, entry.value]));
}

export function revalidateSiteCopy(namespaces: readonly string[]): void {
  revalidateTag(SITE_COPY_CACHE_TAG, "max");
  for (const namespace of new Set(namespaces)) {
    revalidateTag(`${SITE_COPY_CACHE_TAG}:${namespace}`, "max");
  }
}
