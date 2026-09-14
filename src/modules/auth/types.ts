/**
 * The safe, in-memory shape of "who is making this request" — passed
 * through use-cases and into permission checks. Never includes
 * `passwordHash`, session internals, or token values (docs/PHASE_3_AUTH_RBAC_PLAN.md §3.1).
 */
export interface AuthenticatedUser {
  id: bigint;
  email: string;
  name: string;
  status: "ACTIVE" | "SUSPENDED";
  /** Resolved via user_roles -> role_permissions -> permissions. */
  permissions: ReadonlySet<string>;
}

/** Safe, client-returnable projection of a user — the only shape any
 * use-case in this module is allowed to hand back to a caller. */
export interface SafeUser {
  id: string;
  email: string;
  name: string;
}

export function toSafeUser(user: {
  id: bigint;
  email: string;
  name: string;
}): SafeUser {
  return { id: user.id.toString(), email: user.email, name: user.name };
}
