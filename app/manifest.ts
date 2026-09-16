import type { MetadataRoute } from "next";

import { siteConfig } from "@/lib/site-config";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteConfig.name,
    short_name: siteConfig.name,
    description: siteConfig.description,
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
