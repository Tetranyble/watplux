/**
 * Pure password-strength rule — zero I/O, per docs/ARCHITECTURE.md §1's
 * domain-layer rule. Deliberately simple for Phase 3: length + a basic
 * complexity floor, not a full entropy estimator — that's a reasonable
 * engineering assumption for an MVP, not a security gap this phase claims
 * to close (rate limiting / lockout, §10 of the plan, is the actual
 * defense against low-effort passwords being brute-forced).
 */
export interface PasswordPolicyResult {
  valid: boolean;
  reasons: string[];
}

const MIN_LENGTH = 10;

export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  const reasons: string[] = [];

  if (password.length < MIN_LENGTH) {
    reasons.push(`Password must be at least ${MIN_LENGTH} characters long.`);
  }
  if (!/[a-z]/.test(password)) {
    reasons.push("Password must contain a lowercase letter.");
  }
  if (!/[A-Z]/.test(password)) {
    reasons.push("Password must contain an uppercase letter.");
  }
  if (!/[0-9]/.test(password)) {
    reasons.push("Password must contain a digit.");
  }

  return { valid: reasons.length === 0, reasons };
}
