# Phase 3 — Authentication & RBAC Implementation Plan

Status: **PLAN — no application code written.** Mirrors the Phase 2A → 2B gate: this document is reviewed and approved first; a separate implementation pass follows, producing `docs/PHASE_3_AUTH_RBAC_IMPLEMENTATION.md` alongside the code.

Source of truth this plan is grounded in, verified by reading the actual files rather than assumed: `docs/ARCHITECTURE.md` §5 (Authentication Architecture) and its Open Questions, `docs/DATABASE_DESIGN.md` §1 (Identity Domain), `prisma/schema.prisma` (the actual implemented `User`/`Session`/`VerificationToken`/`Role`/`Permission`/`UserRole`/`RolePermission` models), `lib/env.ts`, `lib/errors.ts`, `lib/logger.ts`, `eslint.config.mjs`, and `vitest.config.mts` as they exist today.

---

## 0. What this plan resolves

`docs/ARCHITECTURE.md`'s Open Questions §1 explicitly left this open: *"Auth library: Auth.js v5 vs. Lucia vs. a custom session table + iron-session-style cookie sealing... final call in Phase 3."* This plan makes that call — §1 below — and works out everything downstream of it.

---

## 1. Authentication library decision

### 1.1 The three options, evaluated against what's already built

| Option | Verdict | Why |
|---|---|---|
| **Auth.js v5** | ❌ Rejected | See §1.2 — concrete, structural incompatibilities with the already-implemented schema and with a hard requirement from `docs/ARCHITECTURE.md` §5 |
| **Lucia** | ❌ Rejected | Lucia's author discontinued it as an installable library in 2025, republishing its approach as a "learn to roll your own" reference implementation rather than a maintained package. There is no current Lucia package to adopt — its own recommendation is now exactly what §1.3 proposes |
| **Custom session-based auth on the existing schema** | ✅ **Selected** | The schema was already designed for this shape in Phase 2A/2B (deliberately hashed, DB-backed sessions — see §1.3); no adapter-shape fighting, no library upgrade churn, uses only vetted cryptographic primitives (never hand-rolled crypto) |

### 1.2 Why not Auth.js v5 — the concrete incompatibilities

`docs/DATABASE_DESIGN.md` §1 flagged this risk in advance: *"if Phase 3 picks a library with a Prisma adapter that expects its own model shape... the tables below may need renaming/reshaping... or a custom adapter gets written."* Checking that prediction against the actual schema now that it exists:

1. **Session strategy conflict with a Phase 0 hard requirement.** Auth.js's `Credentials` provider (the only provider relevant here — this is a password-based system, not OAuth/magic-link) does not support the `"database"` session strategy; it forces `"jwt"`. `docs/ARCHITECTURE.md` §5 states a **hard requirement**: *"DB-backed sessions... specifically so an admin can be forcibly logged out (compromised account, offboarding) — a hard requirement for an admin surface that touches payments."* A stateless JWT session cannot be forcibly revoked server-side without bolting on a separate denylist mechanism — at which point we're building the DB-backed session system anyway, underneath a library that's actively resisting it.
2. **ID type mismatch.** Auth.js's official Prisma adapter expects `User.id` as a `String` (typically `cuid()`/`uuid()`). Our `User.id` is `BigInt @default(autoincrement())` throughout the entire schema (every FK in Commerce/Payments/Services references it as `BigInt`). Adopting the adapter would mean either changing the PK type across 20+ already-migrated tables, or writing a custom adapter to bridge types — at which point the adapter is providing near-zero value.
3. **Session token storage mismatch.** Auth.js's adapter stores the *raw* session token as `Session.sessionToken` (a plain unique string, used directly as the DB lookup key). Our `sessions.session_token_hash` deliberately stores only a SHA-256 hash of the token — the same "a DB leak shouldn't hand out live sessions" principle as password hashing, a considered decision already made and migrated in Phase 2B. Using Auth.js's stock adapter here would mean *weakening* an already-implemented security property, or writing a fully custom adapter that hashes before every lookup — again, most of the adapter's value gone.
4. **`verification_tokens` shape mismatch.** Auth.js's stock `VerificationToken` model is `{ identifier, token, expires }` with no `userId` FK, no purpose discriminator, no `consumedAt`, and is designed for passwordless/magic-link sign-in. Ours (`userId`, `purpose: EMAIL_VERIFICATION | PASSWORD_RESET`, `tokenHash`, `consumedAt`) is a different, more general-purpose shape already built to serve both email verification *and* password reset.
5. **Password reset isn't an Auth.js feature at all.** Auth.js has no built-in credentials-based password-reset flow regardless of adapter choice — it's always custom application code layered on top. So even in the best case, adopting Auth.js buys nothing for one of Phase 3's largest requirements (§9 of the brief).

