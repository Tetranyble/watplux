import { randomBytes, createHash } from "node:crypto";

/**
 * Opaque token generation/hashing — used for session cookies, password-reset
 * tokens, and email-verification tokens alike.
 *
 * Pattern (docs/PHASE_3_AUTH_RBAC_PLAN.md §1.3, corrected terminology per
 * review): a 256-bit CSPRNG value is the raw token, handed to the client
 * (as a cookie value, or as the link/code sent to the user); only its
 * SHA-256 hash is ever persisted. This is NOT a signed/sealed cookie — the
 * cookie itself carries no encoded payload, just an opaque random lookup
 * key. No server-side secret/pepper is needed for the hash: the token's own
 * 256 bits of entropy make it infeasible to guess or reverse regardless.
 */
export function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
