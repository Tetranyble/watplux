#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-expressions -- compact audit assertions always call pass() or fail(). */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const checks = [];
const fail = (name, detail) => checks.push({ name, ok: false, detail });
const pass = (name, detail = "") => checks.push({ name, ok: true, detail });
const read = (p) => readFileSync(join(root, p), "utf8");

function filesUnder(dir) {
  const absolute = join(root, dir);
  if (!existsSync(absolute)) return [];
  const out = [];
  for (const entry of readdirSync(absolute)) {
    const path = join(absolute, entry);
    if (statSync(path).isDirectory())
      out.push(...filesUnder(relative(root, path)));
    else out.push(relative(root, path));
  }
  return out;
}

// Authentication ownership / legacy cutover.
for (const legacy of [
  "src/modules/auth/use-cases/login.ts",
  "src/modules/auth/use-cases/register.ts",
  "src/modules/auth/use-cases/request-password-reset.ts",
  "src/modules/auth/use-cases/reset-password.ts",
  "middleware.ts",
]) {
  existsSync(join(root, legacy))
    ? fail(`legacy:${legacy}`, "Legacy auth/runtime boundary still exists")
    : pass(`legacy:${legacy}`);
}

const auth = read("lib/auth.ts");
auth.includes('from "better-auth/minimal"') &&
auth.includes('storage: "database"')
  ? pass("auth:better-auth-single-owner")
  : fail(
      "auth:better-auth-single-owner",
      "Better Auth minimal + database limiter expected",
    );

// Production order creation must go through Checkout, not the lower-level order primitive.
const ordersRoute = read("app/api/orders/route.ts");
/export\s+async\s+function\s+POST\b/.test(ordersRoute)
  ? fail(
      "route:orders-collection-read-only",
      "POST /api/orders bypasses Checkout/Payment",
    )
  : pass("route:orders-collection-read-only");

const checkoutRoute = read("app/api/checkout/route.ts");
checkoutRoute.includes("enforcePublicRateLimit") &&
checkoutRoute.includes("completeCheckout")
  ? pass("route:checkout-is-order-entrypoint")
  : fail(
      "route:checkout-is-order-entrypoint",
      "Checkout must remain rate-limited and authoritative",
    );

// Every /api/admin route must establish a server-side actor before delegating.
const adminRoutes = filesUnder("app/api/admin").filter(
  (f) => f.endsWith("/route.ts") || f === "app/api/admin/route.ts",
);
const unguardedAdmin = adminRoutes.filter(
  (f) => !read(f).includes("requireSessionUser"),
);
unguardedAdmin.length === 0
  ? pass(
      "rbac:all-admin-api-routes-session-guarded",
      `${adminRoutes.length} routes`,
    )
  : fail(
      "rbac:all-admin-api-routes-session-guarded",
      unguardedAdmin.join(", "),
    );

// Navigation permissions must exist in the structural RBAC seed.
const nav = read("components/admin/admin-nav-links.ts");
const seed = read("prisma/seed-data.ts");
const navPermissions = [...nav.matchAll(/permission:\s*"([^"]+)"/g)].map(
  (m) => m[1],
);
const missingPermissions = navPermissions.filter(
  (p) => !seed.includes(`"${p}"`),
);
missingPermissions.length === 0
  ? pass(
      "rbac:admin-nav-permissions-seeded",
      `${navPermissions.length} permissioned links`,
    )
  : fail("rbac:admin-nav-permissions-seeded", missingPermissions.join(", "));

// Machine endpoint must not accept browser session auth.
const worker = read("app/api/internal/process-webhook-events/route.ts");
worker.includes("safeEqualSecret") &&
!worker.includes("getSessionUser") &&
!worker.includes("requireSessionUser")
  ? pass("internal:worker-machine-auth-only")
  : fail(
      "internal:worker-machine-auth-only",
      "Worker route must use constant-time machine-secret auth only",
    );

// Operational invariants.
const dockerfile = read("Dockerfile");
dockerfile.includes("USER nextjs") &&
dockerfile.includes("FROM runner") === false
  ? pass("deploy:non-root-runtime")
  : dockerfile.includes("USER nextjs")
    ? pass("deploy:non-root-runtime")
    : fail("deploy:non-root-runtime", "Runtime must be non-root");

const releaseWorkflow = read(".github/workflows/release.yml");
releaseWorkflow.includes("migrate") &&
releaseWorkflow.includes("BUILD_DATABASE_URL")
  ? pass("deploy:one-shot-migration-release-path")
  : fail(
      "deploy:one-shot-migration-release-path",
      "Release workflow must build/migrate from disposable build DB and one-shot migrator",
    );

const preflight = read("scripts/production-preflight.mjs");
preflight.includes("MEDIA_STORAGE_PROVIDER") &&
preflight.includes("PAYSTACK_SECRET_KEY")
  ? pass("deploy:production-preflight")
  : fail(
      "deploy:production-preflight",
      "Production storage/payment preflight missing",
    );

const prismaSchema = read("prisma/schema.prisma");
const cpanelPackager = read("scripts/package-cpanel.sh");
const cpanelRuntimePreflight = read("scripts/cpanel-runtime-preflight.mjs");
const cpanelDebianEngine = "libquery_engine-debian-openssl-1.0.x.so.node";
prismaSchema.includes('"debian-openssl-1.0.x"') &&
cpanelPackager.includes(cpanelDebianEngine) &&
cpanelRuntimePreflight.includes(cpanelDebianEngine)
  ? pass("deploy:cpanel-debian-prisma-engine")
  : fail(
      "deploy:cpanel-debian-prisma-engine",
      "The cPanel client, archive, and preflight must require the Debian/OpenSSL 1.0 Prisma engine",
    );

// Secret hygiene across source/config (exclude documentation/test examples and lockfile).
const scanRoots = [
  "app",
  "components",
  "lib",
  "src",
  "prisma",
  "scripts",
  ".github",
  "deploy",
];
const candidates = scanRoots
  .flatMap(filesUnder)
  .filter((f) => !f.endsWith("package-lock.json") && !f.endsWith(".example"));
const secretPatterns = [
  /sk_live_[A-Za-z0-9_-]{8,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
];
const secretHits = [];
for (const file of candidates) {
  let text;
  try {
    text = read(file);
  } catch {
    continue;
  }
  if (secretPatterns.some((pattern) => pattern.test(text)))
    secretHits.push(file);
}
secretHits.length === 0
  ? pass("secrets:no-obvious-production-secret-material")
  : fail(
      "secrets:no-obvious-production-secret-material",
      secretHits.join(", "),
    );

// Prevent destructive migration commands from executable operations paths.
const executableOps = [
  ...filesUnder("scripts"),
  ...filesUnder(".github/workflows"),
  ...filesUnder("deploy"),
];
const destructive = executableOps.filter((file) => {
  let text;
  try {
    text = read(file);
  } catch {
    return false;
  }
  return /prisma\s+migrate\s+reset|prisma\s+db\s+push\s+--force-reset/i.test(
    text,
  );
});
destructive.length === 0
  ? pass("deploy:no-destructive-schema-command-in-ops")
  : fail("deploy:no-destructive-schema-command-in-ops", destructive.join(", "));

const failed = checks.filter((c) => !c.ok);
for (const check of checks) {
  console.log(
    `${check.ok ? "[PASS]" : "[FAIL]"} ${check.name}${check.detail ? ` — ${check.detail}` : ""}`,
  );
}
console.log(
  `\nRelease architecture audit: ${checks.length - failed.length}/${checks.length} checks passed.`,
);
if (failed.length) process.exit(1);