Given 1–5, Auth.js would require: overriding its default session strategy, writing a custom adapter to bridge ID types and hash semantics, and building password reset entirely by hand regardless — i.e., discarding essentially everything the library provides while adding a dependency, its upgrade/breaking-change surface, and integration friction against an already-reviewed, already-migrated schema. Not adopted.

### 1.3 The selected architecture: custom, built on vetted primitives

"Custom" here means **no third-party authentication framework** — not "hand-rolled cryptography." Per `docs/ARCHITECTURE.md` §5's explicit instruction ("Do not implement cryptography or authentication primitives manually"), every security-sensitive operation uses a mature, vetted primitive:

| Concern | Primitive | Library |
|---|---|---|
| Password hashing | Argon2id (OWASP's current first recommendation) | `@node-rs/argon2` — Rust/NAPI bindings, prebuilt binaries (no `node-gyp`/native toolchain needed, relevant given this project's Node-version-sensitive install history in Phase 1) |
| Session token generation | CSPRNG, 256 bits of entropy | Node's built-in `crypto.randomBytes(32)`, base64url-encoded |
| Session/verification token storage | One-way hash of the token, never the raw value | Node's built-in `crypto.createHash("sha256")` — no server-side secret/pepper needed, since the token itself already carries 256 bits of entropy (unlike a password); this also means **no new `AUTH_SECRET`-style env var** is required for Phase 3 |
| Cookie transport | Signed, httpOnly cookie carrying only the raw (unhashed) session token as an opaque lookup key | Next.js's built-in `cookies()` API (`next/headers`) — no separate cookie-sealing library needed, since the cookie value is a meaningless random string without the DB row, not a payload that needs its own signature |

This is exactly Option C from `docs/ARCHITECTURE.md`'s own Open Questions list, now the confirmed choice, and it requires **zero schema changes** — see §4.

---

## 2. Session architecture

### 2.1 Lifecycle

```text
Login success
  → generate 256-bit random token (raw)
  → hash it (SHA-256)
  → INSERT sessions (session_token_hash, user_id, expires_at, user_agent, ip_address)
  → set httpOnly cookie = raw token (never the hash, never stored server-side as raw)

Every authenticated request
  → read cookie → hash it → SELECT sessions WHERE session_token_hash = ? AND expires_at > NOW()
  → miss (wrong hash, or expired, or already deleted) → treat as unauthenticated
  → hit → resolve the session's user

Logout
  → DELETE the one matching session row → clear cookie

Logout-all
  → DELETE all session rows for that user_id → clear the current cookie
  (this is the forcible-revocation mechanism ARCHITECTURE.md §5 required Auth.js's
   JWT strategy couldn't give us)

Expiry
  → no separate "revoked" flag needed — a session is valid iff its row still
    exists AND expires_at > NOW(). A periodic cleanup job (cron, matching the
    pattern already established for the payment/inventory TTL sweeps in
    docs/ARCHITECTURE.md §15) deletes expired rows; until it runs, an expired
    row simply fails the `expires_at > NOW()` check and is functionally dead
    even if not yet physically deleted.
```

**Row-exists-or-not is the entire revocation model** — deliberately simpler than a soft `revokedAt` column, and it needs no schema change because `sessions` already has exactly the columns this requires (`session_token_hash`, `user_id`, `expires_at`, `user_agent`, `ip_address`, `created_at` — confirmed against `prisma/schema.prisma` directly, not assumed).

### 2.2 Cookie attributes

