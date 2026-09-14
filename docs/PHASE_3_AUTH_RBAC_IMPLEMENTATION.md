# Phase 3 — Authentication & RBAC Implementation Report

Status: **implemented and verified**. This document records what was
actually built against `docs/PHASE_3_AUTH_RBAC_PLAN.md` (the approved
specification) and the three implementation corrections given at approval
time. Where implementation diverged from the plan in a material way, the
divergence is called out explicitly rather than glossed over.

---

## 1. Database change statement

**No Phase 3 database migration was required.** All tables needed by this
phase (`users`, `sessions`, `verification_tokens`, `roles`, `permissions`,
`user_roles`, `role_permissions`, `audit_logs`) were already defined in
`prisma/schema.prisma` by Phase 2B. Phase 3 only *populated* `roles`,
`permissions`, and `role_permissions` via the seed script — it did not
alter the schema, add a migration, or change any column, index, or
constraint. `prisma/schema.prisma` and `prisma/migrations/` are byte-for-byte
unchanged from Phase 2B.

One net-new permission key, `users.manage`, was added to the seed data (not
the schema) to gate role-assignment — `permissions.key` is a plain string
column, so this required no migration, only a new seeded row.

---

## 2. Files created / modified

### New — crypto integration (`src/integrations/crypto/`)
- `password.ts` — `hashPassword` / `verifyPassword`, wrapping `@node-rs/argon2` (Argon2id).
- `tokens.ts` — `generateRawToken()` (32-byte CSPRNG, base64url) and `hashToken()` (SHA-256 hex).

### New — notification integration (`src/integrations/notifications/`)
- `token-delivery.ts` — `noopTokenDelivery`, the production `TokenDelivery` implementation. Logs that a token was *issued*, never the token's value (correction #2, §5 below).

### New — auth module (`src/modules/auth/`)
- `types.ts` — `AuthenticatedUser`, `SafeUser`, `toSafeUser()`, `TokenDelivery`.
- `constants.ts` — `SESSION_COOKIE_NAME`, `ROLE_CUSTOMER`, `ROLE_STAFF`, `ROLE_SUPER_ADMIN`.
- `schema.ts` — Zod input schemas for every use-case (registration, login, password reset, email verification, role assignment).
- `domain/password-policy.ts` — pure password-strength check (no I/O).
- `repo.ts` — the only file in this module allowed to import the Prisma client; holds the two atomic transactions (registration, password reset).
- `use-cases/` — one file per operation: `get-current-user`, `require-authenticated-user`, `permissions`, `register`, `login`, `logout`, `logout-all`, `request-password-reset`, `reset-password`, `request-email-verification`, `verify-email`, `assign-role`, `remove-role`, `get-user-profile`.

### New — presentation layer
- `proxy.ts` (root) — cookie-presence redirect for `/account/*`, `/admin/*`.
- `lib/session.ts` — the Next.js-aware seam (`next/headers` `cookies()`) between the framework and the framework-agnostic use-cases.
- `lib/http-error-response.ts` — shared Route Handler error → HTTP response mapping.
- `app/api/auth/{register,login,logout,logout-all,me}/route.ts`
- `app/api/auth/password-reset/{request,confirm}/route.ts`
- `app/api/auth/email-verification/{request,confirm}/route.ts`
- `app/api/admin/users/[userId]/roles/route.ts` (POST assign / DELETE remove)
- `app/api/users/[userId]/route.ts` (GET profile — the IDOR-protected endpoint)
- `app/account/page.tsx`, `app/account/actions.ts` (logout / logout-all Server Actions)
- `app/login/page.tsx`, `app/login/login-form.tsx`, `app/login/actions.ts`

### New — seed data
- `prisma/seed-data.ts` — `PERMISSIONS`, `STAFF_PERMISSIONS`, `seedRbacData(db)` (idempotent upserts).
- `prisma/seed.ts` — CLI entry point calling `seedRbacData`.

