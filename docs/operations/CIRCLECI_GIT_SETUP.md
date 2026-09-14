# CircleCI + Git setup

Watplux ships with a CircleCI 2.1 pipeline in `.circleci/config.yml` and repository-local Git hooks in `.githooks/`.

## 1. Initialize Git

From the repository root:

```bash
./scripts/setup-git.sh
```

To configure the remote at the same time:

```bash
./scripts/setup-git.sh git@github.com:YOUR_ORG/YOUR_REPO.git
```

The setup script:

- initializes `main` when `.git` does not exist;
- uses `.githooks/` as the repository hook directory;
- configures fast-forward-only pulls;
- verifies `.env` is ignored;
- optionally creates/updates `origin`.

It deliberately does **not** invent Git author identity. Configure your own `user.name` and `user.email` before the first commit if Git does not already have them.

## 2. Repair and commit the lockfile first

The current release-candidate source gained dependencies after the last successful lockfile generation. Before the first CI run, use a networked development machine:

```bash
nvm use
npm install
npm run audit:lockfile
```

Review and commit the regenerated `package-lock.json`. CircleCI uses `npm ci` and intentionally refuses an unsynchronized lockfile.

## 3. Local verification before push

```bash
npm run audit:ui
npm run audit:release
npm run typecheck
npm run lint
npm run format:check
npm test
```

The pre-commit hook runs the fast structural audits. The pre-push hook runs typecheck/lint/format/unit tests. The full database/browser release gate remains CI's responsibility.

## 4. Connect the GitHub repository to CircleCI

Create/connect the repository in CircleCI using its GitHub integration. CircleCI detects `.circleci/config.yml` from the repository. The pipeline does not require production secrets: it uses isolated test-only credentials and a disposable MySQL 8 service container.

The `validate` workflow runs on branches and on `v*` tags. It executes:

1. exact Node version check (`.nvmrc`);
2. lockfile synchronization audit;
3. `npm ci` with npm-download cache;
4. Prisma client generation;
5. all migrations against disposable MySQL;
6. Chromium installation;
7. `npm run release:gate` (UI + architecture audits, typecheck, lint, formatting, unit tests, integration tests, Playwright API/browser/mobile journeys, and production build);
8. Playwright report/test-result artifact upload when present.

## 5. Recommended repository protection

Protect `main` in the Git host and require the CircleCI `validate / release_gate` check before merge. Disable force pushes and require pull requests for shared repositories.

For releases, create an annotated semantic-version tag only after `main` is green, for example:

```bash
git tag -a v0.1.0 -m "Watplux v0.1.0"
git push origin v0.1.0
```

Production image publishing/deployment remains governed by the Phase 17 release workflow/runbooks. CircleCI is configured as the verification gate and does not contain production credentials.

## CI troubleshooting

### Lockfile audit fails

Run `npm install` on Node 22.23.1, review `package-lock.json`, and commit it. Do not replace `npm ci` with `npm install` in CI to hide the mismatch.

### Browser job fails

Download `playwright-report` and `test-results` from the CircleCI job artifacts. Playwright retains traces/screenshots/video on failures according to `playwright.config.ts`.

### MySQL readiness fails

The CI job gives MySQL 60 seconds to accept TCP connections before Prisma migrations start. If it repeatedly fails, inspect the secondary `mysql:8.0` container logs in CircleCI rather than adding sleeps blindly.