| Attribute | Value | Why |
|---|---|---|
| `httpOnly` | `true` | Never readable by client-side JS |
| `secure` | `true` in production, `false` in local dev (derived from `env.NODE_ENV`, not a separate env var) | HTTPS-only transport in production |
| `sameSite` | `lax` | `docs/ARCHITECTURE.md` §5 already specifies this exact value — checkout's redirect to Paystack and back needs `lax`, not `strict` |
| `path` | `/` | Session applies site-wide (storefront + account + admin) |
| `maxAge` | Matches the session's `expires_at` (see §2.3 for the TTL value) | Cookie and DB row expire together |

### 2.3 Session TTL and rotation

- **Default session lifetime: 30 days**, configurable via a new env var (§7) rather than hardcoded, since this is exactly the kind of value that gets tuned post-launch without a code change.
- **Rotation on login**: logging in again from the same or a different device creates a **new** session row (new token, new cookie) rather than reusing/extending an old one — multiple concurrent sessions per user are allowed (a user can be logged in on phone + laptop simultaneously), each independently revocable via logout-all or an admin action.
- **No sliding-window renewal in Phase 3** — a session's `expires_at` is fixed at creation time, not extended on activity. Sliding renewal is a reasonable future enhancement, explicitly deferred (not silently added) to keep Phase 3's scope bounded to what's asked.

---

## 3. RBAC / permission-checking API

### 3.1 Central primitives (the brief's §12 requirement, made concrete)

All in `src/modules/auth/use-cases/` (server-only), never a scattered `user.role === "admin"` check anywhere else in the codebase:

```ts
// Resolves the current request's session -> user, memoized per-request via
// React's cache() (same pattern docs/ARCHITECTURE.md §12 already prescribes
// for session-derived data) so multiple calls in one request don't re-hit
// the database. Returns null if there is no valid session — this function
// never throws.
getCurrentUser(): Promise<AuthenticatedUser | null>

// Throws UnauthorizedError (existing lib/errors.ts class — reused, not
// reinvented) if there is no valid session.
requireAuthenticatedUser(): Promise<AuthenticatedUser>

// Resolves the user's permissions (via user_roles -> role_permissions) and
// throws ForbiddenError (existing lib/errors.ts class) if the permission key
// isn't present. This is the ONLY sanctioned way any use-case checks
// authorization — never a direct role-name comparison.
requirePermission(user: AuthenticatedUser, permissionKey: string): Promise<void>

// Non-throwing variant for conditional UI hints (e.g. "show the admin nav
// link") — explicitly NOT a security boundary on its own; every use-case a
// hinted-at UI element triggers still calls requirePermission independently.
hasPermission(user: AuthenticatedUser, permissionKey: string): Promise<boolean>
```

`AuthenticatedUser` is a plain object containing only what's safe to hold in memory/pass around: `id`, `email`, `name`, `status`, and the resolved permission-key set — **never** `passwordHash`, session internals, or token values.

### 3.2 Where authorization actually lives

Per the brief's §13 (a hard rule, and one this codebase already structurally supports via the ESLint boundary rules from Phase 1):

```text
Server Action / Route Handler (presentation)
      ↓ calls
Use-case (src/modules/<domain>/use-cases/*)
      ↓ calls requireAuthenticatedUser() / requirePermission() FIRST
      ↓ then calls
Repository (src/modules/<domain>/repo.ts)
      ↓
Database
```

The existing `boundaries/dependencies` ESLint rule (in `eslint.config.mjs`, unchanged) already forbids `presentation → repo` directly — so a route handler *cannot* reach the database while skipping a use-case, which is exactly the structural guarantee that makes "authorization lives inside the use-case, not the route" enforceable by tooling rather than convention alone. **No ESLint config changes needed** — the existing generic globs (`src/modules/*/use-cases/**`, `src/modules/*/domain/**`) already cover an `auth` module the same as any other.

### 3.3 IDOR protection pattern

Every use-case taking a user-supplied resource ID resolves ownership *inside the use-case*, never at the route layer and never by trusting a client-supplied "this is my resource" flag:

```ts
// Inside a use-case, not a route handler:
async function getOrder(user: AuthenticatedUser, orderId: bigint) {
  const order = await orderRepo.findById(orderId);
  if (!order) throw new NotFoundError();
  const owns = order.userId === user.id;
  const canReadAny = await hasPermission(user, "orders.read");
  if (!owns && !canReadAny) throw new ForbiddenError();
  return order;
}
```

