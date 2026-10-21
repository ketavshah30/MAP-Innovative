# Local integration blockers — 2026-10-11

The frontend and Markdown API reference are delivered. Docker images built and all Compose service containers started. A full live user journey has not passed. Browser interaction checks used isolated fixtures; these do not establish service integration.

## Member 4: billing startup

Subscription, Payment and Invoice repeatedly fail with `System.InvalidOperationException: CommandText must be specified` in `Billing.Store.Init()` (`member-4-billing/Store.cs:8`).

The migration ends with a semicolon followed by whitespace. Splitting with `RemoveEmptyEntries` retains a whitespace-only fragment; inspecting the actual migration found one such fragment. MySqlConnector rejects this as an empty command. The databases themselves became healthy.

Requested owner fix: trim each statement and exclude empty/whitespace fragments before execution. Verify startup against a real MySQL database, existing-schema restart, plans/subscriptions, payment convergence and invoice generation. Unit/build tests alone did not expose this initialization failure.

## Member 3: catalog store access

Catalog Write's scheduled relay repeatedly throws `NullPointerException` because `this.store.db` is null in `Relay.flush()` (`member-3-catalog/src/main/java/local/streaming/catalog/Catalog.java:102`). Both catalog dependency probes returned HTTP 401 after startup; the configured security chain permits `/health/**`, so this is not evidence that probe callers should supply a token. An error dispatch can mask the original exception behind authentication.

`Store` has transactional methods and is proxied by Spring. Other components directly access its `db`/`json` fields; direct field access bypasses proxy delegation. This is the inferred cause of the null field, based on the runtime exception and source. The same direct access appears in browse, readiness and projection code.

Requested owner fix: encapsulate database/JSON operations behind methods on the target bean (or inject needed dependencies directly into the caller), preserve transaction boundaries, and verify health, admin publish, relay/projection and eligible browse against real PostgreSQL/Kafka.

Member 1 has not changed either member's source or migrations. Coordinate fixes through owner-reviewed pull requests according to AGENTS.md. No claim of a completed end-to-end or production-qualified system follows from frontend tests.

## Recheck after owner fixes

```powershell
docker compose --env-file .local/dev.env -f member-1-platform/compose.yaml up --build -d
python member-1-platform/tests/smoke.py
```

Smoke changes synthetic local records and cancels alice's existing ACTIVE/PENDING subscriptions. Use only the local demo account. In the UI, Account → Connection details exposes dependency probes and the latest redacted response.
