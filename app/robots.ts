import type { MetadataRoute } from "next";

import { env } from "@/lib/env";

/** docs/PHASE_9_STOREFRONT_PLAN.md §17 — matches `docs/ARCHITECTURE.md`
 * §14's own stated disallow list; `/admin` is included defensively even
 * though no public `/admin` page tree exists yet (only `/api/admin/**`,
 * already covered by disallowing `/api`). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/account", "/checkout", "/cart", "/api", "/admin"],
    },
    sitemap: `${env.APP_BASE_URL}/sitemap.xml`,
  };
}