This pattern (ownership OR elevated permission, resolved server-side against the DB row actually fetched) is the template every future IDOR-sensitive use-case follows — stated here so Phase 4+ doesn't need to rediscover it.

---

## 4. Database changes: **none required**

Checked directly against `prisma/schema.prisma`, not assumed:

| Need | Already satisfied by |
|---|---|
| Disabled account check | `users.status: ACTIVE \| SUSPENDED` |
| Soft-deleted account check | `users.deletedAt` |
| Session creation/lookup/expiry | `sessions.sessionTokenHash` (unique), `expiresAt` |
| Session revocation (single + all) | `DELETE FROM sessions` — no flag column needed (§2.1) |
| Password reset / email verification tokens | `verification_tokens.purpose`, `tokenHash` (unique), `consumedAt`, `expiresAt` |
| Role assignment + audit trail | `user_roles.assignedBy`, `assignedAt` |
| Role/permission storage | `roles`, `permissions`, `role_permissions`, `user_roles` — all already migrated |
| Security-event audit logging | `audit_logs` (see §9) |

**One accepted, documented scope limit, not a schema gap:** `audit_logs.entityId` is `NOT NULL`, so a failed-login attempt against a **non-existent** email has no row to reference and will **not** be audit-logged (there's nothing non-null to put in `entity_id`). Failed attempts against a **real** account (`entity_id = that user's id`) are logged normally — see §9. This is a deliberate, narrow limitation: the enumeration-safe error response (§6, §7) already prevents an attacker from learning whether an email exists, which is the primary risk this would otherwise help detect; broader anonymous-attempt monitoring is properly a rate-limiting/WAF concern (§10, explicitly deferred), not an audit-log one. Making `entity_id` nullable purely to log this narrower case would be a speculative schema change for a need better served by the already-deferred rate-limiting layer — not done, per the brief's explicit "do not make speculative database changes."

**Conclusion: Phase 3 introduces zero new migrations.** If implementation surfaces a genuine need not listed here, that will be reported before any migration file is written, per the brief's §28 requirement.

---

## 5. Module structure

Following the established convention exactly as already built (`src/modules/health/` from Phase 1 is the reference — checked directly, not assumed) rather than the brief's illustrative folder sketch, which used `repo/`/`schema/` as directories:

```text
src/modules/auth/
├── domain/
│   └── password-policy.ts        # pure functions: password strength rules, no I/O
├── use-cases/
│   ├── register.ts
│   ├── login.ts
│   ├── logout.ts
│   ├── logout-all.ts
│   ├── get-current-user.ts
│   ├── require-authenticated-user.ts
│   ├── require-permission.ts
│   ├── request-password-reset.ts
│   ├── reset-password.ts
│   ├── request-email-verification.ts
│   └── verify-email.ts
├── repo.ts                        # single file — matches eslint.config.mjs's
│                                   # "repo" file-category pattern exactly
├── schema.ts                      # single file — Zod schemas, matches the
│                                   # "schema" file-category pattern exactly
└── types.ts                       # AuthenticatedUser, etc.
```

**Reconciling the brief's example with the existing convention:** the brief's §5 sketch shows `repo/` and `schema/` as directories ("for example"). The already-established pattern (Phase 1's `health` module, and the ESLint `boundaries/files` config that specifically matches `src/modules/*/repo.ts` / `src/modules/*/schema.ts` as *files*, not directories) uses single files. Following the existing, already-enforced convention rather than the brief's illustrative sketch — this is exactly the kind of "don't duplicate/contradict existing infrastructure" the brief's §2 asked to check for.

**Shared infrastructure reused, not duplicated:**
- `lib/errors.ts` — `UnauthorizedError`, `ForbiddenError`, `ValidationError` already exist; auth use-cases throw these, no new error classes needed beyond that hierarchy.
- `lib/logger.ts` — reused for all auth event logging, with one addition (§9.3).
- `lib/env.ts` — extended with the new variables in §7, following its existing Zod-validated pattern exactly.
- `lib/db.ts` — the existing Prisma client singleton; `src/modules/auth/repo.ts` imports it, same as `src/modules/health/repo.ts` does.

**`proxy.ts`** — new in Phase 3 (didn't exist before), at the repository root per the Next.js 16 convention already established and documented in `docs/ARCHITECTURE.md` §5/§15 (the renamed `middleware.ts`). See §8.

---

## 6. Registration flow

```text
1. Zod-validate input (email, password, name) — schema in src/modules/auth/schema.ts
2. Normalize email: lowercase + trim (stored and looked up in normalized form;
   the raw case a user typed is not treated as meaningfully distinct)
3. Check for an existing account with that normalized email
4. If it exists: return the SAME generic success-shaped response as a new
   registration would on its happy path (see below) — never a distinct
   "email already in use" error, which is a textbook account-enumeration leak
5. Hash the password with Argon2id (@node-rs/argon2)
6. Transaction: INSERT users (status=ACTIVE, emailVerifiedAt=null) +
   INSERT user_roles (role=customer, assignedBy=null since it's self-registration)
7. Issue an email-verification token (INSERT verification_tokens,
   purpose=EMAIL_VERIFICATION) — the token's raw value is handed to the
   (deferred, §11) email-sending boundary, never returned in the API response
8. Create a session immediately (see §6.1 for why) and set the cookie
9. Return only: { id, email, name } — never passwordHash, tokens, or session internals
```

**§6.1 — does registration require email verification before login?** Decision: **no**, not gated in Phase 3. The account is usable immediately (`emailVerifiedAt` stays `null` until the user completes verification). This is a reasonable engineering assumption — stated explicitly, not silently chosen — consistent with a common e-commerce pattern (browse/purchase before verifying) and with `docs/ARCHITECTURE.md` never having stated verification-gated login as a requirement. A `requireVerifiedEmail` policy gate is a small, isolated addition if the business wants it later (e.g., gating checkout specifically, once Phase 8 exists) — not built speculatively now.

**Step 4's enumeration-safety applies symmetrically to login (§7)** — both flows are audited in §12 for this specific property.

---

## 7. Login flow

```text
1. Zod-validate input (email, password)
2. Normalize email the same way as registration
3. Look up the user by normalized email
4. If no user found → generic "invalid email or password" error (no session, no cookie)
5. If found but status=SUSPENDED or deletedAt is set → the SAME generic error
   (never "your account is disabled," which confirms the email exists)
6. Verify the password against the stored Argon2id hash
7. If verification fails → the SAME generic error, and (§9) an audit_logs row
   IS written here (entity_id = the real user's id, since the account exists —
   see §4's accepted limitation for the nonexistent-account case)
8. On success: create a session (§2.1), set the cookie
9. Return only: { id, email, name } — same safe shape as registration
```

Steps 4, 5, and 7 all return **the identical error message and HTTP shape** — this is the concrete mechanism behind the brief's §7 requirement ("must not leak sensitive account information").

---

## 8. `proxy.ts` responsibilities (and non-responsibilities)

```ts
// proxy.ts (repo root) — Next.js 16 naming, not middleware.ts
```

**Does:** a cheap presence/shape check — is there a session cookie at all, and does the requested path require one (`/account/**`, `/admin/**`)? If a protected path has no cookie, redirect to `/login`. That's the entire job.

**Does NOT:** look up the session in the database, resolve roles/permissions, or make any final authorization decision. Per the brief's §16 (and `docs/ARCHITECTURE.md` §5, already stated): *"the proxy is a preliminary request boundary... the final authorization decision belongs inside the protected server-side use-case."* A cookie that looks well-formed but is actually expired/revoked will pass `proxy.ts`'s shape check and only get caught when the destination Server Component/Action calls `requireAuthenticatedUser()` — which is correct and intentional, not a gap: `proxy.ts` is a UX convenience (fast redirect for the obviously-logged-out case), never the security boundary itself.

---

## 9. Audit logging

### 9.1 Events logged, using the existing `audit_logs` table (no second system)

| Event | `action` | `entityType` / `entityId` | `actorId` |
|---|---|---|---|
| Registration | `auth.register` | `user` / new user's id | the new user (self) |
| Login success | `auth.login.success` | `user` / user's id | the user |
| Login failure (existing account) | `auth.login.failure` | `user` / that account's id | `null` (not yet authenticated) |
| Logout | `auth.logout` | `user` / user's id | the user |
| Logout-all | `auth.logout_all` | `user` / user's id | the user |
| Password reset requested | `auth.password_reset.requested` | `user` / user's id | `null` (requester not authenticated yet) |
| Password reset completed | `auth.password_reset.completed` | `user` / user's id | the user (post-reset, now authenticated) |
| Password changed (while logged in) | `auth.password.changed` | `user` / user's id | the user |
| Role assigned | `auth.role.assigned` | `user` / target user's id | the admin who assigned it |
| Role removed | `auth.role.removed` | `user` / target user's id | the admin who removed it |
| Account suspended | `auth.account.suspended` | `user` / target user's id | the admin |
| Account restored | `auth.account.restored` | `user` / target user's id | the admin |

### 9.2 What's explicitly never in `before_data`/`after_data`

`passwordHash`, raw or hashed session tokens, raw or hashed verification/reset tokens, cookie values. Role-change entries carry the role name/id, not credential material.

### 9.3 One infrastructure gap to close as part of this phase

`lib/logger.ts`'s current `redact` paths (`*.password`, `*.secret`, `*.token`, etc.) match literal property names — they do **not** match `passwordHash`, `sessionTokenHash`, or `tokenHash` as substrings (pino's redact syntax is path-based, not a regex/substring match). Since the auth module is about to be the first code that ever handles objects with exactly these field names, Phase 3's implementation will extend `lib/logger.ts`'s redact list to explicitly include `*.passwordHash`, `*.sessionTokenHash`, `*.tokenHash`, `*.rawToken` — closing a real gap before it can be exercised, not a speculative addition.

---

## 10. Brute-force protection: explicitly deferred, boundary defined now

Per the brief's §21 ("do not invent a Redis dependency unless the plan explicitly calls for it... document the exact boundary"):

- **Not implemented in Phase 3**: no rate limiting, no account lockout after N attempts, no CAPTCHA.
- **Boundary defined for later**: a `RateLimiter` interface (`src/integrations/rate-limit/types.ts` — the existing `src/integrations/` boundary from Phase 1, already scaffolded and empty) with a single method (`consume(key: string): Promise<{ allowed: boolean }>`), and a no-op/always-allow implementation wired into `login`/`register`/`request-password-reset` use-cases as an injectable dependency (the same dependency-injection pattern `docs/ARCHITECTURE.md` §16 already uses for the health-check use-case's `ping` parameter). This means the use-case call sites are already shaped to accept real rate limiting the moment it's built (`docs/ARCHITECTURE.md` §17 names this as Phase 15/Security Hardening work) — without pretending it exists now. `docs/ARCHITECTURE.md` §17's mention of rate limiting on login/registration remains accurately un-implemented, not silently marked done.

---

## 11. Email delivery: explicitly out of scope

Password-reset and email-verification *tokens* are generated, stored, and validated in Phase 3. **Sending them by email is not** — `docs/ARCHITECTURE.md`'s notification boundary (`src/integrations/email/`, referenced but not built) is a separate, later concern. Phase 3's use-cases accept an injectable "deliver this token to the user" function, defaulting to a stub that logs (at `debug` level, in development only, and **never** logging the raw token value per §9.2/§9.3) that a token was issued — real SMTP/provider wiring is explicitly future work, not faked with placeholder credentials (per the brief's §9 instruction).

---

## 12. Testing strategy

### 12.1 Infrastructure change needed

`vitest.config.mts` currently only includes `tests/unit/**/*.test.ts` and overrides `DATABASE_URL` to a fake value (fine for the health-check unit tests, which inject a fake ping and never touch a real connection). Phase 3's brief §27 requires exercising the **actual security boundary** — real Server Actions/use-cases against a real database. Plan: add `tests/integration/**/*.test.ts` to the include glob, and give integration tests the **real** `DATABASE_URL` (loaded from `.env` via a small `tests/integration/setup.ts`, registered as a Vitest `setupFiles` entry) rather than the unit tests' fake override. Both suites continue to run via the existing `npm test` script; unit vs. integration is a path-based split, not a new script, unless implementation finds a cleaner separation (e.g. `test:integration`) worth adding — a minor, self-contained infra decision, not a redesign.

### 12.2 Coverage (mapping the brief's §26 list to concrete tests)

- **Registration**: valid registration; duplicate email produces the identical response shape as success (enumeration-safety, asserted explicitly); malformed email rejected by Zod; weak password rejected by the domain password policy; new user has exactly the `customer` role afterward.
- **Login**: valid credentials; wrong password; nonexistent account; `SUSPENDED` account; soft-deleted account — the last four asserted to return **byte-for-byte identical** error responses; session row created on success.
- **Sessions**: valid session resolves a user; expired session (row present, `expiresAt` in the past) resolves to unauthenticated; logout deletes exactly its own row; logout-all deletes every row for that user and no others.
- **Password reset**: valid token succeeds; expired token rejected; a second use of an already-`consumedAt`-set token rejected; malformed/unknown token rejected; successful reset invalidates all existing sessions for that user (logout-all as a side effect of reset — a deliberate security property worth asserting, since a leaked password implies leaked sessions too).
- **Authorization**: unauthenticated → `UnauthorizedError`; `customer` denied an admin-only permission; `customer` allowed their own permitted action; `staff` allowed/denied per their seeded permission set; `super_admin` allowed a privileged action.
- **IDOR**: User A's use-case call for User B's resource → `ForbiddenError`/`NotFoundError`, never User B's data.
- **Privilege escalation**: a `customer`-role user calling `assignRole` on themselves → denied; calling it on another user → denied; directly invoking an admin-only use-case with a forged/absent permission set → denied regardless of client-supplied hints.

### 12.3 Seed data needed for tests (not "fake business data" — structural RBAC data)

Three roles (`customer`, `staff`, `super_admin`) and the permission set `docs/ARCHITECTURE.md` §11 already enumerates, seeded via a Prisma seed script — this is exactly the kind of reference data Phase 0/2A already called out as appropriate to seed (as opposed to fake products/customers, which stays explicitly out of scope).

---

## 13. Environment variables (extending `lib/env.ts`, its existing Zod pattern unchanged)

| Variable | Purpose | Default |
|---|---|---|
| `SESSION_TTL_DAYS` | Session lifetime (§2.3) | `30` |
| `PASSWORD_RESET_TOKEN_TTL_MINUTES` | Reset token validity window | `30` |
| `EMAIL_VERIFICATION_TOKEN_TTL_HOURS` | Verification token validity window | `24` |

No secret/key env var is introduced (§1.3 — token hashing needs no server-side secret). `.env.example` gets these three with the same safe-placeholder convention already used there.

---

## 14. Security decisions summary (what's actually implemented vs. explicitly deferred)

**Implemented:** Argon2id password hashing; CSPRNG session/reset/verification tokens; hash-at-rest for all of them; httpOnly/secure/SameSite=lax cookies; DB-backed, forcibly-revocable sessions; enumeration-safe login/registration responses; permission-based (not role-string) authorization centralized in use-cases; IDOR-safe ownership-or-permission checks; audit logging of all listed security events; password-reset-triggers-logout-all.

**Explicitly deferred (stated, not hidden):** rate limiting/brute-force protection (interface only, §10); email delivery transport (§11); CAPTCHA; 2FA/MFA; sliding session renewal; audit logging of failed logins against nonexistent accounts (§4).

---

## 15. Self-review

1. **Does this contradict `docs/ARCHITECTURE.md`?** No — it resolves an explicitly-left-open question (§0) using the exact reasoning categories Phase 0 anticipated (adapter shape, hard session-revocation requirement), and implements the cookie attributes Phase 0 already specified verbatim (§2.2).
2. **Does this require touching Phase 2B migrations?** No — confirmed field-by-field against `prisma/schema.prisma` in §4.
3. **Does this duplicate existing infrastructure?** No — reuses `lib/errors.ts`, `lib/logger.ts` (with one additive fix), `lib/env.ts`'s pattern, `lib/db.ts`, and the existing ESLint boundary rules and module-file conventions unmodified.
4. **Is anything silently assumed instead of decided?** The one non-obvious call (registration doesn't gate login on email verification, §6.1) is stated as a reasonable engineering assumption with its reasoning, not left implicit.
5. **Is brute-force protection honestly represented?** Yes — §10 states plainly it is not implemented, and defines the exact interface boundary for later, per the brief's explicit instruction not to pretend it exists.

---

**Phase 3 plan complete. No application code was written. Awaiting explicit approval before implementation begins.**
