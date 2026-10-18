# Engineering decisions

Format: **Context → Options → Choice → Trade-off**

## 1. Postgres + one transaction for item / activity / outbox

**Context:** Every successful work-item mutation must leave history and async side-effects consistent with the row.

**Options:** Mongo / document store; write history in a separate call after commit; single Postgres transaction including outbox rows.

**Choice:** PostgreSQL with Prisma `$transaction`: update item, append activity, insert outbox job(s) together.

**Trade-off:** Coupled to relational constraints and migrations; gain atomicity and a simple ops story (no dual-write).

## 2. Optimistic `version` + conditional claim

**Context:** Two agents may claim or edit the same item under load.

**Options:** `SELECT FOR UPDATE` pessimistic locks; last-write-wins; optimistic version column + conditional `UPDATE … WHERE`.

**Choice:** Integer `version` on every mutating success path; claim uses `WHERE assigneeId IS NULL` (and status checks). Mismatch → `409` with current payload.

**Trade-off:** Clients must send `version` and handle reload; no silent overwrites.

## 3. Per-team roles and one `can()` gate

**Context:** Same user can be Lead on Payments and Viewer on Support; foreign teams must not leak.

**Options:** Roles in JWT; check roles inline in each route; central `can(ctx, action, item)` + SQL scoped to memberships.

**Choice:** JWT carries identity only; memberships loaded each request; `can()` for all decisions; other team → **404**, wrong role → **403**; UI renders `allowedActions` / `allowedTransitions` from the server.

**Trade-off:** Extra DB read per request; role changes apply immediately without re-login.

## 4. Transactional outbox (not Redis/Bull)

**Context:** Need assignee / approval notifications that survive API crashes and support retries.

**Options:** Sync notify in the request; Redis/BullMQ; Postgres outbox + worker with `SKIP LOCKED`.

**Choice:** Outbox rows in the same transaction as the mutation; worker polls with lock timeout, backoff, max attempts; handler inserts notifications with `dedupeKey` so double-processing is safe.

**Trade-off:** At-least-once delivery; no separate queue infra for the reviewer to install.

## 5. Cursor pagination and targeted indexes

**Context:** Seed/demo scale is thousands of items with growing activity; lists must stay bounded.

**Options:** Offset pagination; search engine; keyset cursor on `(createdAt, id)` plus status/priority/trigram indexes.

**Choice:** Cursor pagination (default 20, max 100); `createdAt DESC, id DESC`; trigram on title; partial indexes for common queue views. Documented in `docs/PERFORMANCE.md`.

**Trade-off:** One sort order; jumping to arbitrary pages is harder than offset.

## 6. Frontend: TanStack Query + URL filters

**Context:** Dashboard must refetch safely; claim races need optimistic UI without inventing authz on the client.

**Options:** Redux; websockets; fully optimistic everything.

**Choice:** TanStack Query for server state; filters in the URL; optimistic update **only** for claim (rollback on 409); ~15s poll for list/summary/notifications; mutations disabled while one is in flight on the detail page.

**Trade-off:** Slightly stale lists between polls; simpler and easier to demo than realtime infra.

---

## Assumptions

- Seeded users are enough (no self-registration).
- Teams are fixed for the demo; items are not moved between teams.
- `PAYMENT` and `COMPLIANCE` always require Lead approval; other types may resolve from `IN_PROGRESS`.
- Self-approval is forbidden even for Leads/Admins who are the assignee.
- Demo JWT secret and passwords are acceptable for local/reviewer use only.

## Risks (and mitigations)

| Risk | Mitigation |
|---|---|
| Double claim | Conditional update + integration test ×20 |
| Duplicate POSTs | Required `Idempotency-Key` + stored response |
| Authz bugs | Single `can()` + outsider 404 tests |
| Lost notifications | Outbox in same txn + retries + dedupe |
| Stale UI edits | Version precondition + conflict banner |

## What I chose not to build

- Sign-up, SSO, email delivery, file attachments
- Websockets / SSE
- Admin UI for outbox (API endpoints exist)
- Rate limiting, multi-sort, full-text search service
- Mobile app / fancy marketing UI
