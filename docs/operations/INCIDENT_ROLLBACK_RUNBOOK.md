# Incident & Rollback Runbook

## Application regression

1. Stop further rollout.
2. Keep/restore the previous known-good immutable web image.
3. Do not run Prisma reset or edit migration history.
4. Check `/api/live`, `/api/ready`, worker health and recent payment/webhook errors.
5. Preserve logs and release metadata for diagnosis.

## Database migration incident

If the new application is faulty but the schema remains backward-compatible, roll back only the web image.

If a migration caused data corruption or a non-compatible schema:

1. stop or restrict writes;
2. preserve incident logs and current DB state when safe;
3. choose the last known-good managed snapshot/PITR point;
4. restore into a new instance first when the provider permits;
5. validate with Watplux readiness and smoke tests;
6. switch application connectivity only after validation.

Never use `prisma migrate reset` in production.

## Payment/worker incident

Do not delete webhook inbox records to "unstick" processing. Stop the scheduler if repeated processing is causing harm, retain durable events, fix/roll back application code, then resume the idempotent worker. Reconcile Paystack state before manually altering orders/payments.
