/** Name of the httpOnly session cookie. Shared between proxy.ts (presence
 * check only) and this module's use-cases (the actual session resolution). */
export const SESSION_COOKIE_NAME = "session";

/** Seeded roles — docs/PHASE_3_AUTH_RBAC_PLAN.md §12.3 / docs/ARCHITECTURE.md §11. */
export const ROLE_CUSTOMER = "customer";
export const ROLE_STAFF = "staff";
export const ROLE_SUPER_ADMIN = "super_admin";
