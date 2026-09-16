# Deploy Watplux to cPanel

Watplux runs in cPanel as a Node.js application backed by MySQL and
S3-compatible object storage. It is not a static export and must not be
extracted into `public_html`.

## Hosting requirements

Confirm the hosting plan provides:

- cPanel **Setup Node.js App** with Node.js `22.23.1` or newer;
- SSH or cPanel Terminal and cron jobs;
- MySQL 8-compatible connectivity with backups and point-in-time recovery;
- outbound HTTPS access to Paystack and the configured S3 service;
- enough memory to run the packaged Next.js server.

If the cPanel MySQL service does not provide production-grade backups/PITR,
use an external managed MySQL provider. Uploaded media must use S3; do not use
the cPanel application filesystem for production uploads.

## 1. Prepare the database, storage and HTTPS

Create a dedicated production database/user and grant that user privileges on
only the Watplux database. Create the private S3 bucket, enable object
versioning, and create least-privilege credentials for that bucket. Point the
domain to the hosting account and finish SSL provisioning before enabling a
forced HTTPS redirect.

Paystack's callback origin must be the final HTTPS site URL. Configure its
webhook URL as:

```text
https://your-domain.example/api/paystack/webhook
```

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
a production GO. The cPanel-only build deliberately uses webpack because the
deployment installs Linux-native Prisma, Argon2, and Sharp packages after the
archive is extracted; Turbopack's hashed external package aliases cannot be
recreated by `npm ci`. The normal `npm run build` command remains unchanged.

## 3. Create a versioned release on cPanel

Keep releases immutable so rollback means selecting the previous archive, not
editing production files in place. Replace `CPANEL_USER` and `<git-sha>` below:

```bash
mkdir -p /home/CPANEL_USER/watplux/releases/<git-sha>
unzip watplux-cpanel-<git-sha>.zip -d /home/CPANEL_USER/watplux/releases/<git-sha>
cd /home/CPANEL_USER/watplux/releases/<git-sha>
npm ci --include=dev
```

The install generates the Linux Prisma client and automatically links Prisma,
Argon2, and Sharp from cPanel's application dependency directory into the
packaged standalone runtime. If dependencies were installed with lifecycle
scripts disabled, run `npm run prepare:cpanel:runtime` before preflight.

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

The cPanel-side install is intentional. Sharp, Argon2, and Prisma contain
native/platform-specific code and must be installed/generated on cPanel's
Linux runtime. Do not run `npm run build` on cPanel; the production build is
already in `runtime/`.

Create `/home/CPANEL_USER/watplux/shared/.env.production` from the packaged
`.env.production.example`, fill every placeholder, set permission `600`, then
link it into the release:

```bash
ln -s /home/CPANEL_USER/watplux/shared/.env.production .env.production
chmod 600 /home/CPANEL_USER/watplux/shared/.env.production
```

Generate independent secrets with `openssl rand -base64 48`. Do not reuse the
Better Auth, guest-order, and internal-worker secrets.

## 4. Validate and migrate before rollout

Load the private runtime configuration in the terminal, run preflight, and run
Prisma migrations exactly once before switching traffic:

```bash
set -a
source .env.production
set +a
npm run ops:preflight:cpanel
npm run db:migrate:deploy
```

On the first deployment only, bootstrap structural RBAC data and the initial
owner account:

```bash
npm run db:seed
```

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

## 6. Schedule webhook processing

The web process does not run migrations or background loops. Add a once-per-
minute cPanel cron job that loads the private environment and invokes the
authenticated worker endpoint:

```bash
/bin/bash -lc 'cd /home/CPANEL_USER/watplux/current && set -a && source .env.production && set +a && APP_INTERNAL_URL=https://your-domain.example ./scripts/trigger-webhook-worker.sh'
```

Keep the cron output in a protected log or direct failures to the hosting
provider's monitoring. Never place `INTERNAL_WORKER_SECRET` directly in the
crontab command.

## 7. Verify production

Check these endpoints in order:

```text
https://your-domain.example/api/live
https://your-domain.example/api/ready
https://your-domain.example/
https://your-domain.example/login
https://your-domain.example/admin
```

Then verify registration/login, owner RBAC, product browsing, an approved
Paystack test/live checkout, media upload, avatar upload, and one authenticated
webhook-worker run. Confirm `/api/ready` is healthy before accepting traffic.

## Later releases and rollback

1. Confirm database backup/PITR and S3 versioning.
2. Upload and extract the new SHA-named archive into a new release directory.
3. Run `npm ci --include=dev`, preflight, and the new release's migrations.
4. Switch `current` to the new directory and restart the cPanel app.
5. Run the verification checklist and monitor logs.

For an application regression, point `current` back to the previous immutable
release directory and restart. Do not run down migrations or any destructive
Prisma reset operation. If a migration is not backward-compatible, follow the
database restore procedure in
`docs/operations/INCIDENT_ROLLBACK_RUNBOOK.md` before switching application
versions.
