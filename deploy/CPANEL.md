# Deploy Watplux to cPanel

Watplux runs in cPanel as a Node.js application backed by MySQL and either
S3-compatible storage or a persistent local media directory outside versioned
releases. It is not a static export and must not be extracted into
`public_html`.

## Hosting requirements

Confirm the hosting plan provides:

- cPanel **Setup Node.js App** with Node.js `22.23.1` or newer;
- SSH or cPanel Terminal and cron jobs;
- MySQL 8-compatible connectivity with backups and point-in-time recovery;
- outbound HTTPS access to Paystack, SMTP, optional Termii, and the configured
  storage service;
- enough memory to run the packaged Next.js server.

If the cPanel MySQL service does not provide production-grade backups/PITR,
use an external managed MySQL provider. If local media storage is selected,
the hosting account must back up `/home/CPANEL_USER/watplux/shared/media`; never
store uploads inside `releases/<git-sha>` or `runtime/`.

## 1. Prepare the database, storage and HTTPS

Create a dedicated production database/user and grant that user privileges on
only the Watplux database. Choose either the persistent local directory shown
in `.env.cpanel.example` or an S3 bucket with versioning and least-privilege
credentials. Point the domain to the hosting account and finish SSL
provisioning before enabling a forced HTTPS redirect.

Paystack's callback origin must be the final HTTPS site URL. In the Paystack
dashboard, register this exact public webhook endpoint:

```text
https://your-domain.example/api/paystack/webhook
```

This endpoint accepts Paystack events and stores them durably. Do not register
the internal worker endpoint with Paystack. `PAYSTACK_SECRET_KEY` is also used
to verify the `x-paystack-signature` header; there is no separate webhook
secret in this application.

## 2. Build the release locally

Install Node `22.23.1`, application dependencies, and `zip`. Watplux Cache
Components can read the database during `next build`, so the build must use an
empty disposable MySQL database—not production and not a copy of customer
data.

```bash
nvm use
npm ci
export BUILD_DATABASE_URL='mysql://USER:PASSWORD@127.0.0.1:3306/watplux_build'
export CPANEL_APP_URL='https://your-domain.example'
export CONFIRM_DISPOSABLE_BUILD_DATABASE=yes
npm run build:cpanel
```

The command audits the source, migrates only the disposable build database,
builds the standalone runtime with webpack, and creates:

```text
release/cpanel/watplux-cpanel-<git-sha>.zip
```

The packager refuses a dirty working tree. Runtime secrets and production data
are never placed in the archive. The project-wide `npm run release:gate`
remains mandatory on infrastructure with MySQL and browser-test support before
a production GO. The cPanel-only build deliberately uses webpack because
Turbopack's hashed external package aliases are not portable. During packaging,
locked Linux x64 Prisma, Argon2, Sharp, and libvips files are placed directly in
the standalone runtime. The normal `npm run build` command remains unchanged.

## 3. Create a versioned release on cPanel

Keep releases immutable so rollback means selecting the previous archive, not
editing production files in place. Replace `CPANEL_USER` and `<git-sha>` below:

```bash
mkdir -p /home/CPANEL_USER/watplux/releases/<git-sha>
unzip watplux-cpanel-<git-sha>.zip -d /home/CPANEL_USER/watplux/releases/<git-sha>
cd /home/CPANEL_USER/watplux/releases/<git-sha>
node scripts/prepare-cpanel-runtime.mjs
node scripts/cpanel-runtime-preflight.mjs
```

The archive is self-contained for Namecheap/CloudLinux shared hosting. Its
standalone runtime already contains Linux x64 Sharp, Argon2, Prisma Client, and
the RHEL/OpenSSL Prisma engines. The web application does not depend on cPanel's
separate Node virtual-environment package directory and does not require **Run
NPM Install**.

Always extract into a newly created, empty SHA-named directory. Do not unpack a
new archive over an earlier `runtime/`; stale Turbopack chunks can survive a ZIP
overlay and be loaded after restart. Confirm the extracted release before
switching traffic:

```bash
cat RELEASE_SHA
test -f runtime/.next/server/webpack-runtime.js
test ! -f 'runtime/.next/server/chunks/[turbopack]_runtime.js'
test ! -f 'runtime/.next/server/chunks/ssr/[turbopack]_runtime.js'
```

Do not run `npm run build` on cPanel; the production build and its Linux-native
runtime dependencies are already in `runtime/`.

Create `/home/CPANEL_USER/watplux/shared/.env.production` from the packaged
`.env.production.example`, fill every placeholder, set permission `600`, then
link it into the release:

```bash
ln -s /home/CPANEL_USER/watplux/shared/.env.production .env.production
chmod 600 /home/CPANEL_USER/watplux/shared/.env.production
```

For persistent local media, create and protect the shared directory once:

