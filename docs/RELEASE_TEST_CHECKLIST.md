# Watplux Release Test Checklist

A release candidate is not deployable merely because `next build` succeeds.

## Automated gate

- [ ] `npm run db:generate`
- [ ] `npx prisma migrate deploy` against a disposable release-test database
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run format:check`
- [ ] `npm test`
- [ ] `npm run test:integration`
- [ ] `npm run test:e2e:api`
- [ ] `npm run test:e2e:browser`
- [ ] `npm run build`

## Browser/manual gate

- [ ] Keyboard-only: header/mobile nav, product purchase, cart, checkout, login/register, admin navigation
- [ ] Visible focus never disappears behind sticky headers/sheets
- [ ] 200% browser zoom and narrow reflow do not cause horizontal scrolling
- [ ] Screen reader: checkout labels/errors/status announcements
- [ ] Screen reader: account order and admin dashboard headings/landmarks
- [ ] Light and dark themes checked at desktop + mobile sizes
- [ ] Product images preserve equipment detail without harmful cropping
- [ ] Empty/loading/error/not-found states reviewed on customer routes
- [ ] Admin permission-denied/direct-URL behavior reviewed in browser
- [ ] Paystack test-mode success, abandoned, retry, webhook-delay and duplicate-webhook journeys exercised
- [ ] Inventory concurrency/reversal behavior observed against test orders

## Evidence retained

- [ ] CI Playwright HTML report
- [ ] failure trace/video/screenshots if any test failed before final green run
- [ ] mobile responsive screenshots from Playwright attachments
- [ ] release commit SHA and migration set recorded
- [ ] unresolved defects have owner/severity/release decision
