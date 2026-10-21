# Implementation status

Scope selected for this checkout: **local Docker development with a clearly marked payment sandbox**. The repository contains application code for eleven service roles in five member-owned folders. It is not a completed implementation of every production gate in `implementation.md`.

## Delivered local application code

| Owner | Implemented behavior |
|---|---|
| Member 1 | Service registry, versioned HTTP/OpenAPI 3.1 definitions and event envelope, streaming frontend and Markdown API documentation, key/identity bootstrap, Compose stack, Kong routes, topic initialization, ownership checks, CI/CODEOWNERS templates, end-to-end smoke test |
| Member 2 | Profile/account lifecycle, transactional profile limit/outbox, PCT signing/current-policy validation, Watchlist CRUD and dedupe, Neo4j ingestion and ranking, recommendation endpoints, eligibility-filtered fallback, internal recompute jobs |
| Member 3 | Title CRUD/publication/archive, ETags, licensing validation, authoritative playback checks, transactional outbox/Kafka relay, monotonic read projection, bounded browse/search/batch APIs |
| Member 4 | Plans, idempotent subscription requests, persistent billing command/result flow, local payment simulator, uncertain-outcome reconciliation, late-success refunds, entitlement, cancellation, invoice/credit records and sandbox PDFs |
| Member 5 | Session admission/list/heartbeat/stop/refresh, Redis account slots, Kafka lifecycle publication, retained retryable finalization, signed simple HLS paths, Cassandra history/progress, replay IDs and suppression markers |

## Explicit local substitutions

- The Member 1 frontend on port 8090 provides a responsive streaming UI: Discover/search/genre filters, title cards, My list, History/continue watching, account/profile selection, sandbox membership/invoices and a player dialog. Decorative original artwork substitutes for poster assets because the catalog has no poster-image fields. Native HLS depends on browser support; no HLS decoder is bundled. Checkpoints run every 25 seconds while native video plays, with manual checkpoints for external-player testing. The local Keycloak password grant and same-origin gateway proxy remain development shortcuts; tokens stay in memory. No titles/subscriptions are created automatically. Production identity, complete playback support and consumer qualification remain unfinished.
- API documentation lives in `member-1-platform/API_REFERENCE.md`, including all eleven services, public/private methods and paths, authentication, examples, health/framework endpoints and a test journey. The `/docs` webpage and explorer are removed. Optional machine-readable OpenAPI remains assembled in memory from authored definitions. Route-coverage tests do not establish runtime schema conformance or production qualification.

- Internal HTTP contracts replace the proposed generated gRPC transport for this increment.
- Catalog uses a polling transactional outbox relay rather than Debezium CDC.
- Local Keycloak runs in development mode; initial admin MFA/PIN and secure-device separation are unfinished.
- Local database/broker nodes are single instances, not replicated production topologies. MongoDB uses a one-node replica set for transactions. No cross-zone/region guarantees follow from this setup.
- MongoDB, Cassandra, Redis and Kafka run on the private Compose network without production workload-specific authentication. MySQL and PostgreSQL use separate instances per owning service. Neo4j Community does not provide the planned Enterprise role/topology configuration.
- A shared development service key substitutes for named workload identities. Production mesh mTLS and authorization are not implemented.
- Kafka consumer dedupe and retry support local replay, but the production Cassandra/Kafka offset transaction and transactional playback reducer are not implemented.
- Payment behavior is a local simulator with persisted provider-operation records. It never handles real cards or money.
- PDFs render on demand from immutable local invoice records; the original durable PDF/object-storage workflow is not complete.
- Media is served locally using signed URLs and simple HLS manifests. Real CDN, rendition/quality restrictions, DRM and DASH are not implemented.
- Tags/direct package versions are pinned development candidates; the complete supported-version/security compatibility review and image-digest promotion gate remain pending.

## Remaining work from the original plan

| Owner | Work still required |
|---|---|
| Member 1 | Production API/schema conformance, protobuf and full event-body contracts; finished consumer frontend/player; provider selection; IaC/Kubernetes; Vault/ESO; mesh and least-privilege datastore/broker ACLs; OTel/metrics/dashboards; SBOM/signing; GitOps/canaries; HA/load/chaos/security qualification; per-store backup/restore, DR and production handover |
| Member 2 | Account patch and subject export; parent PIN/reauthentication and mature-profile selection policy; key rotation; lifecycle acknowledgments/retries and restore-time erasure; cursor pagination; scheduled recompute fencing and transactional snapshot publication; graph export/rebuild; ranking freshness tests and collaborative tuning |
| Member 3 | Season/episode/person/genre/rights CRUD; immutable admin audits/MFA; Debezium; generated gRPC; regional asset/rendition membership; safe Redis caching; read replica pools; projection snapshot/rebuild/CDC-failover tooling; cursor pagination |
| Member 4 | Real provider and signed webhooks; saved-method/support-refund endpoints; upgrades/downgrades/proration; saga deadlines; renewals/dunning; robust operational reconciliation; legally approved invoice numbering/tax/retention; durable PDF jobs/private object storage; lifecycle erasure; append-only migration version runner |
| Member 5 | Production journal recovery/reducer/fencing; strict partition admission decision; start/stop/checkpoint race qualification; bounded maximum session lifetime; account-wide remote termination/revocation consumer; transactional history output/offset commit; deterministic equal-time progress tie breaking; history export/rebuild; complete privacy/retention qualification; real CDN/media rights and quality checks |

The local smoke test exercises a synthetic user journey and selected negative cases. It does not prove the production SLOs, 100,000-stream capacity, availability, recovery objectives, privacy completion or provider correctness.

## Merge-conflict controls

Five non-overlapping ownership folders, separate dependency manifests/locks, service-local migrations, a member-scope diff checker, contract ownership and CI templates reduce overlapping edits. Member 1 owns shared root files. Members 2–5 must not edit another member's folder.

This project is nested in a parent Git repository. No parent repository configuration or remote has been changed. CI/CODEOWNERS templates are inactive until installed at the actual repository root and assigned real GitHub users/teams. Branch protection must be configured on the host. No tooling can promise conflict-free merges when contributors bypass ownership or change interfaces incompatibly.

## Verification record

Build/test results and remaining environment limitations are recorded in `member-1-platform/VERIFICATION.md` after checks complete.

As of 2026-10-11, the streaming UI and Markdown API reference are delivered, Docker images build and containers start, and real frontend login/profile reads pass. The full live journey is blocked by billing SQL initialization and catalog store/proxy access failures. See [owner-specific integration blockers](member-1-platform/INTEGRATION_BLOCKERS.md); UI fixtures and passing unit tests do not establish a working live billing/playback journey.
