# Five-Member Implementation Plan

This document divides the work in `implementation.md` among five team members. It assigns every service and shared platform responsibility to a primary owner while identifying the interfaces that require coordination.

The code now lives in five member-owned folders. Start with [README.md](README.md), follow [CONTRIBUTING.md](CONTRIBUTING.md), and consult [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for implemented local behavior and remaining original-plan work.

## Ownership Summary

| Member | Primary area | Owned services and components |
|---|---|---|
| Member 1 | Platform, security, delivery and operations | Kubernetes, IaC, Kong, Istio, Vault, messaging, data platforms, observability, CI/CD and DR |
| Member 2 | Profiles, watchlists and recommendations | `profile`, `watchlist`, `reco-engine`, `reco-api` |
| Member 3 | Catalog and content authorization | `catalog-write`, `catalog-read`, Debezium CDC and catalog cache |
| Member 4 | Billing and financial workflows | `subscription`, `payment`, `invoice` |
| Member 5 | Playback and viewing history | `playback-session`, `watch-history`, Redis sessions, Cassandra history and CDN authorization |

Every member also owns the container image, deployment manifests, tests, dashboards, alerts, runbook, migrations and recovery instructions for their services.

---

## Member 1 — Platform, Security, CI/CD and Operations

### Primary responsibility

Build and operate the shared platform on which all domain services run. Coordinate Phases 0–2 and the shared qualification and release work in Phases 8–9.

### Implementation checklist

#### Repository and engineering foundations

- [ ] Create the monorepo and protected deployment-repository structure.
- [ ] Register independent build and test targets for all eleven services.
- [ ] Configure CODEOWNERS, protected branches and required reviews.
- [ ] Add dependency lockfiles, secret scanning and synthetic fixture generation.
- [ ] Build slice-based local development workflows.
- [ ] Provide MongoDB transaction and Redis Cluster development profiles.
- [ ] Maintain the ADR register, compatibility matrix and service ownership list.
- [ ] Pin runtime, operator, chart, image and SDK versions.

#### Cloud and Kubernetes platform

- [ ] Provision networking, private subnets, worker pools and control planes through IaC.
- [ ] Create integration, staging, qualification, production and DR environments.
- [ ] Configure storage classes, workload identity, KMS, registry, DNS and object storage.
- [ ] Install CNI, network policies, CSI, metrics, Gateway API and certificate management.
- [ ] Install and configure Kong Gateway and Istio.
- [ ] Enforce encrypted ingress and service-to-service communication.
- [ ] Apply default-deny policies, resource quotas and restricted pod policies.
- [ ] Validate operation across at least three real hosts or failure domains.

#### Secrets, identity and shared infrastructure

- [ ] Deploy Vault with KMS auto-unseal and audit logging.
- [ ] Deploy External Secrets Operator with a dedicated identity.
- [ ] Implement dynamic credential renewal where required.
- [ ] Deploy Keycloak with external HA PostgreSQL.
- [ ] Install PostgreSQL, MySQL, MongoDB, Cassandra and Neo4j.
- [ ] Install isolated Redis session and Redis cache clusters.
- [ ] Install Kafka, Schema Registry and Kafka Connect with rack-aware replication.
- [ ] Install RabbitMQ quorum queues, confirms, DLQs and unroutable-message handling.
- [ ] Create service-scoped database and broker identities.
- [ ] Add negative-access tests proving that services cannot read another service's data.

#### Contracts and shared service standards

- [ ] Establish OpenAPI, protobuf, event-schema and command-contract validation.
- [ ] Define common authentication and PCT verification behavior.
- [ ] Define RFC 9457 errors, timestamps, money representation and CloudEvents encoding.
- [ ] Provide W3C trace-propagation conventions.
- [ ] Establish deadline propagation, bounded retries, circuit breakers and concurrency limits.
- [ ] Provide common health, readiness, graceful-shutdown and configuration standards.
- [ ] Maintain the authorization matrix and contract compatibility checks.
- [ ] Ensure breaking contract changes fail CI.

#### Observability and delivery

- [ ] Deploy Prometheus, Alertmanager, Grafana, Loki, OpenTelemetry and Jaeger.
- [ ] Provide baseline dashboards, SLOs and alert-routing configuration.
- [ ] Configure Argo CD and environment-separated GitOps deployments.
- [ ] Build CI pipelines for compile, test, contract checks and security scans.
- [ ] Produce SBOMs, provenance and signed immutable images.
- [ ] Promote identical image digests between environments.
- [ ] Implement canary deployment, automatic stop and compatible rollback mechanisms.

#### Recovery and production readiness

- [ ] Automate backups for every stateful platform component.
- [ ] Perform sample restores before domain development depends on the platform.
- [ ] Build the warm-standby DR environment.
- [ ] Implement primary-region fencing and controlled DR promotion.
- [ ] Coordinate performance, chaos, security and three-zone qualification tests.
- [ ] Coordinate the regional failover and failback rehearsal.
- [ ] Publish operational access, escalation, maintenance and backup procedures.

### Required deliverables

- IaC modules and environment definitions.
- Platform and GitOps manifests.
- CI/CD pipelines and release-manifest tooling.
- Permission and network-flow matrices.
- Shared dashboards, alerts and platform runbooks.
- Backup, restore and regional recovery evidence.

### Completion criteria

- A cross-host request travels through the gateway, service mesh and database with trace continuity.
- Unauthorized workloads cannot connect to protected services or databases.
- Traffic and stored data are encrypted.
- A host failure preserves required service and data quorums.
- Signed images deploy reproducibly through GitOps.
- Sample restores and the regional recovery drill meet the accepted RPO/RTO.

---

## Member 2 — Profiles, Watchlists and Recommendations

### Primary responsibility

Implement account/profile behavior, profile-owned collections and the complete recommendation pipeline. Own the privacy workflow from profile deletion through recommendation-data suppression.

### Profile service

- [ ] Create MongoDB account, profile, lifecycle and outbox collections.
- [ ] Add validators, normalized names, versions and unique indexes.
- [ ] Enforce the maximum-five-profiles rule under concurrent requests.
- [ ] Implement create, read, update, select and delete profile endpoints.
- [ ] Derive account identity from the verified access-token subject.
- [ ] Enforce account and profile ownership on every endpoint.
- [ ] Implement idempotent account bootstrap.
- [ ] Issue short-lived Profile Context Tokens after ownership verification.
- [ ] Include account, profile, maturity and policy version in the PCT.
- [ ] Publish an internal JWKS and support signing-key rotation with overlap.
- [ ] Enforce access-token and PCT subject equality.
- [ ] Implement parental controls and maturity-elevation protection.
- [ ] Publish profile lifecycle events transactionally through an outbox.
- [ ] Start durable account/profile deletion workflows.
- [ ] Integrate narrowly scoped Keycloak session revocation.
- [ ] Provide the authentication and profile-selection smoke-test client.

### Watchlist service

- [ ] Implement add, remove, list and membership operations.
- [ ] Derive the owner from the authenticated profile instead of request-supplied IDs.
- [ ] Enforce a unique `(profileId, titleId)` constraint.
- [ ] Implement cursor pagination.
- [ ] Validate titles through Member 3's deadline-bounded Catalog gRPC interface.
- [ ] Return a controlled `503` response when Catalog validation is unavailable.
- [ ] Define and test primary or causal read-your-writes behavior.
- [ ] Consume deletion events idempotently.

### Recommendation Engine

- [ ] Create Neo4j graph constraints, indexes and bounded-query policies.
- [ ] Create separate graph-writer and read-only API roles.
- [ ] Ingest versioned Catalog snapshots and events.
- [ ] Ingest `WatchRecorded` events with transactionally coupled deduplication.
- [ ] Prevent duplicate events from increasing watch counts more than once.
- [ ] Apply lifecycle deletions and replay-suppression tombstones.
- [ ] Implement bounded content-similarity scoring.
- [ ] Implement collaborative recommendation signals.
- [ ] Implement regional popularity and trending calculations.
- [ ] Add deterministic fixtures and explainable recommendation reasons.
- [ ] Implement durable, fenced recomputation jobs.
- [ ] Write versioned results and atomically switch the active recommendation run.
- [ ] Prevent overlapping scheduled jobs from exhausting graph capacity.
- [ ] Build a graph rebuild using authoritative Catalog and History exports.

### Recommendation API

- [ ] Implement home, similar and trending endpoints.
- [ ] Fetch metadata from Catalog in bounded batches.
- [ ] Enforce region, maturity and current content rights in all responses.
- [ ] Implement Redis recommendation caching.
- [ ] Fall back to Redis when Neo4j is unavailable.
- [ ] Fall back to a verified recent local snapshot when Redis is unavailable.
- [ ] Return an empty degraded response when eligibility cannot be verified.
- [ ] Expose recommendation generation and freshness timestamps.
- [ ] Add metrics for personalized, fallback and empty-degraded cohorts.

### Required coordination

- Define PCT validation requirements with Member 1.
- Consume Catalog events and eligibility metadata from Member 3.
- Consume `WatchRecorded` events from Member 5.
- Publish deletion contracts consumed by Members 3–5.

### Required deliverables

- `profile`, `watchlist`, `reco-engine` and `reco-api` services.
- MongoDB and Neo4j migrations/bootstrap definitions.
- Profile, PCT, lifecycle and recommendation contracts.
- Recommendation fixtures, rebuild tools and deletion-replay tests.
- Service dashboards, alerts and runbooks.

### Completion criteria

- Accounts cannot access or select another account's profiles.
- The five-profile limit remains correct under concurrency.
- Expired, forged or mismatched PCTs are rejected.
- Watchlist ownership and Catalog-outage behavior pass.
- Duplicate history events do not inflate recommendation scores.
- Deleted profiles cannot be recreated by event replay or restore.
- Recommendation fallbacks never expose ineligible content.

---

## Member 3 — Catalog and Content Authorization

### Primary responsibility

Implement the authoritative content domain, its read projection, search, CDC pipeline and the content-authorization decision required before playback.

### Catalog Write service

- [ ] Create PostgreSQL migrations for titles, seasons, episodes, people and genres.
- [ ] Model publication, archive state, versions and asset mappings.
- [ ] Add regional licensing constraints using `[start, end)` UTC boundaries.
- [ ] Enforce valid season/episode and asset relationships.
- [ ] Add transactional outbox tables and indexes.
- [ ] Implement administrator create and full-read operations.
- [ ] Implement optimistic updates using ETags.
- [ ] Implement publish, unpublish and archive operations.
- [ ] Implement season, episode, person, genre, rights and asset operations.
- [ ] Implement bounded republish jobs.
- [ ] Enforce administrator role, MFA and durable audit requirements.
- [ ] Implement the authoritative `AuthorizePlayback` gRPC method.
- [ ] Validate publication, regional rights, maturity, asset membership and episode membership.
- [ ] Return `allowedUntil`, permitted quality and the authorized asset path.
- [ ] Fail closed when authoritative content authorization is unavailable.

### Catalog CDC

- [ ] Configure a narrow PostgreSQL publication and replication identity.
- [ ] Configure Debezium outbox field and topic mappings.
- [ ] Produce the required CloudEvents envelope explicitly.
- [ ] Retain captured outbox rows for the approved diagnostic/recovery period.
- [ ] Monitor connector lag and PostgreSQL WAL growth.
- [ ] Test connector restart, duplicate capture, slot recreation and primary failover.

### Catalog Read service

- [ ] Create separate projection-writer and read-only database roles/pools.
- [ ] Consume the compacted Catalog topic.
- [ ] Apply title and availability changes transactionally by aggregate version.
- [ ] Preserve deletion versions so old events cannot resurrect content.
- [ ] Create GIN/trigram search indexes.
- [ ] Implement browse, detail, episode, genre and search REST endpoints.
- [ ] Implement cursor pagination.
- [ ] Implement `TitleExists`, `GetTitle` and `BatchGetTitles` gRPC methods.
- [ ] Enforce trusted region and PCT maturity filtering.
- [ ] Cache metadata or safely filtered responses in Redis.
- [ ] Clamp cache lifetime to the next licensing boundary.
- [ ] Fall back to a bounded PostgreSQL pool when Redis is unavailable.

### Projection recovery

- [ ] Export an authoritative snapshot including deletion state.
- [ ] Record a matching change-stream watermark.
- [ ] Rebuild into a new projection.
- [ ] Replay remaining events from the watermark.
- [ ] Compare checksums and counts before activation.
- [ ] Atomically switch readers to the rebuilt projection.

### Required coordination

- Define JWT/PCT, error and trace behavior with Member 1.
- Provide Watchlist title validation and recommendation metadata to Member 2.
- Provide `AuthorizePlayback` to Member 5.
- Include Member 5 in reviews of playback-authorization contract changes.

### Required deliverables

- `catalog-write` and `catalog-read` services.
- PostgreSQL migrations and Debezium configuration.
- Catalog REST, gRPC and event contracts.
- Catalog cache and projection-rebuild tooling.
- Authorization, CDC, failover, freshness and search evidence.
- Service dashboards, alerts and runbooks.

### Completion criteria

- An administrator mutation reaches browse and search within the accepted freshness budget.
- Conflicting ETags fail without overwriting newer data.
- Draft, expired, wrong-region or over-maturity titles cannot be authorized.
- Duplicate and older events cannot regress or resurrect Catalog data.
- Redis loss does not expose unauthorized content or overload the database.
- Connector failover and a complete projection rebuild succeed.

---

## Member 4 — Subscription, Payment and Invoice

### Primary responsibility

Implement the complete billing workflow, including subscription state, payment-provider integration, reconciliation, compensation and invoice generation.

### Database and financial foundations

- [ ] Create separate MySQL schemas and scoped users for each billing service.
- [ ] Create plans, subscriptions, history and entitlement tables.
- [ ] Create saga, inbox, outbox and idempotency tables.
- [ ] Create payment-attempt, provider-event, customer and refund tables.
- [ ] Create invoice, invoice-line, sequence and PDF-job tables.
- [ ] Define the generated `active_flag` needed for one live subscription.
- [ ] Add reconciliation and dunning job tables.

### Subscription service

- [ ] Implement plan listing.
- [ ] Implement subscribe, current, history and entitlement operations.
- [ ] Implement upgrade, downgrade and cancellation behavior.
- [ ] Derive prices and currency from server-controlled plan snapshots.
- [ ] Scope idempotency to account and operation.
- [ ] Reject idempotency-key reuse with a different request body.
- [ ] Implement persisted, versioned saga transitions.
- [ ] Atomically store state changes and outgoing obligations.
- [ ] Implement leased timeout processing.
- [ ] Keep existing plans active during pending upgrades when required.
- [ ] Publish monotonic entitlement-change events.

### Payment service

- [ ] Implement hosted payment-method setup sessions.
- [ ] Implement token-reference listing and removal.
- [ ] Bind payment methods to the correct account/provider customer.
- [ ] Implement charge, lookup and refund operations.
- [ ] Persist a stable operation ID before provider calls.
- [ ] Implement the signed webhook endpoint.
- [ ] Deduplicate provider events and payment-state transitions.
- [ ] Prevent out-of-order callbacks from downgrading successful payments.
- [ ] Represent ambiguous provider outcomes as `UNKNOWN` or `RECONCILING`.
- [ ] Reconcile ambiguous states through lookup and verified webhooks.
- [ ] Refund idempotently when a late success arrives after cancellation.
- [ ] Create separate durable RabbitMQ and Kafka delivery obligations.
- [ ] Ensure delivery to one destination cannot complete the other obligation.

### Invoice service

- [ ] Consume successful payment and refund events.
- [ ] Snapshot immutable financial details.
- [ ] Create exactly one invoice per qualifying payment.
- [ ] Generate credit/refund documents where required.
- [ ] Serialize invoice numbering according to the approved accounting rules.
- [ ] Persist PDF-generation work in the same transaction.
- [ ] Render and upload PDFs idempotently to private object storage.
- [ ] Keep invoice jobs pending or failed for retry without reversing subscriptions.

### Renewals, support and reconciliation

- [ ] Implement clustered renewal scheduling.
- [ ] Enforce unique `(subscriptionId, period)` billing obligations.
- [ ] Reuse the same payment ID when a scheduler execution repeats.
- [ ] Implement the approved dunning schedule and final-state behavior.
- [ ] Restrict support lookup and refund operations with step-up authorization.
- [ ] Audit every support and refund operation.
- [ ] Produce reconciliation reports through service-owned APIs or exports.
- [ ] Identify charged-but-inactive and refunded-but-active discrepancies.
- [ ] Minimize retained personal identity while preserving required financial records.

### Required coordination

- Define gateway, support-route and webhook policies with Member 1.
- Publish entitlement gRPC and subscription events for Member 5.
- Consume account-deletion events from Member 2.
- Coordinate invoice object storage and encryption with Member 1.

### Required deliverables

- `subscription`, `payment` and `invoice` services.
- MySQL migrations and financial state-machine documentation.
- RabbitMQ command and Kafka business-event contracts.
- Payment sandbox adapter and webhook verification.
- Reconciliation, refund and invoice-retry tools.
- Service dashboards, financial alerts and operator runbooks.

### Completion criteria

- Duplicate requests and messages cannot double-charge, double-refund or double-invoice.
- Provider timeout-after-charge and webhook-before-response scenarios converge correctly.
- Every uncertain transaction remains visible and recoverable.
- Invoice-generation failure does not reverse a valid subscription.
- Broker outages leave durable pending delivery obligations.
- Recovery reuses existing provider operation IDs.

---

## Member 5 — Playback and Durable Watch History

### Primary responsibility

Implement authorized playback, distributed session management, media delivery security and recoverable viewing history.

### Durability prototypes

- [ ] Prototype the Kafka playback lifecycle journal before full endpoint development.
- [ ] Test Redis crash and failover behavior at every acknowledgment boundary.
- [ ] Resolve the concurrent-stream behavior allowed during Redis partitions.
- [ ] Prototype Cassandra writes followed by Kafka transactional output/offset commit.
- [ ] Validate Go client transaction and producer-fencing support.
- [ ] Separate acknowledged-event durability from heartbeat sampling accuracy.

### Playback Session service

- [ ] Validate access JWTs and Profile Context Tokens.
- [ ] Check entitlement through Member 4's authoritative interface.
- [ ] Check content rights through Member 3's `AuthorizePlayback` method.
- [ ] Intersect plan quality, authorized renditions and device capability.
- [ ] Generate replay-safe admission IDs.
- [ ] Reserve concurrent-stream slots using same-slot Redis Lua operations.
- [ ] Complete the durable start record before returning a media URL.
- [ ] Implement session listing, heartbeat and explicit stop.
- [ ] Implement remote termination and URL refresh.
- [ ] Bind sessions to the correct account and profile.
- [ ] Enforce a separate authorization policy for account-level device management.
- [ ] Use monotonic heartbeat sequences.
- [ ] Reject stale duplicates, impossible positions and mismatched assets.
- [ ] Bound client-reported progress by trusted media duration.

### Durable finalization and entitlement cache

- [ ] Reconcile explicit stop, timeout and eviction through durable journal state.
- [ ] Use leases/fencing and immutable finalization IDs.
- [ ] Retain finalization payloads until broker acknowledgment and recovery expiry.
- [ ] Make finalization publication safely retryable.
- [ ] Apply monotonic subscription invalidation versions.
- [ ] Prevent slow, old entitlement responses from replacing newer cancellations.
- [ ] Distinguish cache validity, business validity and approved grace periods.
- [ ] Return `503` when entitlement authority is unavailable and no valid entry exists.
- [ ] Rebuild trustworthy admission state before reopening after destructive Redis loss.

### CDN and media authorization

- [ ] Restrict object-storage origin access to the CDN.
- [ ] Sign manifests and every segment/rendition path.
- [ ] Implement signed-cookie or token inheritance for relative segment URLs.
- [ ] Bind media paths and expiration to the authorization result.
- [ ] Clamp expiry to licensing and entitlement limits.
- [ ] Test direct-origin bypass.
- [ ] Test unauthorized higher-quality rendition access.
- [ ] Document URL revocation behavior for already-issued URLs.

### Watch History service

- [ ] Create Cassandra history tables with monthly buckets and TTLs.
- [ ] Use deterministic event and projection keys.
- [ ] Implement bounded continue-watching queries.
- [ ] Implement playback progress and history pagination.
- [ ] Implement hide and clear-history behavior.
- [ ] Use trusted event ordering and deterministic timestamp tie-breaking.
- [ ] Keep retry event times stable.
- [ ] Write every Cassandra projection before committing Kafka progress.
- [ ] Publish `WatchRecorded` and commit input offsets in a Kafka transaction.
- [ ] Use `read_committed` for transactional downstream consumers.
- [ ] Repair partially written projections during replay.
- [ ] Consume account/profile deletion events idempotently.
- [ ] Define and test the expected long-session behavior.

### Required coordination

- Use the platform's Kafka, Redis, Cassandra, identity and observability standards from Member 1.
- Use content authorization from Member 3.
- Use entitlement gRPC and subscription events from Member 4.
- Publish `WatchRecorded` for Member 2's Recommendation Engine.
- Consume profile/account deletion events from Member 2.

### Required deliverables

- `playback-session` and `watch-history` services.
- Redis Lua scripts and lifecycle-journal contracts.
- Cassandra migrations and history replay tools.
- CDN signing and origin-protection configuration.
- Fault-injection evidence for Redis, Kafka and Cassandra failures.
- Service dashboards, alerts and recovery runbooks.

### Completion criteria

- A session can start on one pod, heartbeat on another and stop on a third.
- Concurrent starts respect the approved admission policy.
- Every media path enforces content, region, maturity, quality and entitlement restrictions.
- Killing finalizers or losing Redis cannot silently lose acknowledged finalizations.
- Kafka/Cassandra failures recover through safe replay.
- History converges without regressing on older events.

---

## Cross-Team Contract Ownership

| Contract or dependency | Producer/owner | Consumers/reviewers |
|---|---|---|
| Access-token, PCT and shared authorization rules | Members 1 and 2 | Members 3, 4 and 5 |
| Profile lifecycle and deletion events | Member 2 | Members 3, 4 and 5 |
| Catalog event stream | Member 3 | Member 2 |
| Catalog metadata/query gRPC | Member 3 | Member 2 |
| `AuthorizePlayback` gRPC | Member 3 | Member 5 |
| Entitlement gRPC | Member 4 | Member 5 |
| Subscription/entitlement events | Member 4 | Member 5 |
| `WatchRecorded` event | Member 5 | Member 2 |
| Shared platform, deployment and telemetry standards | Member 1 | All members |

Both the producer and every affected consumer must review an interface before it is merged. Released event schemas must not be changed in place.

## Execution Sequence

### Stage 1 — Foundations

- Member 1 establishes repositories, environments, platform components, CI and contract validation.
- Members 2–5 define their APIs, events, commands, data models and service skeletons.
- All members review the shared authentication, error, telemetry and resilience conventions.

### Stage 2 — Identity and independent domain development

- Member 2 completes authentication integration, profiles and PCT selection.
- Member 3 develops Catalog Write, CDC and Catalog Read.
- Member 4 develops Billing against the payment sandbox.
- Member 5 runs playback durability prototypes.
- Member 2 begins recommendation development with synthetic fixtures.

### Stage 3 — Domain integration

- Member 2 connects Watchlist and Recommendations to Catalog.
- Member 5 connects Playback to Catalog authorization and Billing entitlement.
- Member 5 publishes real history events to Recommendations.
- All members connect deletion consumers to Member 2's lifecycle workflow.

### Stage 4 — Qualification

All members jointly test the complete journey:

1. Sign in.
2. Select a profile.
3. Browse and search.
4. Add to the watchlist.
5. Add a payment method and subscribe.
6. Start, heartbeat and stop playback.
7. View history and recommendations.
8. Generate an invoice.
9. Cancel and delete the account.

The team must also execute authorization attacks, duplicate delivery, dependency failure, cold-cache, peak-load, soak, secret-rotation and three-zone failure scenarios.

### Stage 5 — Production release

- Member 1 coordinates DR rehearsal, release manifests, canaries and handover.
- Every member proves backup/rebuild/replay behavior for their data and services.
- Every member supplies actionable dashboards, alerts and runbooks.
- Production expands through controlled cohorts only after stop conditions are active.

## Definition of Done for Every Member

An implementation item is complete only when it includes:

- [ ] Reviewed API, event or command contract.
- [ ] Executable storage migration or bootstrap definition.
- [ ] Positive and negative authorization tests.
- [ ] Unit, integration and relevant fault-injection tests.
- [ ] Idempotency and duplicate-delivery handling.
- [ ] Bounded timeouts, retries and overload behavior.
- [ ] Structured logs, metrics and distributed traces.
- [ ] Dashboard and actionable alerts.
- [ ] Immutable container image and deployment manifests.
- [ ] Compatible rollout and rollback instructions.
- [ ] Backup, rebuild, reconciliation or replay procedure.
- [ ] Service runbook and acceptance evidence.

## Workload Note

This is a large production system for a five-person team. Work should follow the dependency stages rather than attempting all phases simultaneously. Phases 8 and 9 are shared team responsibilities even though Member 1 coordinates them; security, performance, recovery and operational ownership remain part of every member's deliverables.
