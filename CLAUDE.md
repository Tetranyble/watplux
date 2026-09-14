## Phase 16 release-test contract

- Keep Playwright API tests and browser tests as separate projects; do not multiply the whole API suite across device profiles.
- Browser tests use accessible selectors (`getByRole`, `getByLabel`) rather than brittle CSS/test-id selectors unless there is no semantic alternative.
- Domain concurrency/payment/state-machine depth belongs in integration tests; browser tests cover browser-specific behavior and critical user journeys.
- Every new E2E identity/fixture must have deterministic cleanup. `audit_logs` has no actor FK cascade, so test actors must be included in generic audit cleanup.
- Do not call a dependency-free accessibility smoke a full WCAG audit. Manual keyboard, zoom/reflow and assistive-technology checks remain release requirements.

@AGENTS.md

# Watplux architecture contract

Before changing application architecture, read `docs/BETTER_AUTH_REBUILD.md` and the latest phase implementation docs. The source tree is authoritative.

- **Authentication:** Better Auth only. Do not reintroduce custom session HTTP routes, Auth.js, NextAuth, Lucia, JWT auth, or a second session store. Better Auth owns users' credential accounts/sessions/verifications; `lib/session.ts` maps its session to the existing application actor.
- **Authorization:** application RBAC only (`roles`, `permissions`, `user_roles`, `role_permissions`). Business use-cases call `requirePermission`; UI/nav/proxy checks are never the security boundary.
- **Database:** Prisma + MySQL remain the application ORM/database layer. Prisma seeding is supported and used for RBAC + optional bootstrap admin. Never replace Prisma merely for auth.
- **Layering:** routes/pages -> use-cases -> repo -> Prisma. Database access (`lib/db`, PrismaClient queries/transactions) belongs in repositories/infrastructure. Some older domain files still use Prisma.Decimal/types as scalar representations; do not expand that leakage, and prefer dependency-neutral domain types in new work.
- **Customer experience:** storefront auth/account/cart/order flow stays separate from `/admin`.
- **Operations:** `/admin` is the clean internal workspace. Product changes must use Catalog use-cases so default-variant, primary-image, slug, price and concurrency invariants remain intact.
- **Cross-phase stability:** prefer additive extensions. Do not silently change payment, inventory, order, refund or checkout state machines to make a UI easier.
- **Migrations:** never rewrite historical migrations. Add a new migration only when the current schema genuinely cannot represent the approved behavior.

<!-- rtk-instructions v2 -->
# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:
```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)
```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (60-99% savings)
```bash
rtk cargo test          # Cargo test failures only (90%)
rtk go test             # Go test failures only (90%)
rtk jest                # Jest failures only (99.5%)
rtk vitest              # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk pytest              # Python test failures only (90%)
rtk rake test           # Ruby test failures only (90%)
rtk rspec               # RSpec test failures only (60%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)
```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)
```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)
```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
rtk uv run <cmd>        # Compact uv project command output
```

### Files & Search (60-75% savings)
```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%). Format flags (-c, -l, -L, -o, -Z) run raw.
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)
```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)
```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)
```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands
```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->
## Phase 15 security/performance decisions (2026-08-31)

- Better Auth's built-in rate limiter uses database storage; do not replace it with an in-memory-only limiter for production.
- Non-auth public mutation abuse controls live in `src/integrations/rate-limit/` and persist to `request_rate_limits`.
- Client IP must come only from `TRUSTED_CLIENT_IP_HEADER`; deployment ingress must overwrite that header.
- `safeInternalPath` is the canonical post-auth redirect sanitizer.
- `/api/internal/process-webhook-events` uses constant-time secret comparison; GET is the machine-authenticated webhook-worker health endpoint.
- Paystack webhook bodies are hard-capped while streaming before parsing.
- Global security headers/CSP are centralized in `next.config.ts`.
- Do not add ineffective B-tree indexes for `%LIKE%` catalog search. Search architecture changes require measured evidence.


## Phase 17 deployment invariants

- Production web runs from the `runner` target in `Dockerfile`; Prisma migrations run once from the separate `migrator` target before rollout. Never add `prisma migrate deploy` to application startup.
- `/api/live` is dependency-free process liveness. `/api/ready` is traffic readiness and may check MySQL/configuration. Do not merge these probes.
- Production MySQL is managed/external; the repository root `docker-compose.yml` database is local development only.
- Production media uses the S3-compatible provider. Do not persist uploaded media on the web container filesystem.
- Rollback means previous immutable application image. Never use `prisma migrate reset` or automatic down migrations in production.
- Cache Components may execute database reads at build time. Docker builds must use a migrated disposable build database with no production/customer data.
- Runtime secrets are injected at deploy time and must never be Docker build arguments or image ENV defaults.

## Phase 18 release-candidate invariants

- `/api/orders` is read-only. Customer order creation MUST go through Cart + `/api/checkout`; do not re-expose the lower-level `createOrder()` use-case as a public HTTP mutation.
- Unauthorized cross-user profile lookup deliberately returns 404 to avoid user-ID existence disclosure.
- Run `npm run audit:release` before release work and `npm run release:gate` when dependencies/browser infrastructure are available.
- A source-level GO is not a production GO. The external evidence gates in `docs/PHASE_18_FINAL_ARCHITECTURE_RELEASE_AUDIT.md` are mandatory.

## UI / form system (post-Phase 18 polish)

- Visible controls in feature code use the shadcn layer under `components/ui/*`; do not add raw styled inputs, selects, textareas or buttons.
- Meaningful forms use React Hook Form with `mode: "onChange"`, `reValidateMode: "onChange"`, shared controlled fields, and the existing domain Zod schema where available. Server/use-case validation remains authoritative.
- Use `emptyAsUndefined` for omitted optional values and `emptyAsNull` when an update form must explicitly clear a nullable value.
- Prefer `ResourceToolbar` for search/create composition, `QueryFilterForm` for URL-backed filters, `UrlDialog` for contextual create/edit flows, and `ConfirmDialog` for destructive confirmation. Never use `window.confirm`.
- Run `npm run audit:ui` before release. See `docs/UI_FORM_SYSTEM.md`.
