# Jobs

Entry points for scheduled/background work — invoked by cron for MVP, per
`docs/ARCHITECTURE.md` §15. The first real job, `process-webhook-events.ts`
(the async Paystack-webhook worker described in §6.3), is built in Phase 9
alongside the payment/webhook entities it operates on.

Empty in Phase 1 — no business processing exists yet to schedule.
