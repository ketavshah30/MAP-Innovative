# Implementation Plan: Content Streaming and Recommendation Platform

| Field | Value |
|---|---|
| Document | `implementation.md` |
| Prepared | 2026-09-29 |
| Inputs | Supplied `plan.md` and `architecture.md`, architecture Baseline v1.0 |
| Purpose | Turn the existing architecture into incremental, testable engineering work |
| Status | Execution proposal; architecture amendments and business assumptions require resolution at their named gates |
| Audience | Engineering, platform/SRE, security, QA, product and technical leads |

This plan covers all **11 services**, their supporting infrastructure, multi-machine operation, and production release. A service running in a local container is an early development milestone; production completion requires the operational evidence in Phase 9.

The supplied architecture has sections 1–11. Its table of contents also lists sections 12–18, but their bodies are absent. This plan therefore supplies execution work for capacity, reliability, disaster recovery, observability, delivery, testing and decision tracking. References below to architecture sections refer only to supplied content. Proposed additions are explicitly identified; the source documents have not been edited.

**Navigation:** [Scope](#1-scope-and-delivery-rules) · [Architecture gaps](#2-resolve-architecture-gaps-before-dependent-implementation) · [Repository](#3-repository-contracts-and-engineering-foundations) · [Phases 0–9](#4-incremental-execution-roadmap) · [Interfaces](#5-api-and-communication-implementation-checklist) · [Data correctness](#6-data-correctness-and-recovery-algorithms) · [Security/configuration](#7-security-secrets-and-configuration-work-packages) · [Tests](#8-test-strategy-and-evidence) · [Capacity](#9-capacity-performance-and-multi-machine-qualification) · [Deployment/DR](#10-deployment-backups-and-regional-recovery) · [Readiness/backlog](#11-traceability-and-final-readiness)

## 1. Scope and delivery rules

### 1.1 Preserve the domain boundaries

| Domain | Services | Implementation | Owned storage |
|---|---|---|---|
| Catalog | `catalog-write`, `catalog-read` | Java / Spring Boot | Separate PostgreSQL databases; catalog cache in `redis-cache` |
| Playback | `playback-session`, `watch-history` | Go | `redis-session`; Cassandra for history |
| Billing | `subscription`, `payment`, `invoice` | C# / ASP.NET Core | Separate MySQL schemas and users; invoice PDFs in object storage |
| Profile | `profile`, `watchlist` | Node.js / TypeScript / Fastify | Separate MongoDB collections and scoped users |
| Recommendation | `reco-engine`, `reco-api` | Python / FastAPI | Neo4j writer and read-only roles; `redis-cache` |

Keep Keycloak for identity, Kong/Gateway API for ingress, Kubernetes DNS for discovery, Istio for workload authentication, Kafka for events, RabbitMQ for billing commands, Debezium for catalog CDC, and Vault plus External Secrets Operator for secrets. Preserve the architecture's two isolated Redis clusters. Invoice remains an asynchronous payment-event consumer and cannot veto subscription activation.

Use prepackaged HLS/DASH assets and a minimal test client. Building consumer applications, transcoding, content ingestion workflows, DRM and active-active regions is outside this implementation scope. Add DRM before launch if content licensing requires it; signed delivery URLs alone are not a substitute.

### 1.2 Execution discipline

1. Implement one demonstrable vertical slice at a time: contract → storage migration → behavior → integration → telemetry → deployment → acceptance evidence.
2. Treat the source architecture's example SQL, YAML and schemas as starting specifications. Compile, migrate and test them; do not paste incomplete examples into production.
3. Keep every service independently buildable and deployable. Share technical helpers within a language, never domain entities or database repositories between services.
4. Use local environments for fast feedback, a shared multi-machine environment from Phase 1, and a three-zone qualification environment before production approval.
5. Establish authentication, secret handling, observability and backups early. Later hardening phases verify and extend these controls.
6. Record changed architectural decisions in ADRs and reflect accepted changes in the architecture before the affected service ships.
7. Do not claim exactly-once processing across stores and brokers. Design for repeated delivery, stable identifiers, reconciliation and replay.
8. A phase closes only when its acceptance evidence exists. A screenshot of healthy pods is insufficient evidence of correctness or recovery.

### 1.3 Team and estimation assumptions

Ownership labels in this plan are responsibilities, not a required headcount: **TL** technical lead; **PL** platform/SRE; **SEC** security; **CAT**, **BILL**, **PLAY**, **PROF**, **RECO** domain engineering; **QA** quality/performance; **PO** product/business owner. Assign a primary and backup for each production component.

Estimate after Phase 0 has selected a deployment provider, supported versions, database operators and payment/CDN providers. Cloud quotas, operating seven database technologies, Neo4j licensing and DR replication can dominate the schedule. The dependency graph below is the delivery commitment; calendar dates are intentionally not invented.

## 2. Resolve architecture gaps before dependent implementation

These are implementation findings, not assumptions that the supplied architecture already solved them. All items need a recorded disposition; an unresolved critical item blocks only its dependent milestone, while independent scaffolding can continue.

| ID | Finding in the supplied architecture | Proposed resolution / required decision | Owner; deadline |
|---|---|---|---|
| ADR-01 | Runtime examples specify version floors and alternative operators; no tested compatibility set is supplied. | Select supported patch versions for every runtime, Kubernetes, Istio, gateway, operator, database, broker and SDK; pin charts/images/CRDs and record licensing/support. Do not use a minimum version as an endorsement of its present support status. | PL + domain leads; Phase 0 |
| ADR-02 | Single-zone staging cannot demonstrate three-zone resilience. Resource policy both requires CPU limits and calls them optional. | Keep low-cost functional staging, add a temporary three-zone qualification tier. Require CPU requests and memory requests/limits; explicitly decide CPU limits by workload. Correct admission rules accordingly. | PL; Phase 1 |
| ADR-03 | Playback finalization removes an expiry entry before publishing, session payload expires after 90 seconds, and Redis has no durable outbox. This leaves lost-event crash windows. | Add a durable Kafka lifecycle journal owned by `playback-session`, with replayable finalization and deterministic event IDs (section 6.3). Retain finalization payload independently of the live-session TTL. Prototype before claiming the history durability target. | PLAY + PL; before Phase 6 |
| ADR-04 | Watch History writes Cassandra and subsequently publishes Kafka without a specified atomic handoff. | Use deterministic Cassandra writes followed by a Kafka transaction that publishes `WatchRecorded` and commits the input offset. Reprocessing repairs partial writes; never skip output just because one row already exists. Validate Go client transactional support and fencing. | PLAY; before Phase 6 |
| ADR-05 | `sess:{acct}` and `expiry:{shard}` have different Redis hash tags; a single Lua operation cannot atomically update both. Redis failover also weakens strict stream-count guarantees. | Keep account operations in one hash slot; make the global expiry index rebuildable from the journal. Decide whether temporary over-admission during Redis failover is acceptable. If strict limits are mandatory during partitions, add a durable reservation authority through a separate ADR before release. | PLAY + PO; before Phase 6 |
| ADR-06 | A payment timeout is treated like failure even when the provider might already have charged. | Persist `UNKNOWN`/`RECONCILING` payment state; reconcile using a stable provider idempotency key. A late successful charge after cancellation triggers an idempotent refund. Billing consistency is local ACID plus a recoverable saga, not a distributed ACID transaction. | BILL; before Phase 5 |
| ADR-07 | Playback emits region/maturity errors but its only defined synchronous dependency is Subscription. Region is user-editable; cached catalog and recommendation data can outlive a license. | Add an authoritative content-authorization path for start and URL refresh. Proposed RPC on Catalog Write: `AuthorizePlayback`; enforce publication, asset/episode membership, current regional rights and maturity. Establish trusted region policy at the edge; account country is a preference, not proof of location. | CAT + PLAY + SEC; contract in Phase 2, implementation Phase 4 |
| ADR-08 | Catalog Read's sample DB URL uses a replica although its event consumer must write; SQL examples omit details such as `pg_trgm`, billing `active_flag` and outbox schemas. | Separate reader and projection-writer pools/roles, route writes to the primary, and create executable migrations with all constraints and indexes. | CAT + BILL; Phases 4–5 |
| ADR-09 | Payment is labeled webhook-only, but route tables expose payment methods and support operations. | Explicitly expose authenticated payment-method routes, isolate support routes behind stronger authorization, and reserve the JWT exemption for the signed webhook route only. | BILL + SEC; Phase 2 |
| ADR-10 | Profile relay examples use SQL locking for MongoDB; `primaryPreferred` is described as read-your-writes without specifying session handling. | Use MongoDB transactions, atomic lease acquisition and lease fencing. Define and test read-your-writes across successive HTTP requests with causal tokens or a suitable primary-read consistency policy. | PROF; Phase 3 |
| ADR-11 | Profile deletion has no end-to-end completion protocol; account deletion, billing retention and already-issued PCTs need coordination. | Implement a durable deletion workflow, immediate account disablement, revocation/version checks, consumer acknowledgments and replay suppression. Include billing and playback consumers; minimize retained financial identity links under an approved retention policy. | PROF + SEC + BILL; contract Phase 2, complete Phase 8 |
| ADR-12 | Typical event staleness is 5 seconds, but trending snapshots are every 5 minutes and recommendation scheduling is unspecified. | Split ingestion freshness from ranking freshness. Proposed ranking/trending p99 freshness ≤5 minutes, with ingest p99 ≤60 seconds; PO must accept this amendment or fund ≤60-second refresh. Expose actual generation times. | RECO + PO; before Phase 7 |
| ADR-13 | A 30-second heartbeat cannot reconstruct the last second of actual viewing after total session-state loss. | Define history durability as loss of acknowledged events, and separately define progress sampling accuracy (up to a heartbeat interval). If ≤1-second real-time progress is required, change collection frequency and capacity budgets. | PLAY + PO; before Phase 6 |
| ADR-14 | Stale entitlements can extend beyond validity; URL revocation semantics are absent. | Default stale access off. Any approved exception is bounded by business validity, explicit revocation state and a documented grace interval. Define that issued URLs remain usable until expiry unless the CDN performs online revocation. | BILL + PLAY + SEC + PO; before Phase 6 |
| ADR-15 | DR topology is named but replication, fencing, recovery sequencing and evidence are missing. | Implement section 10 per store. Replication plus restored checkpoints, keys and broker state must demonstrate RPO ≤5 minutes and RTO ≤1 hour; backups alone do not establish those targets. | PL + data owners; design Phase 1, acceptance Phase 9 |

Technical grounding for these findings: Redis documents same-slot multi-key operations and the possibility of losing acknowledged writes with asynchronous replication. These properties require an explicit failure policy for session admission. [Redis Cluster specification](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/)

Kafka transactions cover Kafka output and consumed offsets, not arbitrary Cassandra writes; ADR-04 intentionally makes external writes repeatable. [Kafka delivery semantics](https://kafka.apache.org/41/design/design/)

MongoDB's causal guarantees depend on sessions and appropriate read/write concerns; choosing a read preference alone is insufficient. [MongoDB causal consistency](https://www.mongodb.com/docs/manual/core/causal-consistency-read-write-concerns/)

## 3. Repository, contracts and engineering foundations

The following paths are **proposed repository artifacts**, not files already implemented by this documentation task. Start with a monorepo for discoverability and a separately protected deployment repository. If existing repositories are available, preserve their boundaries and map these directories into them.

```text
platform/
  services/
    catalog-write/                 # Java
    catalog-read/                  # Java
    playback-session/              # Go
    watch-history/                 # Go
    subscription/                  # C#
    payment/                       # C#
    invoice/                       # C#
    profile/                       # TypeScript
    watchlist/                     # TypeScript
    reco-engine/                   # Python
    reco-api/                      # Python
  libs/platform-{java,go,dotnet,node,python}/
  contracts/
    openapi/<service>.yaml
    proto/<domain>/<service>/v1/
    events/<topic>/<event-type>.schema.json
    commands/billing/
    fixtures/{valid,invalid,compatibility}/
    authorization-matrix.yaml
  infrastructure/
    modules/{network,kubernetes,identity,dns,kms,storage,cdn}/
    environments/{dev,integration,staging,qualification,prod,dr}/
  tests/{contracts,integration,e2e,security,load,chaos,recovery}/
  tools/{dev,seed,replay,reconcile,privacy,migrations}/
  docs/{adr,runbooks,slo,threat-model,operations}/
  evidence/<release>/<gate>/

deploy/                            # Separately protected GitOps repository
  platform/                       # Operators, policies, observability, brokers
  services/<service>/base/
  environments/{integration,staging,qualification,prod,dr}/
  releases/                       # Image digests, contract and migration versions
```

Each service follows `api/`, `app/`, `domain/`, `infra/`, `observability/`, `migrations/`, plus a Dockerfile and deployment base. Use native equivalents where frameworks impose layouts. Keep library releases versioned so one library change does not force a synchronized eleven-service rollout.

Define a common developer interface, implemented as scripts that work from Linux CI and Windows through a documented container/WSL workflow:

```text
dev bootstrap          # Verify dependencies, tools and environment
dev up --slice catalog # Start only dependencies for a selected slice
dev seed --synthetic   # Repeatable, non-personal test fixtures
check contracts        # OpenAPI/schema lint, protobuf breaking checks
test unit --service <name>
test integration --service <name>
test e2e --environment integration
release verify --manifest <release-manifest>
```

These are interface specifications for Phase 0 tooling, not commands that exist yet. Pin wrappers and tool versions. Keep credentials out of shell arguments, generated client examples and CI logs.

### 3.1 Common definition of done

Every increment includes an owner, reviewed contract, migration where applicable, positive and negative authorization tests, meaningful unit/integration coverage, timeouts and overload behavior, metrics/logging/traces, a dashboard/runbook update, deployable immutable image, rollback/recovery instructions and acceptance evidence. Use realistic dependency containers for integration tests; mock providers only at controlled external boundaries.

Schema changes use expand → migrate/backfill → switch → contract. New consumers tolerate the previous producer version; rolling deployments prove old/new interoperability. Destructive schema changes are separate releases after the rollback and replay windows expire.

## 4. Incremental execution roadmap

| Phase | Increment / observable result | Prerequisites | Accountable owner |
|---|---|---|---|
| 0 | Decisions, repository and reproducible developer workflow | Inputs reviewed | TL |
| 1 | Secure platform running across real machines | Phase 0 platform decisions | PL |
| 2 | Executable API/event contracts and shared technical foundations | 0; validate against 1 | TL + SEC |
| 3 | Sign in, create/select profiles, enforce ownership | 1–2 | PROF |
| 4 | Admin catalog → CDC → browse/search; watchlist | 1–3 for authenticated end-to-end | CAT + PROF |
| 5 | Payment sandbox → subscription entitlement → invoice | 1–3 | BILL |
| 6 | Authorized playback → durable history | 4–5; playback ADRs resolved | PLAY |
| 7 | Personalized recommendations and safe fallback | 4 + 6 | RECO |
| 8 | Full-system security, capacity and failure qualification | 3–7 | QA + SEC + PL |
| 9 | DR drill, controlled production rollout and operations handover | All earlier gates | PL + TL + PO |

After the contract gate, Catalog and Billing can progress independently. Recommendation can build against synthetic event fixtures while Playback is incomplete. Infrastructure, security and observability work continues alongside each slice. Do not let this overlap bypass the end-to-end prerequisite gates.

### Phase 0 — Decisions and developer bootstrap

**Goal:** A new engineer can build a selected slice reproducibly, and the team knows which architectural decisions block production.

1. **P0.1 — Inventory and baseline.** Register all eleven services, stores, topics, queues and external dependencies. Create the ADR register above and a requirements-to-test register. Preserve source versions and define which repository owns architecture changes.
2. **P0.2 — Choose deployment boundaries.** Select cloud/on-prem provider, three real zones/racks, primary/DR regions, DNS names, private networking, registry, object store, CDN and payment sandbox. Record quota, cost and Neo4j Enterprise license needs. Use placeholders until selected; never silently substitute a vendor.
3. **P0.3 — Freeze a supported compatibility matrix.** Validate runtime/driver/operator/API compatibility in a spike. Select one implementation for each alternative in the architecture. Pin dependencies and container digests; create an upgrade ownership schedule.
4. **P0.4 — Resolve product semantics.** Define plan changes, proration, currency/tax rounding, cancellation timing, dunning, refunds, supported regions, maturity controls, content restrictions and retention requirements. Treat the architecture's seven-year billing retention as a proposal needing jurisdiction-specific review, not a universal legal rule.
5. **P0.5 — Establish repository controls.** Set CODEOWNERS, protected branches, required review, short-lived branches, secret scanning and dependency lockfiles. Create per-service CI targets and synthetic fixture generators.
6. **P0.6 — Create developer bootstrap.** Provide slice-based Compose/container dependencies and a kind/k3d integration option. MongoDB must support transactions in local tests. Use a dedicated Redis Cluster test profile to catch slot errors; a standalone Redis container does not test them.
7. **P0.7 — Set SLO definitions and load assumptions.** Use section 9 as the initial test contract; agree on measurement boundaries, successful responses and exclusions. Define a representative title/episode distribution, hot-account behavior and long-session workload.

**Artifacts:** ADRs, compatibility lock, repository skeleton, bootstrap scripts, ownership list, sample configuration without values, initial threat model and SLO catalog.

**Exit gate G0:** A clean machine builds and tests one skeleton service; all eleven CI targets are registered; the provider/version decisions are documented; every unresolved business or design question has an owner and blocking phase.

**Recovery:** Bootstrap is idempotent. Recreating disposable dev data is permitted only through an explicit dev reset command scoped to the selected environment.

### Phase 1 — Secure platform on multiple machines

**Goal:** Cross-host connectivity, identity, replicated storage and operational visibility work before business services depend on them.

1. **P1.1 — Provision through IaC.** Create network/subnets, private worker pools, control plane, storage classes, workload identity, KMS, registry, DNS and object buckets. Encrypt and lock remote IaC state; limit its readers. Build `integration` on at least three actual hosts. Label real failure domains accurately; three VMs on one host do not prove host resilience.
2. **P1.2 — Install foundational controllers.** Install CNI/network policy, CSI, metrics, Gateway API CRDs, certificate management and admission policy with pinned versions. Install Istio and Kong; explicitly test the Kong-to-mesh path and encrypted LB-to-Kong traffic. Avoid an unencrypted segment after edge TLS termination.
3. **P1.3 — Bootstrap secrets safely.** Bring up Vault with external KMS auto-unseal and restricted bootstrap access; enable audit logs. Install ESO. Separate ESO's secret-fetching identity from application identities. Where dynamic DB leases need renewal, choose a supported lease-aware controller/agent; periodic secret copying alone is not credential renewal.
4. **P1.4 — Install replicated data services.** Deploy PostgreSQL, MySQL, MongoDB, Cassandra, two Redis clusters and Neo4j using the topology in architecture §5.4. Create one user per service, collection/schema restrictions, backup users and migration users. Validate TLS and denied cross-service reads. Use managed equivalents only with an ADR showing equivalent behavior and recovery guarantees.
5. **P1.5 — Install messaging.** Configure rack-aware Kafka with RF=3, minimum ISR=2, explicit topic ACLs, schema registry, distributed Kafka Connect and replicated internal topics. Configure RabbitMQ quorum queues, confirms, unroutable-message handling and DLQ policies. Disable arbitrary topic creation by application users.
6. **P1.6 — Install identity and observability.** Deploy Keycloak with external HA PostgreSQL, Prometheus/Alertmanager, Grafana, Loki, OTel collectors and Jaeger plus its chosen storage backend. Provision durable storage for schema registry metadata and dashboards/configuration. Configure all components from Git or documented bootstrap state.
7. **P1.7 — Apply baseline policy.** Namespaces get default-deny ingress/egress, explicit DNS and platform dependency permissions, resource quotas and restricted pod policy. Add database internode, broker replication, Vault/KMS, telemetry, certificate/JWKS, registry and object-store flows. Ordinary Kubernetes NetworkPolicy is not a hostname firewall: use the selected CNI or controlled egress proxy for provider host restrictions.
8. **P1.8 — Establish GitOps and recovery.** Deploy Argo CD with scoped repo access and environment separation. Add scheduled backups immediately and restore a sample database/bucket to a disposable namespace. Keep recovery keys and credentials outside the cluster being recovered.
9. **P1.9 — Prove the network.** Route a synthetic request from gateway on host A to service on host B and database on host C; require workload identity and trace continuity. Drain a node, rotate a credential and repeat. Capture actual node names and placement.

**Artifacts:** IaC, platform GitOps manifests, permission matrix, bootstrap runbook, baseline dashboards, backup/restore evidence and environment cost inventory.

**Exit gate G1:** Cross-machine request succeeds; an unauthorized pod cannot connect; traffic is encrypted; one-host disruption preserves the chosen quorums; sample restore succeeds; no application relies on localhost, developer disks or fixed node IPs.

**Recovery:** Roll back controller changes only through supported version paths. Restore stateful components from tested backups rather than deleting PVCs. Keep Kubernetes upgrades separate from database/operator upgrades.

### Phase 2 — Contracts, shared libraries and delivery pipeline

**Goal:** All teams implement the same authentication, message, error and failure semantics.

1. **P2.1 — Complete REST contracts.** Translate every endpoint in architecture §7.3 into OpenAPI, including schemas, examples, pagination, ownership, PCT requirements, rate limits, validation, ETags, idempotency and error responses. Resolve incomplete reference-data routes and support-route exposure explicitly.
2. **P2.2 — Complete internal contracts.** Generate gRPC clients/servers for Catalog Query and Entitlement. Add ADR-07's content authorization contract before Playback starts. Define allowed workload callers, user/PCT forwarding, maximum batch sizes and absolute deadlines.
3. **P2.3 — Define all events and commands.** Produce JSON Schemas and fixtures for the seven baseline Kafka topics and billing RabbitMQ messages. Add the lifecycle journal and privacy completion contracts if their ADRs are accepted. Include stable event identity, aggregate version, event time, processing trace, correlation and schema version.
4. **P2.4 — Implement cross-language conformance.** Test identical JWT/PCT verification, RFC 9457 errors, money units, timestamps, CloudEvents encoding and W3C trace propagation in all five languages. Keys/JWKS come only from configured issuers; never follow an arbitrary URL in token headers.
5. **P2.5 — Implement bounded resilience.** Provide deadline propagation, per-dependency connection pools, concurrency limits, circuit breakers, safe retries and metrics. Choose one retry layer for each call. Distinguish definitive payment failures from ambiguous timeouts.
6. **P2.6 — Implement messaging primitives.** Build transactional inbox/outbox helpers per store, relay leases, manual acknowledgments, version guards, DLQ tools and replay authorization. MongoDB gets MongoDB-specific transactions and leasing, not SQL emulation.
7. **P2.7 — Implement a common service skeleton.** Add startup/readiness/liveness endpoints, graceful shutdown, redacted validated configuration and structured logs. Keep liveness independent of transient downstream outages; readiness reflects whether this service can serve its documented fallback.
8. **P2.8 — Establish release CI.** Lint, compile, run relevant tests, compare contracts, scan secrets/dependencies/images, produce an SBOM and provenance, sign images and publish by digest. CI proposes a GitOps change; it does not need unrestricted cluster-admin credentials.

**Artifacts:** Executable contracts, generated SDKs, shared libraries, authorization matrix, CI pipelines and service skeletons.

**Exit gate G2:** Breaking contract changes fail CI; malformed messages and invalid tokens fail consistently in all languages; a trace crosses REST → gRPC and Kafka/RabbitMQ fixtures; duplicate messages cannot double-apply an example transaction.

**Recovery:** Revert library versions per service. Publish a new contract version when incompatible behavior is necessary; never mutate an already-released event schema in place.

### Phase 3 — Identity, accounts and profiles

**Goal:** A user signs in, selects a profile and can access only resources owned by that account/profile.

1. **P3.1 — Configure Keycloak as code.** Create realm, clients, PKCE/device flows, audience, roles/scopes, admin MFA and session/token settings. Verify refresh rotation/reuse behavior with the selected version rather than assuming a toggle guarantees it.
2. **P3.2 — Build Profile storage.** Add account/profile collections, normalized names, unique indexes, validators, versions and an outbox. Enforce maximum profiles through a transaction that updates/locks a shared account counter so concurrent creations cannot exceed five.
3. **P3.3 — Build account/profile endpoints.** Map account identity from verified `sub`; restrict mutable fields; use ownership checks for all reads/writes. Bootstrap account creation idempotently on first authenticated use or a provisioned identity event; choose and document one.
4. **P3.4 — Implement PCT selection.** Sign short-lived PCTs after account/profile ownership verification. Include account, profile, maturity and profile-policy version; keep signing key ID in the JOSE header. Publish internal JWKS with overlap during rotation. Require access-token/PCT subject equality on every profile-scoped request.
5. **P3.5 — Enforce parental controls.** Require adult reauthentication/PIN policy for maturity elevation and protected adult profile selection. A child must not gain privileges by selecting a different profile or editing a maturity value.
6. **P3.6 — Implement lifecycle publication.** Atomically store profile change and outbox event. Lease relay items, preserve per-account ordering/version checks and publish with acknowledgment before marking sent. Track oldest pending item and retries.
7. **P3.7 — Start deletion workflow.** Mark an account/profile unavailable and persist the workflow before publishing deletion. Disable identity/login and revoke sessions through a narrow Keycloak integration; retry safely. Consumers and completion tracking are finished in Phase 8.
8. **P3.8 — Deliver auth smoke client.** Add a minimal browser/API test client for sign-in, profile selection and subsequent authenticated calls. Restrict CORS to chosen origins; document secure client token handling and CSRF behavior where cookies are used.

**Exit gate G3:** Two independent accounts cannot read/change/select each other's profiles; mismatched or expired PCTs fail; five-profile limit holds under concurrency; key rotation works across pods; deletion immediately stops new access according to the recorded revocation policy.

**Recovery:** Retain old PCT public keys until issued tokens expire. Roll back application code only while MongoDB schema and event compatibility remain intact; deletion completion keeps running independently of UI rollout.

### Phase 4 — Catalog, CDC, search and watchlist

**Goal:** An administrator publishes a title, users browse/search it and add it to their watchlist through the distributed system.

1. **P4.1 — Create Catalog Write migrations.** Implement the title aggregate, reference data, licensing exclusion constraints, publication state, versions, asset mappings and outbox. Add missing extensions and enforce valid episode/season relationships. Use `[start, end)` license boundaries and consistent UTC clocks.
2. **P4.2 — Build admin APIs.** Implement creation, full reads, optimistic updates, publish/unpublish, archive, seasons, episodes, people, genres, rights and bounded republish jobs. Enforce role, MFA and ETag policies; write durable audit records with mutations.
3. **P4.3 — Prove CDC.** Configure a narrow publication/replication user, outbox field mappings and deterministic Kafka topic/key mapping. Produce valid CloudEvents explicitly; do not assume default EventRouter output automatically matches the specified envelope. Exercise connector restart and PostgreSQL primary failover.
4. **P4.4 — Choose outbox retention.** Proposed amendment: retain rows through a bounded diagnostic/recovery period and purge safely after capture, instead of deleting them immediately in the business transaction. Test initial snapshots, duplicate capture, delete filtering and slot recreation. Alert before WAL retention threatens disk capacity.
5. **P4.5 — Build Catalog Read projection.** Consume the compacted topic; transactionally apply a newer title version and its availability rows together. Use a primary writer pool and replica reader pool. Preserve deletion versions so older events cannot resurrect a title. Build GIN/trigram indexes and cursor pagination.
6. **P4.6 — Implement catalog REST/gRPC and authorization.** Deliver browse, detail, episodes, genres and search plus TitleExists/GetTitle/BatchGetTitles. Enforce trusted region and PCT maturity. Add the authoritative content authorization RPC on Catalog Write using one primary-backed query for publication, rights, maturity and asset/episode consistency; return `allowedUntil`, quality constraints and asset path. It fails closed if its authority is unavailable.
7. **P4.7 — Cache safely.** Cache metadata or key filtered responses by region/maturity/version. Recheck time-sensitive eligibility on every response; clamp response cache lifetime to the next rights boundary. Invalidate on updates/removals. Redis loss falls back to a bounded PostgreSQL pool.
8. **P4.8 — Build Watchlist.** Implement list/add/remove/membership with owner-derived IDs, unique `(profileId,titleId)`, primary/causal consistency policy and cursor pagination. Add uses deadline-bounded Catalog gRPC; dependency failure returns `503` plus `Retry-After`. Consume deletion events idempotently.
9. **P4.9 — Build projection rebuild.** Snapshot authoritative catalog data including deletion state and a change-stream watermark; replay remaining events into a new projection, compare checksums/counts and atomically switch readers. Define how compacted tombstone retention interacts with old consumers.

Debezium's EventRouter expects outbox inserts and filters deletes. Its configured fields and output shape must still be tested against this platform's schema. [Debezium outbox documentation](https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html)

**Exit gate G4:** Admin mutation reaches both browse and search within the agreed freshness budget; conflicting ETags fail; adjacent license windows behave correctly; expired/draft/wrong-region titles cannot be authorized for playback; a duplicate or old event cannot regress metadata; the projection rebuild and connector failover succeed; watchlist ownership and outage behavior pass.

**Recovery:** Pause consumers while retaining Kafka data; repair and replay from a known watermark. Switch back to the prior read projection when compatible. Never reverse catalog business state merely to repair a search projection.

### Phase 5 — Subscription, payment and invoice vertical slice

**Goal:** Sandbox payment creates exactly one intended financial effect, activates the correct entitlement and generates an invoice despite redelivery or crashes.

1. **P5.1 — Create complete migrations.** Implement plans, subscriptions, history, entitlements, saga state, payment attempts, refunds, provider events/customers, invoice lines/sequence, inbox/outbox, idempotency and reconciliation jobs. Define the missing generated `active_flag` so cancelled historical rows can coexist but only one live subscription exists.
2. **P5.2 — Implement plan/subscription APIs.** Add plan listing, subscribe, current/history/entitlement, change-plan and cancel. Derive prices and currency from server-side plan snapshots. Scope idempotency by account and operation; reject reuse with a different request hash.
3. **P5.3 — Implement persisted saga transitions.** Lock/version the saga row; atomically update state and insert its outgoing command/event. Use scheduled timeout processing with a DB lease. Old plans remain active during pending upgrades; downgrades/cancellations follow P0 business timing.
4. **P5.4 — Implement Payment provider adapter.** Add hosted setup sessions, token-reference listing/removal, charge, lookup and refund operations. Bind stored payment methods to account/provider customer ownership. Persist a stable operation ID before calling the provider. Never log the setup-session client secret, raw card payload or signed webhook body.
5. **P5.5 — Implement result reconciliation.** Uncertain provider results remain `UNKNOWN`; scheduled lookup and verified webhooks resolve them. Store webhook receipt and resulting transition durably before returning success. Deduplicate by provider event ID and by the underlying payment state; out-of-order callbacks cannot downgrade success into failure.
6. **P5.6 — Implement independent delivery receipts.** Payment success creates both RabbitMQ reply and Kafka business event obligations in one DB transaction. Track each destination separately; delivery to one must not mark the other complete. Restore missed deliveries after process restart.
7. **P5.7 — Implement Invoice.** Consume success/refund events, snapshot financial details, create an invoice once per payment and manage required credit/refund documents. Serialize invoice numbering per legal entity according to approved accounting rules. Persist a PDF job in the same transaction; render/upload idempotently to a private object key. PDF failure leaves `PENDING`/`FAILED` with retry, not a failed subscription.
8. **P5.8 — Implement renewals/dunning.** Use clustered Quartz scheduling and unique `(subscriptionId, period)` billing obligations. Repeated scheduler execution must reuse the same payment ID. Process retry days 1/3/5 and final status according to P0 policy; expose overdue reconciliation and dunning queues.
9. **P5.9 — Implement financial support and audit.** Restrict support lookup/refunds with role, step-up policy, service authorization and audit. Add a scheduled reconciliation report joining through owned APIs/exports, never cross-service database access, to identify charged-but-inactive and refunded-but-active discrepancies.

**Exit gate G5:** Subscribe, renew, upgrade, downgrade, period-end/immediate cancel, failed charge, duplicate command, webhook-before-response, provider timeout after charge, late success after saga cancellation, repeated refund and unavailable invoice storage all pass. No test produces a double charge/refund/invoice; every uncertain transaction remains discoverable and recoverable. Broker outages leave durable pending work.

**Recovery:** Pause new charge dispatch while retaining commands; reconcile provider state before replay. Reuse existing operation IDs. Roll back application binaries independently of financial transactions; use an explicit business refund/correction for money already moved.

### Phase 6 — Playback and durable watch history

**Goal:** An entitled profile streams authorized media, reports progress across hosts and receives durable history without lost finalization events.

1. **P6.1 — Complete the durability spike first.** Implement section 6.3's lifecycle journal and ADR-04's Cassandra/Kafka handoff with fault injection at every acknowledgment boundary. Resolve ADR-05 and ADR-13 before proceeding to full endpoints.
2. **P6.2 — Implement admission.** Validate access JWT and PCT; check entitlement and authoritative content authorization within the playback-start deadline. Intersect plan quality, asset rendition and device capability. Create a replay-safe admission ID, reserve an account slot with same-slot Lua and complete the durable start record before returning a URL.
3. **P6.3 — Implement sessions and heartbeats.** Add list, heartbeat, stop, remote termination and URL refresh. Bind session ownership to account/profile and enforce a separate policy for account-level device management. Store a monotonic heartbeat sequence; reject stale duplicates, impossible positions and mismatched assets. Bound client-reported progress by server-issued media duration.
4. **P6.4 — Implement finalization.** Reconcile timeout, stop and eviction via durable journal state. Use expiring leases/fencing, immutable finalization IDs and retryable publication; never destructively claim the only copy of pending work. Retain finalization payload until broker acknowledgment and the recovery period complete.
5. **P6.5 — Implement entitlement caching.** Apply monotonic invalidation versions from `billing.subscription.v1`. Prevent a slow old gRPC response from replacing a newer cancellation. Cache validity, business validity and approved grace are distinct timestamps. No entry plus unavailable authority returns `503`.
6. **P6.6 — Integrate CDN/object storage.** Lock origin access to the CDN, enforce signatures on manifests and every segment/rendition, and ensure relative segment URLs inherit valid access through the chosen signed-cookie/token mechanism. Bind paths and URL expiry to authorization; clamp expiry to license/entitlement limits. Test direct origin URLs and higher-quality rendition bypasses.
7. **P6.7 — Build Cassandra history.** Implement deterministic event keys, monthly buckets, TTL, progress, bounded continue-watching, pagination, hide/clear history and consistent deletes. Use trusted event ordering rather than untrusted client time; define a deterministic tie-breaker for equal timestamps. Keep the key's `event_time` stable on retries.
8. **P6.8 — Make history publication recoverable.** Write all Cassandra projections successfully, then publish `WatchRecorded` and commit source offsets in a Kafka transaction. On any crash, replay idempotently. A transactional-output consumer uses `read_committed`. If projection B failed after projection A succeeded, replay must repair B before committing.
9. **P6.9 — Implement long-session behavior.** Under the baseline design, history updates on finalization only. Explicitly test that behavior and document it for clients. If live continue-watching across devices is required, add a separate checkpoint-consumption contract rather than changing the meaning of `SessionEnded` silently.

**Exit gate G6:** Start on pod A, heartbeat on B and stop on C succeeds without sticky sessions. Concurrent starts respect the approved admission policy; all signed media paths enforce rights; expiry and revocation behavior match the ADR. Killing finalizers, losing Redis primaries, failing Kafka/Cassandra and redelivering events cannot silently lose acknowledged finalizations. History converges after recovery and never regresses on older events.

**Recovery:** Reject new admission if trustworthy limits/authorization cannot be established. Recover active state from acknowledged journal records before reopening admission after a destructive Redis loss. Preserve journal and offsets during rollout rollback; replay to repair history and recommendation feeds.

### Phase 7 — Recommendation engine, API and fallback

**Goal:** Users receive precomputed, eligibility-filtered recommendations with an observable fallback when dependencies degrade.

1. **P7.1 — Build graph schema and permissions.** Add uniqueness constraints and indexes, writer/read-only roles, query timeouts and bounded result sizes. Test that API credentials cannot mutate data. Route reads appropriately for the chosen Enterprise topology.
2. **P7.2 — Implement ingestion.** Apply catalog snapshots by title version; apply history events with dedupe in the same graph transaction as graph changes. Avoid incrementing watch counts on redelivery. Apply lifecycle deletions and tombstone/version checks to prevent erased profiles being recreated by replay.
3. **P7.3 — Build a baseline algorithm.** Implement bounded content similarity, collaborative signals and regional popularity with deterministic fixtures. Start with transparent scoring rules and explainable reasons; tune ranking quality after correctness and latency are established.
4. **P7.4 — Implement durable recompute jobs.** Keep job status and work leases in an owned durable store, with retry, cancellation and fencing. Compute outside the API. Write versioned results and atomically switch each profile's active `runId`; never expose half-written lists. Prevent scheduled jobs from overlapping without bounds.
5. **P7.5 — Implement trending.** Define event-time windows, late arrivals, count dedupe, scoring and privacy thresholds. Store an authoritative versioned snapshot/job result in the engine's owned store, then publish Kafka/cache updates as replayable obligations. Use monotonic snapshot versions so retries cannot overwrite fresher data.
6. **P7.6 — Build serving endpoints.** Implement home, similar and trending; fetch at most 100 IDs per metadata RPC. Enforce region, maturity and current rights against eligibility data in every fallback. A graph-level `available` boolean alone cannot enforce regional/time-based licensing.
7. **P7.7 — Handle dependency loss.** Neo4j failure falls back to Redis; Redis loss uses a verified recent local snapshot. Metadata failure may return IDs only when eligibility is still verifiable; otherwise return an empty degraded response. A fresh pod with neither cache nor snapshot cannot promise trending is always available.
8. **P7.8 — Build graph rebuild.** Restore catalog state plus a checkpointed Watch History export through an owner-operated API/job, then catch up the event stream from a watermark. Fence recompute workers during swap; compare sample rankings, node counts, deletions and freshness before activation.

**Exit gate G7:** Duplicate replay does not inflate scores; new/deleted content is reflected; API queries remain bounded and read-only; consent/erasure is respected; fallback never exposes ineligible titles; the graph can be rebuilt beyond Kafka's seven-day history window.

**Recovery:** Switch the active algorithm/result version or disable personalization by feature flag. Retain the prior valid snapshot during rollout; never roll back deletion tombstones or eligibility policy.

### Phase 8 — Integrated production qualification

**Goal:** All services meet security, scale and failure requirements in a production-equivalent environment.

1. **P8.1 — Run complete journeys.** Sign in → select profile → browse → watchlist → add payment method → subscribe → play → stop → history → recommendations → invoice → cancel → delete. Validate result ownership and trace continuity at each boundary.
2. **P8.2 — Close privacy workflows.** Implement consumer acknowledgments, retries and deadlines for history, watchlist, graph, caches, sessions, billing identity minimization and identity-provider deletion. Export subject data through owned interfaces. Test erase → replay → restore: none may resurrect erased data.
3. **P8.3 — Run adversarial authorization tests.** Test cross-account/profile access, maturity escalation, forged region, algorithm/key confusion, expired/wrong-audience tokens, webhook forgery/replay, support privilege abuse, SSRF inputs, excessive pagination, query abuse and direct service access outside the gateway.
4. **P8.4 — Verify supply chain and secrets.** Reject unsigned/unapproved images and privileged pods; rotate DB, messaging, gateway, PCT and CDN credentials while serving traffic. Prove lease renewal, overlap and rollback work without logging values. Verify database grants through negative tests.
5. **P8.5 — Benchmark with representative data.** Execute section 9's mixed peak, cold-cache, spike and soak workloads. Compare latency/error rates to SLOs; record request distributions, hardware, image digests, queries, partitions and bottlenecks. Do not extrapolate production capacity from empty tables.
6. **P8.6 — Run three-zone failures.** Drain a worker, crash a database primary, disconnect one zone, pause consumers, fill a test disk to warning thresholds, fail the CDN/provider sandbox, break DNS for a controlled dependency and restart a connector. Restore each fault before the next; verify user outcomes and reconciliation.
7. **P8.7 — Verify alert actionability.** Inject failures to trigger on-call alerts; check severity, routing, dedupe, dashboards and runbook usefulness. Prefer symptom/error-budget alerts over pages for every transient pod restart.
8. **P8.8 — Review readiness.** Track every unresolved finding with severity, owner and evidence. No critical authorization flaw, data-loss path, unreconciled financial state or failed recovery gate may be treated as cosmetic technical debt.

**Exit gate G8:** All service and whole-system tests pass, agreed performance budgets hold, no blocking security finding remains, the documented degraded modes are demonstrated and the three-zone resilience report is reviewed. Monthly availability remains an operational SLO; a short qualification run does not prove a month's availability.

**Recovery:** Reset only synthetic qualification data through controlled automation. Fix failures and repeat affected tests plus their dependent journeys; avoid indiscriminate reruns that conceal unresolved flakiness.

### Phase 9 — DR, production rollout and handover

**Goal:** The platform can launch, survive a region loss and be operated by someone other than its original implementer.

1. **P9.1 — Complete warm standby.** Provision the DR network, KMS/secret access, identity, operators, quotas, signed images, GitOps and data/broker replication. Keep timers, consumers, charging jobs and other writers fenced until promotion.
2. **P9.2 — Execute the recovery runbook.** Perform section 10's region-loss rehearsal using a production-like dataset and workload. Measure the oldest missing acknowledged business operation, not only the age of the last backup. Reconcile provider payments and restore deletion controls before admitting users.
3. **P9.3 — Freeze the release manifest.** Record every image digest, migration, contract, operator and configuration version. Verify backups, restore access, rotation dates, capacity after one-zone loss, CDN delivery, dashboards, on-call coverage and provider production credentials.
4. **P9.4 — Apply production migrations.** Use separate short-lived migration roles and bounded locks. Expand schemas first, deploy tolerant readers/consumers, then new producers. Test compatibility before enabling new fields or features. Keep the old application version runnable until the rollback window closes.
5. **P9.5 — Release in controlled cohorts.** Start with internal/synthetic accounts, then 1%, 5%, 25%, 50%, 100% of eligible traffic as sample size permits. Proposed minimum observation: 30 minutes per meaningful canary step and 24 hours before broad rollout; use sufficient request volume and at least one real renewal-cycle rehearsal, not elapsed time alone.
6. **P9.6 — Define automatic stops.** Stop expansion for sustained SLO burn, authorization regression, unexpected charges/refunds, rising unreconciled transactions, lost lifecycle events or backlog beyond recovery budgets. Revert traffic/image/config where safe; preserve financial state and offsets.
7. **P9.7 — Handover operations.** Publish runbooks, component owners, escalation paths, access procedures, backup/restore calendar, support/refund procedure, maintenance windows, dependency renewal/license dates and budget alerts. A second engineer completes a node/secret incident exercise using only the runbooks.
8. **P9.8 — Close readiness review.** TL, PL, SEC, QA and PO review evidence. Record residual accepted risks with expiry and remediation owner. Keep business sign-off for stale access, sampling accuracy, regional policy and content rights explicit.

**Exit gate G9:** Production deployment is reproducible, canary criteria pass, region recovery meets the agreed RPO/RTO, failback is rehearsed and operations ownership is active. This is the production-ready milestone.

**Recovery:** Roll back traffic and compatible binaries; do not rewind financial databases, replay charging with new IDs, restore deleted identities or activate two regions' schedulers at once.

## 5. API and communication implementation checklist

### 5.1 REST surface and authorization

All external application routes use `http://<domain>/`. This inventory maps implementation ownership; the generated OpenAPI is the detailed executable contract. Health, metrics, JWKS, internal jobs and gRPC have no general public route. (https can also be supported but not mandatory)

| Service / phase | Required endpoint families | Authorization and critical behavior |
|---|---|---|
| Profile / 3 | `GET/PATCH/DELETE /accounts/me`; `GET/POST /profiles`; `GET/PATCH/DELETE /profiles/{id}`; `POST /profiles/{id}:select` | Access JWT; ownership from `sub`; maturity elevation protected; internal JWKS separately permitted |
| Catalog Write / 4 | `/admin/catalog/titles` create/read/update/delete; publish/unpublish actions; season/episode CRUD; licensing windows; people/genres; maintenance republish | `catalog-admin`, MFA, restricted ingress; ETags/If-Match for mutable aggregates; bounded asynchronous bulk work |
| Catalog Read / 4 | `GET /catalog/titles`, detail, episodes, search, genres | JWT and PCT for profile-filtered content; client filters can only narrow trusted eligibility |
| Watchlist / 4 | `GET /watchlist`; `PUT/DELETE/HEAD /watchlist/titles/{id}` | JWT + PCT; idempotent unique entry; add validates existence; no trust in body account/profile IDs |
| Subscription / 5 | `GET /plans`; `POST /subscriptions`; current/history/entitlement reads; change-plan/cancel actions | Plans publicly cacheable; other operations account-scoped; operation idempotency and explicit saga status |
| Payment / 5 | Setup sessions; list/remove payment methods; payment webhook; restricted support lookup/refund | User ownership for methods; raw-body signature verification for webhook; MFA/role/audit for support; no unauthenticated non-webhook bypass |
| Invoice / 5 | Account invoice list; invoice detail; PDF redirect | Account ownership checked before issuing short-lived download; cache private; pending PDF returns defined non-ready response |
| Playback / 6 | Create/list sessions; heartbeat; stop; refresh URL; remote terminate | JWT + PCT; entitlement + rights checks; session ownership; atomic admission; replay-safe mutation |
| History / 6 | Continue watching; title progress; paginated events; hide title; clear history | JWT + PCT; stable cursors and bounded time ranges; erase watermark prevents old events reappearing |
| Reco API / 7 | Home; similar titles; trending | JWT + PCT; bounded reads; generation time, source and degraded flag; safe eligibility filtering |
| Reco Engine / 7 | Internal recompute job creation and job status | Named ops workload plus scoped service token; no public route; durable job ownership |

For every operation, the contract records request/response body, success/error status, owner policy, rate limit, body limit, timeout and idempotency behavior. Pagination defaults to 20 with maximum 100; validate cursors against filter/sort/profile context. Return RFC 9457 problems without stack traces. Unknown write fields fail validation.

Do not apply conflicting validation rules during rolling upgrades: public request schemas can reject unknown input fields, while event consumers tolerate newly added optional fields compatible with the registry policy. Test this explicitly.

### 5.2 Synchronous dependency budgets

| Caller → callee | Interface and caller identity | Initial budget / failure behavior |
|---|---|---|
| Gateway → service | REST, verified JWT/PCT and mesh identity | Generic maximum 5 seconds; stricter route limits for hot paths; propagate remaining budget |
| Watchlist → Catalog Read | `CatalogQueryService.TitleExists`; Watchlist service account and delegated profile context | Total call budget 400 ms; bounded retries inside that budget; `503` on inability to validate |
| Reco API → Catalog Read | `GetTitle`/`BatchGetTitles`, at most 100 IDs | Architecture default is 400 ms, which exceeds recommendation's 100 ms SLO; proposed serving budget ≤40 ms with no retry and eligible cached fallback. Benchmark and approve in Phase 7. |
| Playback → Subscription | `EntitlementService.CheckEntitlement`; Playback identity plus verified account context | 150 ms total; safe cached result only under ADR-14 |
| Playback → Catalog Write | Proposed `ContentAuthorizationService.AuthorizePlayback`; dedicated allow-list | Proposed 150 ms total; independent from entitlement, so calls may execute concurrently; fail closed; include this additional authority in load/HA tests |
| Payment → provider | HTTPS with restricted egress and provider credential | 10 seconds per attempt within async workflow; ambiguous outcome enters reconciliation |

An internal RPC must not authorize a caller solely because it sends an `account_id`. Verify the caller workload and the forwarded user context or an explicitly scoped delegation token. A user-supplied timeout header may shorten a server budget, never extend it.

The proposed authorization request contains title/episode, trusted region, account/profile, maturity-policy version and requested action. Its result contains decision/reason, catalog version, permitted asset prefix, rights end, rendition policy and decision expiry. The authoritative service derives or verifies security fields against trusted tokens; callers cannot invent a higher maturity value.

### 5.3 Event and command inventory

Initial partition counts and retention are from the supplied architecture and require validation under measured load.

| Topic | Producer → consumer | Key; initial partitions; retention | Required consumer invariant |
|---|---|---|---|
| `catalog.title.v1` | Catalog Write/CDC → Catalog Read, Reco Engine, optional Watchlist | `titleId`; 12; compacted | Whole title version applied atomically; deletion cannot be undone by older version |
| `playback.session.ended.v1` | Playback → Watch History | `profileId`; 24; 7 days | Same finalization ID and event time on every replay |
| `watch.history.recorded.v1` | Watch History → Reco Engine | `profileId`; 24; 7 days | One logical watch effect; repeats do not inflate graph/trending counts |
| `billing.payment.v1` | Payment → Invoice | `subscriptionId`; 12; 14 days | Invoice/refund document once per unique financial effect |
| `billing.subscription.v1` | Subscription → Playback | `accountId`; 12; 7 days | Entitlement version only moves forward |
| `profile.lifecycle.v1` | Profile → History, Watchlist, Reco Engine | `accountId`; 6; 30 days | Deletion wins against older events; enumerate every affected profile |
| `trending.snapshot.v1` | Reco Engine → Reco API | `region`; 3; compacted | Snapshot version only moves forward; consumers do not gain cache write access |
| Proposed `playback.session.lifecycle.v1` | Playback ingress → Playback finalizer/recovery workers | `sessionId`; capacity-test count starting at 24; proposed 7 days | Ordered stable-ID start/checkpoint/end records; acknowledged data reconstructible after Redis loss |

ADR-11 extends lifecycle consumption to Playback, Subscription and Payment for access cessation and identity minimization, plus durable completion reporting to Profile. Completion events should be batched or use a small owned callback API; choose the contract in Phase 2 and restrict it to named consumers.

RabbitMQ vhost `billing` has `payment.charge`, `payment.refund`, `subscription.payment-result` and `billing.dead-letter`. Preserve `message-id`, `correlation-id=sagaId`, event type, schema version and trace context. Validate positive amounts/currency and prevent a refund total exceeding the settled amount. Manual support refunds and saga compensation use the same underlying refund invariants.

### 5.4 Compatibility, retries and replay

- Producers supply immutable event IDs, original occurred-at time and aggregate versions. A transport retry retains them; an actual new business transition gets a new ID.
- Inbox state and local effects commit in the same transaction wherever supported. Inbox/dedupe retention must cover broker retention plus the permitted replay/backup horizon. Financial uniqueness constraints remain effective beyond short-lived inbox retention.
- Retry-topic routing can reorder events. Versioned full-state projections reject stale versions; ordered financial commands use state preconditions and per-saga sequencing. Never assume a retry queue preserves original partition order.
- Pause on transient dependency errors or use bounded retries; malformed/unsupported messages go to restricted DLQs after the configured attempts. DLQs contain minimal necessary personal data and have retention/erasure rules.
- Replay requires authorization, a dry-run selection, bounded rate, preserved IDs and an audit trail. Financial replay never creates new provider idempotency keys. Track replay job status and stop it if downstream error/backlog thresholds rise.
- Increasing a Kafka topic's partition count can change key placement. Plan an ordering-safe cutover/versioned topic when ordering matters; do not casually resize a live financial or lifecycle topic.

## 6. Data correctness and recovery algorithms

### 6.1 Transactional outbox/inbox specification

For each mutable relational service, migrations include:

| Record | Minimum information |
|---|---|
| Outbox event | Immutable ID, aggregate ID/version, event type, destination, payload/schema version, trace, creation time |
| Delivery obligation | Event ID + destination unique key, state, attempt count, next attempt, lease owner/expiry/fence, sent time, last error category |
| Inbox | Consumer name + message ID unique key, payload hash, processing outcome/time |
| API idempotency | Account + operation + key hash, request hash, in-progress/completed state, resulting resource ID, original status/response, expiry |

Write domain change and outbox/inbox effects in one local transaction. Do not hold database locks across network calls. Claim work in a short transaction, publish outside the lock, and mark delivered only if the lease/fence still matches. If the relay crashes after publishing, it republishes with the same ID; consumers make this safe. Preserve aggregate ordering by serializing outstanding versions or requiring monotonic state application.

MongoDB uses equivalent collections and transactions, with conditional `findOneAndUpdate` leasing. Invoice needs an inbox plus a durable PDF-work record; an outbox is needed only for a durable external publication/work obligation. Recommendation graph updates and dedupe markers share a Neo4j transaction, with separately replayable snapshot publications.

Catalog CDC must prove its outbox column mappings, snapshot behavior, delete handling, connector offsets and replication-slot failover. A bounded row-retention policy needs a recovery watermark and disk alerts; `max_slot_wal_keep_size` limits disk exposure but can force resnapshot if the slot loses required WAL. Document that recovery, rather than treating a WAL cap as lossless recovery.

### 6.2 Billing state machine and uncertain outcomes

| Trigger | Persisted action | Required invariant |
|---|---|---|
| Subscribe/change/renew accepted | Save saga and pending billing obligation; enqueue charge | One obligation per idempotency key/renewal period |
| Charge command received | Save/reuse payment attempt, then call provider with stable key | Message repetition cannot create another charge |
| Definitive provider decline | Persist failure plus reply/event obligations | Preserve old entitlement during failed upgrade |
| Timeout/connection lost after dispatch | Persist uncertain state and schedule lookup | Never infer no charge from missing response |
| Charge success | Persist success plus Kafka event and Rabbit reply | Two publication destinations recovered independently |
| Success received while saga active | Activate entitlement and publish incremented version | Access changes only once for that obligation |
| Saga deadline expires | Cancel pending activation and retain reconciliation responsibility | Timeout is not evidence that money did not move |
| Late charge success for cancelled saga | Persist refund obligation with stable refund ID | Eventually refund or expose a visible retry/operator queue |
| Refund succeeded | Persist refund result, reconcile entitlement and issue document event | Total refunded does not exceed settled amount |

Use compare-and-set state/version checks to handle timeout and success racing on different workers. Treat `RefundRequested`, `RefundCompleted` and provider results as repeatable. A service crash after provider success but before local commit is recovered by stable-key lookup/webhooks, not by generating another payment.

### 6.3 Playback lifecycle durability proposal

The architecture's ephemeral Redis-only state is sufficient for fast session lookups, but not a durable record of finalization. ADR-03 adds a broker-backed journal without adding another business service or primary database.

**Admission:** Reserve a provisional account slot atomically in Redis using a stable admission/session ID; append `SessionStarted` to the replicated journal and wait for acknowledgment; activate the reservation conditionally and return the URL. Retrying the same request reuses the ID. A failed/uncertain step goes through reconciliation, not an unconditional second reservation. A provisional slot has a bounded lease, and the reconciler checks the durable journal before reopening or cancelling it.

**Heartbeats:** Each accepted checkpoint has a stable `(sessionId, sequence)` and trusted receipt time. For the proposed durability contract, acknowledge the heartbeat only after its journal append succeeds; Redis provides the live view and may be rebuilt. This adds Kafka latency to the hot path and approximately 3.3k events/s at baseline load; Phase 6 must demonstrate the 50 ms p99 target or change the agreed durability/latency contract. Do not silently fire-and-forget.

**Finalization:** Partition-owned workers reduce journal records to session state and durable timeout schedules. Persist recovery state/checkpoints in replicated storage or a Kafka transactional state/changelog design; local scratch state is always reconstructible. When a terminal transition wins, transactionally publish `SessionEnded` plus the terminal-state record and consumed offsets. Use a deterministic finalization ID and fence obsolete workers. Expiry is a logical timestamp; TTL cleanup never removes the last finalizable payload.

**Stop/timeout races:** Define timeout as last durably accepted heartbeat plus inactivity allowance. Late heartbeats, duplicate stops and replayed starts follow explicit state transitions. Once finalized, a session never reopens; the client starts a new session. The contract must state whether a stop after timeout returns the existing outcome.

**Redis failure:** Close admission when counters cannot be trusted. Rebuild account sessions from the journal and reconcile provisional entries before reopening. Existing cached URLs may continue until their approved expiry. The ephemeral Redis expiry index is only a wake-up accelerator, never the authority deciding whether an event was already published.

**Retention:** Keep journal data beyond the maximum supported session length, recovery interruption and replay horizon. Cap session lifetime or introduce retained current-state snapshots. A seven-day topic cannot reconstruct a still-running session whose only start event aged out without a snapshot. Preserve deleted-account suppression across all replay paths.

**Prototype gate:** Fault injection must cover journal acknowledgment lost, Redis lease lost, worker rebalance during timeout, transaction abort, journal outage, concurrent retries on different hosts and state restoration after total Redis loss. If the proposed journal/state implementation cannot pass, resolve the ADR before full Playback delivery.

### 6.4 History, retention and privacy correctness

- Use canonical `sessionId`, event time and finalization ID for event uniqueness. A replay must not choose a fresh event timestamp that inserts another row.
- Cassandra writes across different tables are not assumed to be a single ACID transaction. Repeat every required write on replay and publish the derived event only once the input is fully applied.
- Progress ordering uses a trusted version/order key, and deterministic timestamps where required by Cassandra. Handle equal timestamps explicitly. Verify that a late older watch cannot replace newer position or reintroduce cleared history.
- Keep a deletion/clear-history watermark in owned durable state, distinct from TTL data, and apply it before every replay/import. A title hidden from history may be watched again later; define whether only pre-clear events are suppressed. Account erasure prohibits all old-account reconstruction.
- Maintain an index/export mechanism for all retained Cassandra month buckets so erasure covers the full retention interval, not only the current month. Monitor tombstones and repairs; do not rely on an unbounded scan at deletion time.
- Preserve absolute retention deadlines during replay. Rewriting an old Cassandra event must use its remaining TTL, not restart its two-year lifetime; events already past retention are suppressed.
- Privacy workflows include dead letters, caches, derived graphs, exports and backup restoration. Restore into quarantine, reapply the deletion ledger, then reopen access. Retention of deletion markers and backups requires a documented purpose and access policy.

## 7. Security, secrets and configuration work packages

### 7.1 Enforce trust at every boundary

| Boundary | Implementation control | Required verification |
|---|---|---|
| Internet → edge | TLS, WAF, route/method allow-list, body limits, rate limits, trusted proxy-header normalization | Spoofed forwarding/region headers ignored; disallowed methods and oversized bodies blocked |
| Edge → workloads | Encrypted authenticated transport, scoped gateway identity | Direct unauthenticated pod call rejected |
| Workload → workload | Strict mesh mTLS, named ServiceAccounts, least-privilege authorization and propagated user scope | A different valid workload identity still cannot call an unauthorized RPC |
| Workload → data | TLS with server verification, unique users, scoped grants, network policy | Cross-service database/collection writes denied; certificate failures do not disable verification |
| Services → brokers | Kafka certificate/topic/group ACLs; RabbitMQ TLS/vhost/queue permissions | Consumer cannot publish arbitrary commands or read another protected topic |
| Provider → webhook | Raw-body signature/timestamp validation, dedupe, size caps, provider-supported IP restrictions where available | Modified, old and repeated events cannot cause financial duplication |
| CDN → origin | Private origin; signature/token policy on all media paths | Origin and unsigned segment requests fail; expired links stop working |
| Operator → support/admin | Separate route exposure, strong identity/MFA, explicit roles, immutable audit | Support user cannot obtain platform-admin privileges or view unrelated secrets |

Istio does not automatically secure every datastore protocol merely because the cluster has a mesh. Validate native database/client TLS and broker authentication separately. Define which stateful components are mesh-injected and ensure native replication and health probes remain supported.

### 7.2 Secret lifecycle

Implement a machine-readable inventory with secret owner, Vault path, consumers, rotation deadline, lease duration, reload mechanism, overlap window, emergency revocation procedure and alert. Cover database users, Kafka certificates, RabbitMQ users, OIDC client credentials, PCT/CDN signing keys, provider keys/webhook secrets, object-store access and envelope encryption keys.

1. Workload identity or a narrowly scoped projected ServiceAccount token authenticates only the actor that needs it. Default token automount remains disabled; ESO/agents get explicit scoped access.
2. Application pods receive mounted secret files wherever the client supports reload. A reloader rollout is the fallback, with overlapping credentials and enough ready replicas to avoid an outage.
3. Dynamic database credentials are renewed before lease expiry and connection pools reconnect gracefully. A new file without a refreshed DB connection does not prove rotation succeeded.
4. Rotate signing keys by publishing the new public key first, then signing with it, then retiring the old key after the longest accepted token/URL lifetime and cache overlap.
5. Exercise emergency key compromise: stop new issuance, invalidate affected credentials, replace keys and identify already-issued bearer-token exposure. Keep break-glass access time-limited and audited.
6. Scan Git, images, logs, traces and sample configs for secrets. Restrict access to IaC state and encrypted backups because they can contain sensitive bootstrap or data material.

### 7.3 Configuration contract

| Category | Required configuration and validation |
|---|---|
| Identity | Issuer, audiences, configured JWKS endpoints, algorithm allow-list, clock skew and profile-policy checks |
| Networking | Internal service DNS names; HTTPS provider endpoints; ports; explicit connection and total deadlines |
| Database | Reader/writer endpoints as needed, DB/schema name, TLS verification, pool caps, transaction/consistency settings; credentials from files |
| Messaging | Broker DNS, topic/group/queue names, schema IDs, acknowledgment/transaction settings, retry/DLQ/retention policies |
| Playback | 30-second heartbeat, 90-second live inactivity threshold, URL maximum lifetime 300 seconds, entitlement-cache TTL, approved grace policy, journal/recovery settings |
| Billing | 15-minute saga timeout, provider lookup/reconciliation cadence, dunning schedule, integer money/currency policy |
| Recommendation | Algorithm/run version, recompute budget, freshness limits, eligibility snapshot age, bounded fallback |
| Operations | Environment/service/region, logging/redaction, OTel endpoints/sampling, shutdown grace, health and metrics ports |

Store non-secret values in reviewed environment overlays; validate types, ranges and cross-field constraints at startup. For example, prohibit a URL TTL longer than the configured maximum rights exposure; require retry attempts to fit total deadlines. Runtime flags may toggle approved algorithms/grace policies, not inject arbitrary credentials or endpoints.

Use a single documented precedence order. Redacted effective config is available only on restricted non-production diagnostics. Production logs may include config version/hash, never values of sensitive fields. Zone metadata must come from an explicit node-label propagation mechanism; a pod's downward API does not automatically provide arbitrary node labels.

### 7.4 Operational telemetry delivered with each service

| Signal | Examples and use |
|---|---|
| User outcomes | Valid request success, playback-start latency, failed authorizations, invoice readiness, end-to-end catalog propagation |
| Work queues | Outbox oldest age, delivery attempts, Kafka lag/time lag, Rabbit unacked age, retry/DLQ depth, recompute backlog |
| Financial correctness | Unknown payments, aged sagas, charged-but-inactive accounts, refund pending age, reconciliation differences |
| Playback correctness | Provisional reservations, recovered sessions, finalization lag, journal errors, lost/late checkpoint diagnostics |
| Data health | DB replication lag/quorum, WAL slot lag, Cassandra tombstones/repair age, disk watermarks, cache memory/evictions |
| Security/operations | Certificate/secret expiry, invalid-token bursts, webhook signature failures, admission denials, backup age/restore success |

Use structured logs and trace propagation across every transport. Do not label metrics with account, profile, session, payment IDs or arbitrary URL paths. Keep these only in access-controlled logs/traces when necessary and pseudonymized. Sample tracing with error/slow-path retention and bound its cost. Alert on node clock skew over the architecture's 500 ms threshold.

## 8. Test strategy and evidence

### 8.1 Test layers

| Layer | Scope and representative cases | Runs |
|---|---|---|
| Unit/property tests | Money/state invariants, entitlement version ordering, time windows, maturity policy, deterministic event keys | Every relevant change |
| Contract/conformance | OpenAPI validation, protobuf compatibility, event schema evolution, cross-language JWT/PCT fixtures | Every contract/library change; release gate |
| Component integration | Real local stores/brokers; migrations, transactions, uniqueness, leases, CDC and cluster-specific operations | Relevant service CI |
| Provider integration | Sandbox charge/setup/refund, signed webhooks, idempotency and uncertain result lookup | Adapter changes; release qualification |
| End-to-end | Full user and admin journeys through Kong, identity and deployed services | Shared integration; each release candidate |
| Security | Ownership, scope/MFA, network/database permissions, input abuse, supply chain and secret rotation | Continuous targeted tests; full Phase 8 review |
| Performance | Mixed peak, hot keys, realistic dataset, cold caches, spikes, soak and failure under load | Phase 8; material capacity changes |
| Recovery | Replay, node/zone loss, backup restore, region promotion/failback, privacy replay suppression | Phase gates and scheduled operating drills |

### 8.2 Mandatory failure scenarios

| Test ID | Injected failure | Pass condition |
|---|---|---|
| F01 | Kill producer after DB commit before publish | Outbox eventually delivers the same event ID |
| F02 | Kill relay after publish before marking sent | Duplicate delivery causes one business effect |
| F03 | Lose provider response after a successful charge | Stable-key reconciliation finds original charge; no second charge |
| F04 | Deliver late success after saga timeout | One refund obligation completes or raises an actionable persistent incident |
| F05 | Fail invoice storage for an hour | Paid entitlement remains active; PDF work recovers once storage returns |
| F06 | Fail Debezium and then PostgreSQL primary | CDC resumes or controlled rebuild completes without silent title loss; WAL disk remains protected |
| F07 | Kill playback finalizer during claim/publish | Session end remains recoverable; finalization ID does not change |
| F08 | Lose Redis session primary/state | Approved admission behavior holds; acknowledged journal data reconstructs state |
| F09 | Crash History after one Cassandra projection write | Replay completes other projections and derives the event; progress does not regress |
| F10 | Reorder entitlement and catalog events | Newer revocation/deletion/version wins |
| F11 | Lose graph, then cache, then cold-start Reco API | Safe declared fallback/empty response; no unverified mature/unlicensed content |
| F12 | Erase account, then replay old events and restore backup | Deleted identity/data is not resurrected; financial retention policy is respected |
| F13 | Rotate signing/DB keys during load | Authorized requests continue within SLO; old keys retire on schedule |
| F14 | Disconnect one real zone | Surviving quorums serve traffic within recovery target; no split-brain writes |
| F15 | Promote DR while old region can reconnect | Old writers remain fenced; payment jobs and consumers do not double-run |
| F16 | Deploy new optional event fields with older consumer | Older consumer remains compatible; unknown event major versions handled safely |

Each report records environment topology, release digests, dataset, fault time, duration, accepted-operation IDs, observed recovery, assertions and defects. For money and durable events, compare expected operation IDs to actual results; aggregate error rates alone can hide a missing operation.

## 9. Capacity, performance and multi-machine qualification

### 9.1 Initial SLO and acceptance matrix

These targets come from architecture §2 unless marked **proposed**. Confirm their business meaning in Phase 0 and any changes through ADRs.

| Area | Target | Measurement and qualification |
|---|---|---|
| Browse/search availability | 99.95% monthly | Successful eligible requests / valid requests, measured at edge; dependency failures count |
| Playback start / billing API availability | 99.9% monthly | Separate start/API SLIs; exclude invalid user requests, not internal outages |
| Catalog search / detail | p95 <200 ms / <80 ms | Server-side edge entry to response, at mixed peak with realistic filters |
| Playback start | p95 <400 ms | Includes entitlement, content rights, reservation, durable start and signing |
| Heartbeat | p99 <50 ms | Includes the acknowledged durability path chosen in ADR-03 |
| Recommendation serving | p95 <100 ms | Includes filtering/fallback; report personalized and degraded cohorts separately |
| Projection ingestion | Typical ≤5 s; p99 ≤60 s | Source business commit/accepted event to visible projection |
| Ranking/trending freshness | Proposed p99 ≤5 min | Separate from ingestion; acceptance depends on ADR-12 |
| Catalog/billing durability | No acknowledged commit loss for modeled node/zone failures | Inject failure and compare operation IDs; region DR has separate RPO |
| History durability | ≤1 s acknowledged-event loss target; proposed journal seeks zero under modeled node failure | Reconcile acknowledged IDs; actual viewing-position sampling is separately bounded by heartbeat interval |
| Zone recovery | Automatic, ≤2 min target | Real zone failure, end-user traffic and measured quorum recovery |
| Region recovery | RPO ≤5 min, RTO ≤1 h | Timed promotion plus business verification; exercise worst affected store and queue |

Define availability success carefully: a fast `202` for subscription acceptance does not prove payment completion. Add proposed business SLIs for pending-payment resolution, aged reconciliation, invoice PDF delay and finalization-to-history visibility, with thresholds agreed during the related phase.

### 9.2 Reference workload and sizing worksheet

Use 5 million accounts, 1.5 million daily active profiles, 100,000 concurrent streams, 50,000 titles and approximately 2 million episodes. Seed production-shaped indexes, skewed popularity, long-lived accounts and representative graph cardinality.

| Input | Initial estimate | Consequence |
|---|---|---|
| Heartbeats | `100,000 / 30 ≈ 3,333 requests/s` | Jitter heartbeat timing; include proposed lifecycle journal load |
| Catalog peak | 10,000 requests/s; assumed 90% cache hit | Approximately 1,000 origin reads/s when warm; qualify cold-cache fallback separately |
| Finalizations | 300 events/s peak | History write amplification across tables + derived Kafka events |
| Subscription/renewal | 20 operations/s peak | Test scheduler concentration and provider rate limits; not only daily averages |
| Entitlement cache | 5-minute TTL baseline | Miss traffic depends on active accounts and invalidation bursts; measure rather than assuming one miss per session |
| Media bandwidth | `concurrent streams × average bitrate` | At an illustrative 5 Mb/s, 100k streams require about 500 Gb/s at the CDN; application pod sizing does not cover this traffic |

For each workload record measured sustainable throughput per pod at target latency, CPU/memory, connection pools, payload size, storage growth, replication overhead, network and backup/egress cost. Start with:

```text
replicas = ceil(peak_RPS / (measured_RPS_per_pod_at_SLO * target_utilization))
remaining_capacity_after_one_zone_loss >= full approved peak demand
broker_disk = event_rate * mean_event_bytes * retention_seconds * replication_factor
              + indexes, segments, compaction and operational headroom
database_connections = sum(max_pods_for_each_client * its_pool_limit)
```

For evenly spread capacity, one-zone loss leaves roughly two thirds available. Size total provisioned capacity accordingly and include provider quotas; an autoscaler cannot create unavailable nodes instantly. Preserve at least the tested operational free-space margin, proposed 30%, and monitor growth before disks approach it.

Illustrative journal sizing: 3,333 checkpoints/s at 1 KiB sustained for seven days is roughly 2.06 TB logical before replication and overhead, or about 6.2 TB at RF=3. Peak is not necessarily continuous; use measured duty cycles and payload compression. This addition must be budgeted in ADR-03.

### 9.3 Scaling policies

- Stateless user-facing services start with at least three production replicas spread across zones, subject to measured capacity. Match PDBs to the actual quorum/service redundancy; test rolling-update surge capacity.
- HPA scales Catalog Read, Playback and Reco API using measured CPU plus appropriate request/concurrency signals. Define min/max replicas, stabilization and graceful scale-in; account for connections opened by max replicas.
- Consumer workers scale on lag/age and processing cost, capped by topic partitions and database throughput. More consumers than partitions do not increase ordered partition processing.
- Recompute workers scale by bounded job concurrency and DB headroom. Keep batch budgets separate from latency-sensitive graph reads.
- Database scale is a deliberate operation: validate indexes/query plans first, then readers/shards/nodes. Do not use HPA to resize quorum members blindly.
- Define load shedding and degraded responses before saturation. Retries stay within the architecture's 20% retry budget and the original deadline; never multiply application and mesh retries.
- Require both per-node and per-zone placement evidence. Redis masters and their replicas must not share a failure domain. Odd replica counts alone do not define the availability of every topology.

PDBs constrain voluntary evictions; they do not prevent involuntary zone loss. Qualification must test both planned disruption and actual failure. [Kubernetes disruption behavior](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/)

### 9.4 Qualification run profile

Proposed initial campaign: warmup, 30 minutes at 50% peak, 60 minutes at approved mixed peak, a bounded 2× spike to verify safe shedding/recovery, and a 24-hour soak containing real-scale long sessions and scheduled jobs. Add a peak run with cold caches and one zone unavailable. Tune duration to enough samples per endpoint; do not pool all endpoints into one percentile.

Measure client-visible latency as well as server-side budgets, and include controlled timeouts/errors in reports. Test segment delivery from multiple client networks separately from backend APIs. Repeat only affected performance scenarios after fixes, keeping comparable workload seeds and infrastructure.

## 10. Deployment, backups and regional recovery

### 10.1 Environment and rollout policy

| Environment | Purpose | Required differences/constraints |
|---|---|---|
| Dev | Fast slice development | Synthetic data, reduced scale, local transport exceptions explicitly scoped to dev |
| Integration | Real cross-host contract and network behavior | At least three machines; automated deployments; isolated sandbox credentials |
| Staging | Routine release journeys | Production manifests with reduced resources; never used alone to claim zone HA |
| Qualification | HA, load and security evidence | Three real zones/racks; production security and replication; production-shaped data |
| Production | Approved user traffic | Immutable digests, restricted mutations, backups, on-call and full policy |
| DR | Warm standby | Usable control plane/identity/keys, measured replication; writers and jobs fenced until promotion |

Build once and promote the same signed image digest. Deploy external contracts/compatible consumers first, then producers and feature flags. Independent service canaries must not accidentally process the same billing command twice under separate unfenced identities; idempotency remains mandatory even during release.

All pods declare startup/readiness/liveness where applicable, memory requests/limits, CPU requests, termination grace and rollout constraints. Application shutdown stops intake, finishes or abandons work safely, flushes acknowledged state and closes consumers within the grace period. Use operator-specific checks for stateful systems instead of imposing application probe behavior blindly.

### 10.2 Store-by-store recovery obligations

| Component | Protection and recovery implementation | Evidence required |
|---|---|---|
| Catalog Write PostgreSQL | Synchronous in-region replication, base backups plus WAL/PITR, cross-region WAL/replica, CDC slot/offset recovery | Restore acknowledged titles/rights and resume/rebuild CDC with no silent gap |
| Catalog Read PostgreSQL | Backups for fast restore plus complete rebuild from owner snapshot/events | Shadow rebuild, deletion/version correctness and bounded catch-up time |
| Keycloak PostgreSQL/config | PITR, replicated realm/client configuration, recovery of signing material and external dependencies | Restored identities can authenticate; disabled accounts stay disabled |
| Billing MySQL | In-region replicated commits, binlog/PITR and cross-region replication/backup stream for every schema | Recover saga/inbox/outbox/idempotency and reconcile provider charges after restore |
| MongoDB | Majority/journal durability, continuous backup/oplog recovery and cross-region copy | Profiles, lifecycle workflow/outbox and deletion state recover coherently |
| Cassandra | RF=3 with rack awareness, tested repair/backup strategy; cross-region replication or continuous recovery feed sized to RPO | Restore all history projections/erasure state; validate consistency and missing acknowledged IDs |
| Redis session | Replicated live state plus proposed journal recovery; cache/session clusters isolated | Rebuild admission state safely; acknowledged finalizations survive cache loss |
| Redis cache | Versioned engine snapshots and refill | Cache cold-start cannot leak eligibility or overload origins |
| Neo4j | Supported Enterprise backup/DR configuration; catalog/history rebuild export | Restore/rebuild graph, recommendations and suppression state; preserve API read-only role |
| Kafka/registry/Connect | Rack replication in-region; explicit cross-region topic/config/offset/registry replication and recovery plan | Know mirrored offset watermarks; duplicates safe; compacted state and schemas survive |
| RabbitMQ | Quorum queues in-region; producer outboxes and consumer inboxes retained/recoverable in DR | Re-enqueue obligations with original IDs; recover accepted-but-unprocessed commands |
| Vault/KMS/secret store | Raft snapshots/replication as supported, separate unseal/recovery access, regional key availability | DR can decrypt data and issue identities without dependency on failed region |
| Object store/CDN | Versioned private buckets, immutable backup copies, cross-region replication, recoverable CDN/DNS config | Invoices/media/backup artifacts readable under correct auth in DR |
| Platform/observability | GitOps/IaC recovery, audit-log replication, alert routing and operator bootstrap | Recreate a cluster with authorized operator access and working monitoring |

Cross-zone replication is not a backup. Nightly backups alone do not meet a five-minute regional RPO. For each authoritative store, record the actual mechanism, maximum observed lag and alert threshold. Derived-data rebuild time still counts toward RTO if that capability is required at reopening; explicitly define permitted degraded recovery.

Financial consumers may need replay older than a topic's retention after a disaster. Keep recoverable publication obligations/financial facts beyond 24-hour outbox cleanup or implement a bounded owner-operated re-emission job. Do not rely solely on a short-lived outbox to restore seven-year financial history.

### 10.3 Regional failover runbook

1. Incident commander declares region failure, captures the last known healthy release and starts the RTO clock. Record observed replication watermarks and any known missing operations.
2. Fence the primary region's writes, billing schedulers, consumers, provider dispatch and administrative access using a mechanism independent of the failed region. Fail closed if exclusive writer ownership cannot be established.
3. Validate DR networking, DNS, KMS/Vault, certificates, clocks, operator control and capacity. Promote authoritative databases with documented store-specific procedures.
4. Recover broker topics/queues, schemas, connector state and offsets. Recreate unsent delivery obligations with original IDs; expect and tolerate duplicates.
5. Reconcile payment-provider state against restored Payment records before enabling charge/renew/refund dispatch. Restore deletion/revocation controls before access is reopened.
6. Start Keycloak and read paths, rebuild or validate catalog/cache/graph state, then start controlled writers/workers. Restore Playback's durable journal state and admission counts; force client re-admission where state cannot be trusted.
7. Run synthetic sign-in, catalog rights check, sandbox/controlled billing reconciliation, playback/media, history and invoice checks. Record degraded capabilities and their safe fallback.
8. Move DNS/global load-balancer traffic gradually, observe SLOs and broker lag, and stop the RTO clock only when the agreed user capabilities work. Compute RPO from missing acknowledged business state, not DNS cutover time.
9. Keep the former region fenced. Repair and resynchronize it, compare data and offsets, then execute planned failback under another controlled writer handover. Never reverse traffic to a stale database automatically.

Proposed drill cadence after launch: monthly sample restores; quarterly regional failover/failback; additional drills after material data/operator/key-management changes. Set backup retention and immutable-copy duration from business and security requirements, and verify usable decryption keys throughout that period.

## 11. Traceability and final readiness

### 11.1 Architecture-to-acceptance mapping

| Requirement | Source | Implemented in | Acceptance evidence |
|---|---|---|---|
| Eleven services and five assigned languages/stores | Architecture §§1, 4; plan domains | 0–7 | Eleven independent build/deploy targets and domain journeys |
| Multiple hosts/failure domains; no fixed-host dependency | Architecture §§1.1, 5.1 | 1, 6, 8, 9 | G1 cross-host trace, G6 pod-switch journey, F14/F15 |
| Database ownership and read/write exceptions | Architecture §§3, 8.1 | 1–7 | Grant-denial tests; APIs/events for cross-domain reads |
| REST/gRPC/Kafka/RabbitMQ contracts | Architecture §§6–7 | 2, 4–7 | Compatibility checks and transport-specific integration tests |
| Mandatory resource declarations/probes/shutdown | Architecture §5.6 | 1–2, 8 | Admission checks plus drain/scale-in test; CPU ambiguity resolved by ADR-02 |
| Idempotent consumers and reliable producers | Architecture §§3, 6.2, 8.2 | 2, 4–7 | F01/F02/F07/F09/F10; replay comparison by immutable IDs |
| Non-stacked retries and bounded deadlines | Architecture §6.4 | 2, 8 | Injected latency, attempt-count telemetry and retry-budget test |
| Catalog outbox, CDC and CQRS | Architecture §§8.2–8.4, 9.2 | 4 | G4 propagation/rebuild plus F06 |
| Durable saga, compensation and invoice independence | Architecture §§9.4, 1.3 D13 | 5 | G5 plus F03–F05; financial reconciliation report |
| Playback/history and recommendations | Architecture §§9.3, 8.3 | 6–7 | G6/G7; dedupe, progress and fallback evidence |
| Authorization, PCT, mTLS, signed media | Architecture §10 | 1–8 | Ownership/role tests, media bypass tests, F13 |
| Externalized rotatable secrets and validated config | Architecture §11 | 1–3, 8 | Inventory, failed-config test, live rotation and revocation evidence |
| Scale and latency targets | Architecture §2; missing §12 body | 0, 8 | Section 9 benchmark package and accepted ADR-12/13 |
| Availability and regional recovery | Architecture §§2, 5; missing §13 body | 1, 8–9 | F14/F15, timed restore/failback and missing-operation reconciliation |
| Central logs, metrics and traces | Architecture §§3, 10.8; missing §14 body | 1–9 | User-journey traces, alert injection and on-call exercise |
| CI/CD and testing | Architecture §10.7; missing §§15–16 bodies | 0–2, 8–9 | Signed release manifest, test reports, controlled rollout/revert |
| Risk and decision management | Missing §§17–18 bodies | 0–9 | ADR register, named owners, resolved blocking findings |

### 11.2 Production release checklist

- [ ] All eleven services are deployed from signed immutable images, with independent ownership and runbooks.
- [ ] Every baseline public/internal endpoint and message contract is implemented or explicitly removed through an approved scope change.
- [ ] ADR-01 through ADR-15 have recorded dispositions; required architecture amendments are committed.
- [ ] Authentication, profile ownership, parental controls, trusted region and content licensing are enforced on every relevant path and fallback.
- [ ] Catalog CDC, outbox/inbox, journal finalization, history publication and graph/trending publication survive tested crash boundaries.
- [ ] Billing ambiguities, late successes, refunds, renewals and invoice retries converge without double financial effects.
- [ ] Data ownership, workload/database/broker authorization and secret rotation are verified with negative tests.
- [ ] Real three-zone failure and realistic peak/soak tests meet the agreed SLOs or approved, explicit revised targets.
- [ ] Privacy deletion, replay suppression and restore-time erasure enforcement are demonstrated end to end.
- [ ] Per-store backups are restorable and regional recovery/failback achieves the agreed RPO/RTO with old writers fenced.
- [ ] Canary abort/revert procedures are exercised; financial and privacy state are preserved during rollback.
- [ ] Alerts, escalation, support procedures, costs, capacity limits and maintenance ownership are accepted by operations.

### 11.3 First actionable backlog

Start by creating these tickets; each is independently reviewable and unlocks later work.

| Ticket | Concrete deliverable | Depends on |
|---|---|---|
| BOOT-01 | Source inventory, compatibility matrix and ADR register | None |
| BOOT-02 | Provider/environment decision, cost/quota and Neo4j license record | BOOT-01 |
| BOOT-03 | Repository, eleven build targets and slice bootstrap | BOOT-01 |
| PLAT-01 | IaC network/three-host integration cluster with encrypted storage | BOOT-02 |
| PLAT-02 | Gateway/mesh/identity/secrets skeleton and deny-by-default policy | PLAT-01 |
| CONTRACT-01 | OpenAPI/gRPC/event inventory plus auth and idempotency fixtures | BOOT-03 |
| SPIKE-01 | Playback journal, Redis crash/failover and stream-limit decision | CONTRACT-01; replicated Kafka/Redis test tier |
| SPIKE-02 | Cassandra write → Kafka transaction/offset fault-injection prototype | CONTRACT-01; Cassandra/Kafka test tier |
| SPIKE-03 | Payment uncertain-outcome and late-refund sandbox prototype | Provider sandbox; CONTRACT-01 |
| ID-01 | Profile create/select with ownership, concurrency and PCT tests | PLAT-02 + CONTRACT-01 |
| CAT-01 | Title write/outbox → Debezium → versioned read projection | PLAT-02 + CONTRACT-01 |
| OPS-01 | First backup restore, cross-host trace and alert exercise | PLAT-02 + first data service |

SPIKE-01/02 should happen early because their outcome changes latency, storage and recovery sizing. Their gates remain part of Phase 6 even if the prototypes begin during foundation work.

### 11.4 Source provenance

This document was prepared from the two supplied files, not from a repository implementation or a running environment. No application, deployment or production test is claimed complete.

| Input | SHA-256 |
|---|---|
| `plan.md` | `2247CCDB9C20711F8ADC46190CF7E00C6917C5AB1351BEA2F2208A9A89F2B810` |
| `architecture.md` | `F3B2BD4E55B1F3C5B365D2DDFB1D036354A46CC8F34BAD32A92EBCBF91295575` |

Primary technical references are linked beside the relevant implementation findings. Version selection remains an explicit Phase 0 task; source examples are not treated as verified current-version installation instructions.
