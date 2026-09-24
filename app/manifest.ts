import type { MetadataRoute } from "next";

import { copyValue, getSiteCopy } from "@/app/_data/site-copy";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const copy = await getSiteCopy();
  const c = (key: string) => copyValue(copy, key);
  return {
    name: c("site.name"),
    short_name: c("site.name"),
    description: c("site.description"),
    start_url: "/",
    display: "standalone",
    background_color: "#f9f8f5",
    theme_color: "#ffbe00",
    icons: [
      {
        src: "/web-app-manifest-192x192.png?v=20260916",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/web-app-manifest-512x512.png?v=20260916",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
