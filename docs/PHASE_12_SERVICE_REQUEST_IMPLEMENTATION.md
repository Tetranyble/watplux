# Phase 12 — Consultation & Installation Workflow

**Status: implementation written; runtime verification pending the same package-registry blocker documented in Phase 11.**

## 1. Objective

Turn the already-existing `ServiceRequest` schema into a real customer and
operations workflow without adding a migration, inventing another permission, or
building fake notification infrastructure.

## 2. Database impact

Zero schema changes and zero migrations. The existing `ServiceRequest`,
`ServiceType`, `ServiceRequestStatus` and `PropertyType` definitions were sufficient.

## 3. Module added

`src/modules/service-request/` now owns:

- Zod input contracts;
- DTO mapping;
- keyset/cursor listing;
- customer/guest creation;
- customer ownership reads;
- admin reads gated by `consultations.read`;
- assignment gated by `consultations.update`;
- explicit guarded status transitions;
- audit records for assignment and status changes.

## 4. State machine

```text
NEW -> CONTACTED -> SCHEDULED -> IN_PROGRESS -> COMPLETED
 |        |            |             |
 +------> CANCELLED <---+-------------+
```

`COMPLETED` and `CANCELLED` are terminal. The repository uses a guarded
`updateMany({ id, status: fromStatus })` for status changes so two operators cannot
silently overwrite each other's state transition.

No generic arbitrary `PATCH status` semantics exist at the domain layer; the target
status must be a valid named state-machine transition.

## 5. Customer experience

`/consultation` and `/installation` are no longer mailto/tel placeholders. They now
contain structured service-request forms that work for both guests and signed-in
customers.

Guest submissions require name, email and phone. Signed-in submissions are linked
to the authenticated user and do not duplicate identity fields into guest columns.

Signed-in customers also receive:

- `/account/service-requests`
- `/account/service-requests/[requestId]`

These reads are ownership-scoped unless the caller carries the existing elevated
consultation read permission.

## 6. Admin experience

The admin navigation now exposes **Services** to actors with `consultations.read`.

Added:

- `/admin/service-requests`
- `/admin/service-requests/[requestId]`

Operators can filter the queue, inspect the submitted assessment data, claim a
request themselves, unassign it, and move it through the explicit status workflow.

The UI never becomes the authorization boundary; every read/mutation re-checks the
existing consultation permissions in the use-case.

## 7. Assignment safety

The general assignment use-case verifies that an assignee is active and actually
has `consultations.update`. The initial admin UX deliberately offers "Assign to me"
rather than requiring a new staff-directory capability or trusting arbitrary IDs
from a browser form.

## 8. API surface

- `POST /api/service-requests`
- `GET /api/account/service-requests`
- `GET /api/admin/service-requests`
- `GET /api/admin/service-requests/[requestId]`
- `PATCH /api/admin/service-requests/[requestId]`

The admin detail route is explicitly permission-gated through the admin read
use-case; customer ownership does not accidentally grant access to the admin API
namespace.

## 9. Tests added

- unit coverage for allowed, cancelled and invalid state-machine transitions;
- integration coverage for authenticated creation, guest identity requirements,
  ownership/IDOR, staff read access, self-assignment, progression and authorization.

No test result is claimed until the dependency/runtime blocker is removed.

## 10. Intentionally deferred

- outbound email/SMS/WhatsApp notifications;
- calendar-provider integration;
- field engineer scheduling resources;
- quotation generation;
- CRM behavior;
- arbitrary customer cancellation semantics;
- attachment uploads.

Those are separate capabilities, not prerequisites for a clean initial service-request workflow.