### New — tests
- `tests/unit/password-policy.test.ts`, `tests/unit/tokens.test.ts`.
- `tests/integration/{setup.ts, helpers/fixtures.ts}` plus 7 spec files (`auth-registration`, `auth-login`, `auth-sessions`, `auth-password-reset`, `rbac-authorization`, `idor`, `privilege-escalation`).
- `tests/e2e/auth.spec.ts`, `tests/e2e/global-teardown.ts`.
- `vitest.integration.config.mts` (new, separate from the unit config).

### Modified — shared infrastructure
- `lib/env.ts` — added `SESSION_TTL_DAYS`, `PASSWORD_RESET_TOKEN_TTL_MINUTES`, `EMAIL_VERIFICATION_TOKEN_TTL_HOURS` (all optional, defaulted).
- `lib/logger.ts` — extended `redact.paths` with auth-specific key names (§5 below).
- `.env.example` — documents the three new vars.
- `package.json` — added `@node-rs/argon2` (dependency), `tsx`/`dotenv` (devDependencies); added `db:seed`, `test:integration` scripts; registered `"prisma": {"seed": "tsx prisma/seed.ts"}`.
- `playwright.config.ts` — added `globalTeardown` for e2e test data cleanup.

---

## 3. Architecture

Unchanged modular-monolith layering from Phase 0/1 (`docs/ARCHITECTURE.md`
§1), enforced by the existing `eslint-plugin-boundaries` config:

```
Presentation (app/**)
      │  may only call →
Use-case (src/modules/auth/use-cases/*.ts)
      │  may only call →
Repo (src/modules/auth/repo.ts) ── the only file allowed to import Prisma
Domain (src/modules/auth/domain/*.ts) ── pure, zero I/O
Integration (src/integrations/crypto/*, src/integrations/notifications/*)
```

`src/modules/auth/repo.ts` is a single file, not a `repo/` directory —
this follows the pre-existing convention set by `src/modules/health/repo.ts`
and the ESLint `boundaries/files` category patterns, not the plan
document's illustrative directory layout (reconciled explicitly in
`docs/PHASE_3_AUTH_RBAC_PLAN.md` before implementation began).

**Use-cases never import `next/headers`.** Every use-case that needs the
current request's session takes a raw token string as a plain parameter
(e.g. `getCurrentUser(rawToken: string | undefined)`). `lib/session.ts` is
the sole seam that calls `cookies()` and hands the resulting string to the
use-case — this keeps the auth module framework-agnostic and testable
without a Next.js request context (see the integration tests, which call
use-cases directly with no HTTP layer involved).

---

## 4. Session architecture

