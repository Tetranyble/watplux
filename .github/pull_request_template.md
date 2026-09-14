## What changed

Describe the user/business behavior and architectural impact.

## Verification

- [ ] `npm run audit:lockfile`
- [ ] `npm run audit:ui`
- [ ] `npm run audit:release`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run format:check`
- [ ] Unit/integration tests relevant to this change pass
- [ ] Browser journey updated/verified when user-facing behavior changed

## Architecture checklist

- [ ] Better Auth remains the only authentication/session owner
- [ ] Server-side RBAC remains the authorization boundary
- [ ] Domain mutations still go through use-cases/repositories
- [ ] No historical migration was rewritten
- [ ] Payment/order/inventory/refund state machines were not bypassed
- [ ] UI follows `docs/UI_FORM_SYSTEM.md`

## Deployment/data impact

Describe migrations, environment variables, operational steps, or state `None`.
