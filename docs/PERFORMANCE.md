# Performance notes

## Access patterns

- Dashboard list: filter by team membership + optional view (`mine`, `unassigned_urgent`, `awaiting_my_approval`, `overdue`, `stale`) + status/priority/type/team/q.
- Detail: single item by id + recent activity (capped).
- Summary tiles: counts for urgent unassigned, awaiting approval, overdue, open.

## Pagination

- Keyset cursor on `(createdAt DESC, id DESC)`.
- Default `limit=20`, max `100`.
- No unbounded list endpoints.

## Indexes (see Prisma migration)

- Primary keys / FKs on users, teams, memberships, work items, activity, outbox, notifications, idempotency keys.
- Title search: GIN trigram on `WorkItem.title` (ILIKE-friendly; wildcards escaped in app code).
- Partial / supporting indexes for common queue predicates (status, priority, assignee, due date) as defined in `server/prisma/migrations/20261018100000_init/migration.sql`.
- Activity is append-only (trigger rejects UPDATE/DELETE) to keep history write path simple and auditable.

## Outbox worker

- `FOR UPDATE SKIP LOCKED` batching so multiple workers would not steal the same row.
- Lock timeout reclaims stuck `PROCESSING` jobs.
- Poll interval / batch size configurable via env (`OUTBOX_POLL_MS`, `OUTBOX_BATCH_SIZE`).

## What this does *not* claim

- No load-test numbers are shipped; the design targets “tens of thousands of items” with server-side filters and cursors rather than loading the full table into the browser.
- Single sort order keeps the cursor stable; adding arbitrary sorts would need matching indexes and cursor fields.

## Local tips

- Host Postgres port **5433** avoids clashing with a local Postgres on 5432.
- Tests use `newtonite_test` with a capped Prisma pool so parallel claim tests are meaningful.