- **Storage**: `sessions` table (Phase 2B, unchanged). One row per session: `userId`, `sessionTokenHash` (unique, `CHAR(64)`), `userAgent`, `ipAddress`, `expiresAt`, `createdAt`.
- **Cookie**: name `session`, `httpOnly: true`, `secure` in production only, `sameSite: "lax"`, `path: "/"`, `expires` set to the session's `expiresAt`.
- **The cookie is not signed.** It carries the raw 256-bit CSPRNG token value directly (`crypto.randomBytes(32)`, base64url-encoded) — opaque to the client, meaningless without a matching database row. This is the terminology correction from approval: there is no signing/sealing infrastructure anywhere in this design (correction #1).
- **At rest**: only `SHA-256(rawToken)` is ever stored, in `sessionTokenHash`. The raw token exists only in the Set-Cookie header and in memory during the request that issued it.
- **Validity**: a session is valid iff its row exists **and** `expiresAt > now()`. There is no separate "revoked" boolean — logout deletes the row outright (`deleteSessionByTokenHash`), which is indistinguishable from expiry from the resolver's point of view (`findValidSessionByTokenHash` simply returns nothing either way).
- **TTL**: `SESSION_TTL_DAYS` (default 30), no sliding renewal — a session's `expiresAt` is fixed at creation and never extended by use.
- **Rotation**: a brand-new session (and thus a brand-new raw token / hash pair) is issued on every login and after every password reset. Old sessions are never reused or renewed in place.
- **Logout-all**: deletes every `sessions` row for the user (`deleteAllSessionsForUser`) — used by both the explicit "log out of all devices" action and, atomically, by password reset.

---

## 5. Flows

### 5.1 Registration (`POST /api/auth/register`)
`register(input, tokenDelivery)`:
1. Validate input (`registerSchema` — includes the password policy check).
2. Look up the email. If it already exists, compute a dummy Argon2id hash comparison anyway (timing-safety — see §7) and return the **identical** `{ status: "ok" }` shape as success, changing nothing.
3. Otherwise: hash the password, create the user **and** assign the `customer` role in one transaction (`createUserWithCustomerRole` — a user must never exist without a role), issue an email-verification token, hand its raw value to `tokenDelivery.deliverEmailVerificationToken()`, write an audit log entry, and return `{ status: "ok" }`.

**Deliberate deviation from the plan's literal wording**: registration does
**not** create a session or set a cookie, on either the new-account or
duplicate-email path. The plan's prose said to log the new user in
immediately; implementing that literally would have made the *presence of
a `Set-Cookie` header* itself an enumeration side-channel (new account →
cookie set; duplicate → no cookie, despite an identical JSON body). Since
enumeration-safety was an explicit, named goal, registration was
implemented to never auto-login, on any path — a user must sign in
separately after registering. This is a refinement in service of an
already-agreed goal, not a silent architecture change.

### 5.2 Login (`POST /api/auth/login`)
`login(input)`:
1. Look up the user by email. If absent, verify the submitted password against a hardcoded dummy Argon2id hash anyway (never short-circuits), then throw the generic `UnauthorizedError("Invalid email or password.")`.
2. If found but the password doesn't verify, or the account is `SUSPENDED`/soft-deleted: same generic error, same status code (401), in all cases. No response distinguishes "wrong password" from "no such account" from "account suspended."
3. On success: issue a new session (rotates — never reuses an existing one), write an audit log entry, and return `{ user: SafeUser, rawSessionToken, expiresAt }` to the caller (the Route Handler sets the cookie from this; the use-case itself never touches `next/headers`).
4. Audit logging on failure is scoped to the case where the account exists (logging a failed attempt against a nonexistent `userId` isn't meaningful) — a stated, accepted limitation, not an oversight.

### 5.3 Logout / logout-all
- `logout(rawToken)` — deletes the one session matching the hash of the presented token.
- `logoutAll(userId)` — deletes every session belonging to the authenticated user (never trusts a client-supplied user id; the id comes from the resolved session).
- Both are exposed as Route Handlers (`/api/auth/logout`, `/api/auth/logout-all`) and as Server Actions (`app/account/actions.ts`) for the minimal account page.

### 5.4 Session resolution (`getCurrentUser` / `requireAuthenticatedUser`)
`getCurrentUser(rawToken)`:
1. No token → `null`.
2. Hash it, look up a *valid* session (unexpired) joined to its user.
3. If no session, or the user is `SUSPENDED`/soft-deleted → `null`. (All of "no session," "expired," "revoked/deleted session," "suspended user" collapse to the same `null` — there is no way for a caller to distinguish these from the return value alone.)
4. Otherwise resolve permissions (`getUserPermissionKeys`) and return an `AuthenticatedUser`.

`requireAuthenticatedUser(rawToken)` calls the above and throws `UnauthorizedError` (401) on `null` — used by every Route Handler and Server Action that requires a signed-in caller.

### 5.5 Password reset
- **Request** (`POST /api/auth/password-reset/request`) — enumeration-safe: always returns `{ status: "ok" }` regardless of whether the email exists. If it does, issues a `PASSWORD_RESET` verification token (30-minute TTL by default) and hands the raw value to `tokenDelivery.deliverPasswordResetToken()`.
- **Confirm** (`POST /api/auth/password-reset/confirm`) — looks up a valid (unexpired, unconsumed, correct-purpose) token by its hash, then calls `resetPasswordAndRotateSessions`, the atomic transaction added per correction #3 (see §6). Returns the freshly-issued session's user and raw token so the Route Handler can set the cookie — the caller is automatically signed in with the new password, on the new session, with every old session gone.

### 5.6 Email verification
- **Request** (`POST /api/auth/email-verification/request`) — requires an authenticated caller (not enumeration-sensitive, since it acts on "yourself," not an arbitrary email) — issues an `EMAIL_VERIFICATION` token (24-hour TTL by default).
- **Confirm** (`POST /api/auth/email-verification/confirm`) — atomically consumes the token and sets `emailVerifiedAt` (`verifyEmailAndConsumeToken`), the same "no partial completion" transaction pattern as password reset.

### 5.7 Role assignment (admin)
`assignRole(actor, { userId, roleName })` / `removeRole(actor, { userId, roleName })`:
1. `requirePermission(actor, "users.manage")` is the **first** line of the use-case body — checked before anything else, including validating that the target user exists. An unauthorized caller learns nothing about the target.
2. Only then: look up the role by name, upsert/delete the `user_roles` row, write an audit log entry.
3. The actor is always the caller resolved server-side from their session (`requireSessionUser()` in the Route Handler) — never taken from the request body. Verified at the HTTP layer in `tests/e2e/auth.spec.ts` by sending a POST body with forged `actorPermissions`/`isAdmin` fields and confirming they have zero effect.

---

## 6. RBAC and permission architecture

- **Model**: `roles` ←`user_roles`(N:N)→ `users`; `roles` ←`role_permissions`(N:N)→ `permissions`. All from Phase 2B's schema, unchanged.
- **Seeded roles**: `customer` (0 permissions — deliberately empty; a plain customer has no admin-surface access at all), `staff` (7 permissions — read/update-scoped operational access), `super_admin` (all 14 permissions).
- **Seeded permissions** (`prisma/seed-data.ts`): `products.{read,create,update,delete}`, `inventory.{read,adjust}`, `orders.{read,update}`, `payments.{read,refund}`, `consultations.{read,update}`, `settings.manage`, and the Phase-3-introduced `users.manage`.
- **Resolution timing**: permissions are computed once, at session-lookup time (`getUserPermissionKeys`, called from `getCurrentUser`), and attached to the `AuthenticatedUser` as a `ReadonlySet<string>`. They are **not** re-checked against the database on every `hasPermission()` call within a request — a role change made mid-session takes effect on the *next* session resolution (next request), not retroactively on requests already in flight. This mirrors the session model's "no sliding revalidation" design and is consistent with the session itself not being cache-busted on role change (only password reset forces new sessions).
- **Checks**: `hasPermission(user, key)` (boolean) and `requirePermission(user, key)` (throws `ForbiddenError`, 403) — both operate purely on the in-memory `AuthenticatedUser`, no I/O.
- **Centralization**: every permission-gated use-case calls `requirePermission` itself, as the first statement — the check lives in the use-case, not the Route Handler, per the "security boundary must be inside use-cases" constraint. A Route Handler that forgot the check couldn't accidentally allow an unauthorized action through, because the use-case enforces it independently.

---

## 7. Security controls

- **Password hashing**: Argon2id via `@node-rs/argon2` (Rust/NAPI bindings — no native toolchain required, consistent with the project's dependency-friction history). Default cost parameters (library defaults are OWASP-aligned for Argon2id as of the installed version).
- **Token generation**: `crypto.randomBytes(32)` (256 bits of entropy) → base64url. Hashed at rest with plain `SHA-256` (`crypto.createHash("sha256")`) — no HMAC/pepper, because the token itself already carries full CSPRNG entropy and is single-use/short-lived (verification tokens) or revocable (sessions); a pepper would add operational key-management burden without a corresponding threat it closes here.
- **Timing-safety**: both login and registration perform a real Argon2id `verify()` call against a hardcoded dummy hash on every "account doesn't exist" path, so the response time for a nonexistent email is indistinguishable from a wrong-password response for a real one. Verified empirically (via direct Node invocation) that the dummy hash returns `false` rather than throwing.
- **Enumeration-safety**: identical response shapes (status code + body) for login regardless of which rejection reason applies; identical response for registration regardless of duplicate email; password-reset request always `{ status: "ok" }`.
- **IDOR protection**: `getUserProfile(actor, targetUserId)` — the reference pattern — allows access iff `actor.id === targetUserId` **or** `hasPermission(actor, "users.manage")`, checked server-side against the *fetched* row's owner, never against a client-supplied claim. A nonexistent target ID returns `NotFoundError` (404), not a different error from "exists but not yours" in a way that would leak existence — actually it does distinguish 403 (exists, not yours) from 404 (doesn't exist); this was an accepted, deliberate choice for this endpoint since the target ID space (sequential BigInt) isn't secret in the way an email address is, and the plan doc's enumeration-safety requirement was scoped to *account existence by email*, not numeric ID guessing on an already-authenticated endpoint.
- **Privilege escalation protection**: `assign-role`/`remove-role` gate on `users.manage` before touching the target; a customer cannot self-promote, cannot promote another user, and forged request-body fields (an extra `isAdmin: true`, `actorPermissions: [...]`) have zero effect because the actor's identity and permissions are always resolved server-side from the session, never from request input. Covered at both the integration level (`privilege-escalation.test.ts`) and the HTTP level (`tests/e2e/auth.spec.ts`, which specifically exercises forged body fields over real HTTP).
- **Cookie attributes**: `httpOnly` (no JS access), `secure` in production, `sameSite: "lax"` (CSRF mitigation for state-changing cross-site navigation while still allowing normal top-level navigation), scoped `path: "/"`.
- **`proxy.ts`**: a cheap, DB-free, cookie-*presence* check only — never the actual authorization boundary. It exists purely to redirect the obviously-logged-out case before any Server Component/Action/Route Handler runs. The real check is always `requireSessionUser()`/`requireAuthenticatedUser()` inside the destination, which does hit the database and can reject a present-but-expired-or-revoked cookie that `proxy.ts` let through.
- **Audit logging**: written for registration, login (success and — where the account exists — failure), role assignment, and role removal. Each entry: `actorId` (nullable — `null` for a failed login against a real account, since the "actor" attempting the action isn't a verified identity yet in that case; `actorType` is `SYSTEM` for entries with no authenticated actor and `USER` otherwise), `action` (a string key, e.g. `"user.registered"`, `"auth.login.failed"`), `entityType`, `entityId`. `audit_logs.entityId` is deliberately not a real foreign key (Phase 2B design, `docs/DATABASE_DESIGN.md` §15), which is why test cleanup deletes matching audit rows explicitly rather than relying on cascade.
- **Redaction**: `lib/logger.ts`'s `redact.paths` was extended with `*.passwordHash`, `*.rawToken`, `*.sessionToken`, `*.sessionTokenHash`, `*.tokenHash`, `*.verificationToken`, `*.resetToken` — added explicitly because pino's redaction matches literal property names, not substrings, so the pre-existing generic `*.token`/`*.password` patterns would not have caught these auth-specific field names. Active in every environment (the redact config sits outside the dev-only `transport` conditional), confirmed by direct inspection.

---

## 8. Token logging (correction #2)

No code path anywhere logs a raw password-reset token, email-verification
token, or session token — in any environment, including development. The
production `TokenDelivery` implementation (`noopTokenDelivery`) logs only
`{ email }`, explicitly destructuring the raw token out before the log
call, with a doc comment reiterating why. Tests that need to observe an
issued token's value use `createCapturingTokenDelivery()`
(`tests/integration/helpers/fixtures.ts`), a test-only fixture that holds
the value in memory for assertions — never through a log line, satisfying
the correction's requirement for "a controlled test-only delivery adapter,
not logs." Verified in the final security source scan (§10).

---

## 9. Password reset atomicity (correction #3)

`resetPasswordAndRotateSessions` (`src/modules/auth/repo.ts`) performs, in
one Prisma `$transaction`:
1. Re-check-and-consume the token (`updateMany` with `consumedAt: null` in
   its `WHERE` clause — if a concurrent request already consumed it, this
   affects 0 rows and the transaction throws, so the token can never be
   used twice even under a race).
2. Update the user's `passwordHash`.
3. Delete every existing session for the user.
4. Create the replacement session.

All four steps commit or none do — there is no window where the password
changes but old sessions remain valid, or where the token is consumed but
the password update fails silently.

---

## 10. Verification results

All commands run with Node 22.23.1 (`.nvmrc`) against the real MySQL
database (`watplux`).

| Check | Result |
|---|---|
| `tsc --noEmit` | **0 errors** |
| ESLint | **0 issues** (including architectural boundary rules) |
| Prettier `--check` | **all files formatted** |
| Unit tests (`vitest run`) | **12/12 passed** |
| Integration tests (`vitest run --config vitest.integration.config.mts`) | **35/35 passed**, 7 files (registration, login, sessions, password reset, RBAC authorization, IDOR, privilege escalation) |
| Production build (`next build`) | **0 errors, 0 warnings** — `/account` correctly resolved as dynamic (`ƒ`), `/login` as static (`○`) |
| Playwright e2e (`playwright test`) | **10/10 passed** (1 pre-existing health check + 9 new auth/IDOR/privilege-escalation-over-HTTP tests) |
| ESLint boundary-violation re-test | **confirmed rejected**: a deliberately introduced `app/account/page.tsx` → `src/modules/auth/repo.ts` direct import was caught (`boundaries/dependencies` error), then reverted |
| Security source scan | **PASS** — see §11 |
| Test-database cleanliness | Confirmed via direct MySQL query: 0 leftover users, 0 leftover sessions, 0 leftover verification tokens, 0 leftover audit logs after both the integration suite and the e2e suite (the latter required adding a Playwright `globalTeardown`, since e2e tests exercise real HTTP and have no in-process `afterAll` hook) |

Two issues were found and fixed during verification, not before:
1. **`instant = false` needed on `/account`.** Next.js 16's Cache
   Components validation failed the production build with "uncached or
   runtime data during prerendering" because the page reads the session
   cookie on every request and can never produce a static shell. Per
   `node_modules/next/dist/docs/.../route-segment-config/instant.md` and
   the Cache Components migration guide, `export const instant = false`
   is the documented opt-out for a segment that must be allowed to block
   — added to `app/account/page.tsx` with a comment explaining why. This
   does not weaken the auth check; it only tells Next.js the route is
   expected to render at request time.
2. **`rtk next build`'s summarized output silently reported "Errors: 0 |
   Warnings: 0" on the same build that raw `next build` failed with exit
   code 1.** Discovered because Playwright's `webServer` (which runs the
   real, unfiltered `next build`) failed even though the RTK-filtered
   build report claimed success. The raw, unfiltered build output was
   used as the source of truth for the remainder of verification; this is
   noted here as a tooling caveat, not an application defect.

Two test-file bugs (not application bugs) were also caught and fixed by
`tsc`/e2e runs, then re-verified clean: `noUncheckedIndexedAccess`
violations in `auth-registration.test.ts` (indexed array access without a
guard) and a BigInt-literal target mismatch in `idor.test.ts`
(`999_999_999n` requires ES2020+; the project's `tsconfig.json` target is
ES2017 by design) — fixed with `BigInt(999_999_999)`.

---

## 11. Security source scan

A dedicated scan (final gate before sign-off) searched the entire
`app/`, `src/`, and `lib/` trees for: raw passwords, `passwordHash`,
`rawToken`, `sessionToken`/`sessionTokenHash`, `tokenHash`,
`verificationToken`, `resetToken`, `Authorization` headers, and cookie
values, checking every API response body (success and error paths), every
Client Component, every `logger.*`/`console.*` call site, and confirming
`toSafeUser()` is used at every boundary where a user-shaped object could
cross into a response.

**Result: PASS.** No route handler anywhere returns a raw Prisma `User`,
`Session`, or `VerificationToken` object; every user-shaped response value
goes through `toSafeUser()`. No raw token value ever reaches a
`NextResponse.json(...)` body or a `logger.*`/`console.*` call. Full
finding-by-finding detail is in the scan transcript (not reproduced here);
one soft, non-blocking observation was noted — `app/error.tsx` and
`app/global-error.tsx` (client-side error boundaries) call
`console.error(error)` on uncaught render errors, which is not currently
in any auth data path but would be worth scrubbing before logging if that
ever changes.

---

## 12. Deferred / explicitly out of scope for Phase 3

Per the approved plan and the master instruction's Phase 3 boundaries,
none of the following were built, and none of this phase's code depends on
them existing:

- **Rate limiting / brute-force protection** on login or password-reset-request. No Redis, no in-memory limiter. The interface boundary for adding this later (e.g. wrapping `login`/`requestPasswordReset`) was kept in mind but no stub or placeholder code was added, per instruction not to introduce Redis or invent unapproved infrastructure.
- **Real email delivery.** `noopTokenDelivery` is the only `TokenDelivery` implementation; no SMTP/provider integration exists.
- **Multi-factor authentication, OAuth/social login, "remember me," magic links.**
- **Admin UI for role management** — only the API endpoints (`/api/admin/users/[userId]/roles`) exist; no dashboard page.
- **Commerce features of any kind** — no products, cart, checkout, Paystack, orders, inventory, or storefront code was touched or added.
- **Full password-reset/email-verification UI pages** — these flows are implemented and tested at the use-case/integration and API level; no dedicated `/reset-password` or `/verify-email` frontend page was built (out of scope for "auth/RBAC foundation," consistent with `/login`/`/account` being the only pages built).

---

## 13. Known limitations

- Failed-login audit logging only fires when the submitted email matches a real account (logging against a nonexistent user id isn't meaningful) — an unauthenticated attacker probing random emails leaves no audit trail until they guess a real one.
- Permissions are resolved once per session lookup, not re-validated per-request against the database beyond that — a role change or permission-set change takes effect on the affected user's *next* request, not instantly, and is not retroactively enforced against requests already in flight (consistent with the session model's no-sliding-revalidation design, not an oversight).
- `GET /api/users/[userId]` distinguishes 403 (exists, not yours) from 404 (doesn't exist) — a deliberate, scoped decision (see §7) that is intentionally less strict than the plan's enumeration-safety requirement for *email*-based account existence, since sequential numeric IDs aren't treated as a secret in this design.
- No native browser was used for e2e coverage (Playwright's `request`/`request.newContext()` only, per the Phase 1 decision to avoid installing browser binaries) — so no test exercises the login `<form>`'s actual rendered HTML/JS behavior in a real browser; the HTTP-level behavior it depends on (cookies, redirects, JSON bodies) is fully covered instead.

---

## 14. Environment variables introduced

| Variable | Default | Purpose |
|---|---|---|
| `SESSION_TTL_DAYS` | `30` | Session cookie / row lifetime |
| `PASSWORD_RESET_TOKEN_TTL_MINUTES` | `30` | Password-reset token validity window |
| `EMAIL_VERIFICATION_TOKEN_TTL_HOURS` | `24` | Email-verification token validity window |

All three are optional with sane defaults (`zod` `.coerce.number().default(...)`
in `lib/env.ts`); no new required variable and no secret/key variable was
introduced (tokens are hashed with plain SHA-256, not HMAC — no server-side
pepper to manage).
