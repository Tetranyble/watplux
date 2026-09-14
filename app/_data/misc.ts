import { cacheLife } from "next/cache";

/**
 * `new Date()` is an "unstable" value under Cache Components — calling it
 * directly in a component that would otherwise be statically prerendered
 * (the footer, present on every page) fails the production build
 * ("Next.js encountered the unstable value `new Date()` while
 * prerendering"). A copyright year only needs to be accurate to the day,
 * so it's cached like any other rarely-changing read rather than forcing
 * every page that renders the footer to become fully dynamic.
 */
export async function getCachedCurrentYear(): Promise<number> {
  "use cache";
  cacheLife("days");
  return new Date().getUTCFullYear();
}