```bash
mkdir -p /home/CPANEL_USER/watplux/shared/media
chmod 750 /home/CPANEL_USER/watplux/shared/media
```

Set `MEDIA_STORAGE_PROVIDER=local`, `CPANEL_PERSISTENT_LOCAL_MEDIA=true`, and
`LOCAL_MEDIA_ROOT=/home/CPANEL_USER/watplux/shared/media`. Fresh deployments
then replace only application code; uploaded files remain in `shared/media`.

Generate independent secrets with `openssl rand -base64 48`. Do not reuse the
Better Auth, guest-order, and internal-worker secrets.

## 4. Validate and migrate before rollout

Load the private runtime configuration in the terminal and run configuration
preflight before switching traffic:

```bash
set -a
source .env.production
set +a
npm run ops:preflight:cpanel
```

Prisma migrations still run exactly once before rollout, but shared hosting may
not permit installing the Prisma CLI. Run them from a trusted release machine
that has the same committed code and an authenticated connection to production,
or apply the reviewed migration SQL through the hosting database tool. Never
add migrations to application startup.

On the first deployment only, bootstrap structural RBAC data and the initial
owner account from the same trusted release machine used for migrations. The
self-contained web archive intentionally does not include development tools
such as `tsx` or the Prisma CLI, so do not run `npm run db:seed` on cPanel.

After the first successful seed, remove `SEED_ADMIN_EMAIL`,
`SEED_ADMIN_PASSWORD`, and `SEED_ADMIN_NAME` from the runtime environment.
Never add `prisma migrate deploy` or seeding to `server.js` startup.

## 5. Configure Setup Node.js App

Create the stable release pointer:

```bash
ln -sfn /home/CPANEL_USER/watplux/releases/<git-sha> /home/CPANEL_USER/watplux/current
```

Use these cPanel values:

| Field | Value |
| --- | --- |
| Node.js version | `22.23.1` or newer Node 22 |
| Application mode | `Production` |
| Application root | `watplux/current` |
| Application URL | the production domain, with no path suffix |
| Application startup file | `server.js` |

Do not configure `PORT`; cPanel supplies it. Restart the Node.js application
after changing the release pointer or environment. If Setup Node.js App does
not accept a symlinked application root, point it directly at the versioned
release directory and update that field during each rollout.

## 6. Register the webhook worker cron job

The web process does not run migrations or background loops. Add a once-per-
minute cPanel cron job that loads the private environment and invokes the
authenticated worker endpoint. In **cPanel → Cron Jobs**, choose **Once Per
Minute** and paste this command as one line:

```bash
/bin/bash -lc 'cd /home/CPANEL_USER/watplux/current && set -a && source .env.production && set +a && APP_INTERNAL_URL=https://your-domain.example ./scripts/trigger-webhook-worker.sh' >> /home/CPANEL_USER/watplux/shared/webhook-worker.log 2>&1
```

The cron calls:

```text
POST https://your-domain.example/api/internal/process-webhook-events
Header: x-internal-worker-secret: <INTERNAL_WORKER_SECRET>
```

The packaged trigger script supplies that header from `.env.production`, so
the secret is not copied into cPanel's cron command. Protect and rotate the log:

```bash
touch /home/CPANEL_USER/watplux/shared/webhook-worker.log
chmod 600 /home/CPANEL_USER/watplux/shared/webhook-worker.log
```

Both integrations are required for payment state to progress:

1. Paystack sends events to `POST /api/paystack/webhook`.
2. The cron invokes `POST /api/internal/process-webhook-events` every minute.

The first endpoint verifies and stores events quickly; the second performs the
slower authoritative verification and order/payment updates.

## 7. Verify production

Check these endpoints in order:

```text
https://your-domain.example/api/live
https://your-domain.example/api/ready
https://your-domain.example/
https://your-domain.example/login
https://your-domain.example/admin
```

Then verify registration email delivery, email verification, password reset,
login, owner RBAC, product browsing, a consultation acknowledgement, an
approved Paystack test/live checkout, media upload, avatar upload, and one
authenticated webhook-worker run. If Termii is configured, confirm the SMS
acknowledgement too. Confirm `/api/ready` is healthy before accepting traffic.

## Later releases and rollback

1. Confirm database backup/PITR and either S3 versioning or shared-media backup.
2. Upload and extract the new SHA-named archive into a new release directory.
3. Run the packaged runtime preflight and apply the new release's migrations
   through the approved one-shot migration path.
4. Switch `current` to the new directory and restart the cPanel app.
5. Run the verification checklist and monitor logs.

For an application regression, point `current` back to the previous immutable
release directory and restart. Do not run down migrations or any destructive
Prisma reset operation. If a migration is not backward-compatible, follow the
database restore procedure in
`docs/operations/INCIDENT_ROLLBACK_RUNBOOK.md` before switching application
versions.
