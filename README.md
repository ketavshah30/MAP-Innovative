# Content streaming platform — five-member workspace

Eleven backend service build targets are divided among five owners. This checkout targets **local Docker development with a payment sandbox**. Read [implementation status](IMPLEMENTATION_STATUS.md) before using it outside a developer machine.

| Owner | Folder | Work |
|---|---|---|
| Member 1 | [member-1-platform](member-1-platform/README.md) | Compose, contracts, integration checks, identity and shared infrastructure |
| Member 2 | [member-2-personalization](member-2-personalization/README.md) | Node/TypeScript Profile + Watchlist; Python Recommendation Engine + API |
| Member 3 | [member-3-catalog](member-3-catalog/README.md) | Java Catalog Write + Read |
| Member 4 | [member-4-billing](member-4-billing/README.md) | C# Subscription + Payment + Invoice |
| Member 5 | [member-5-playback](member-5-playback/README.md) | Go Playback Session + Watch History |

## Local startup

The **streaming UI** is at **http://localhost:8090**, with Discover, My list, History, profiles, membership and playback controls. API documentation is a Markdown file: [API_REFERENCE.md](member-1-platform/API_REFERENCE.md), covering all eleven services, public/private paths, authentication and request examples.

Requirements: Docker Desktop with Linux containers and Compose, Python 3.12+ and Node 22+ for bootstrap. Allow sufficient Docker memory for the databases and Kafka; start with 12 GB. All published ports bind to loopback.

```powershell
node member-1-platform/tools/bootstrap.mjs
docker compose --env-file .local/dev.env -f member-1-platform/compose.yaml up --build -d
python member-1-platform/tests/smoke.py
```

Bootstrap creates local development keys and passwords under ignored `.local/`. Re-running it preserves existing credentials. Keycloak is available at http://localhost:8081; the API gateway is http://localhost:8080. The local users `alice`, `bob` and `admin` use `DEV_PASSWORD` from `.local/dev.env`. Only `admin` has the catalog administrator role.

Current live limitations: login/profile reads pass, but catalog and billing contain startup/runtime defects that block the complete viewing journey. See [integration blockers](member-1-platform/INTEGRATION_BLOCKERS.md) and [checks actually executed](member-1-platform/VERIFICATION.md).

Open http://localhost:8090 and use Sign in to choose an account and profile. Discover provides title cards, search and genre filters; My list and History use the selected profile. Account contains membership plans, invoices and admin demo publishing. Connection details contains optional service probes and the last API response. Choose a sandbox plan and wait for ACTIVE before clicking Watch. Native HLS playback depends on browser support; manual progress controls and signed media links are also available. Generate demo media using `member-1-platform/tools/make-demo-media.ps1` (requires FFmpeg). No titles or subscriptions are created automatically.

If this Compose stack is already running, add only its new frontend service:

```powershell
docker compose --env-file .local/dev.env -f member-1-platform/compose.yaml up -d --no-deps frontend
```

For a frontend running directly on the host, with gateway and Keycloak already reachable on the ports above:

```powershell
node member-1-platform/frontend/server.mjs
```

Host mode supports the streaming UI through the gateway. Its per-service readiness probes require directly exposed localhost service ports; the standard Compose stack keeps these private, so use the Compose frontend to check all eleven services. OpenAPI JSON is available at http://localhost:8090/openapi/public.json and `/openapi/<service-name>.json`. No npm installation or frontend build is required.

```powershell
docker compose --env-file .local/dev.env -f member-1-platform/compose.yaml logs -f
docker compose --env-file .local/dev.env -f member-1-platform/compose.yaml down
```

`down` preserves named data volumes. Do not use `down -v` unless you deliberately want to erase local data.

### Docker Desktop engine errors

If Compose reports `500 Internal Server Error` for `dockerDesktopLinuxEngine/.../images/.../json`, check Docker itself before investigating the named application. `docker version` must show both Client and Server, and `docker info` must succeed. An image-inspection error happens before application startup; the service name in that error does not identify an application-code failure.

For the local engine failure reproduced on this workstation, a normal Docker Desktop restart restored access:

```powershell
docker desktop restart --timeout 60
docker version
docker info
docker compose --env-file .local/dev.env -f member-1-platform/compose.yaml up --build -d
```

Wait for Docker Desktop's engine to finish starting before retrying. If the restart command times out, check the app's engine status before retrying `docker info`. If the CLI's Desktop command is unavailable, use Docker Desktop's Troubleshoot → Restart Docker Desktop. A healthy engine does not guarantee image registry/network access; image-download failures are a separate startup issue.

References: [Docker Desktop restart](https://docs.docker.com/reference/cli/docker/desktop/restart/) and [Engine API negotiation](https://docs.docker.com/reference/api/engine/). Do not force a guessed API version: `DOCKER_API_VERSION` disables normal negotiation. No override was needed for this workstation's matching client/server versions.

If the engine is healthy but downloads fail with `auth.docker.io` TLS handshake timeouts, retry registry downloads sequentially to reduce simultaneous connections:

```powershell
docker compose --parallel 1 --env-file .local/dev.env -f member-1-platform/compose.yaml pull --ignore-buildable
docker compose --parallel 1 --env-file .local/dev.env -f member-1-platform/compose.yaml up --build -d
```

If even a single image fails, inspect Docker Desktop's proxy/network settings and connectivity to Docker Hub. Host HTTPS connectivity and Docker-engine registry connectivity can differ. See [Compose parallelism](https://docs.docker.com/reference/cli/docker/compose/#configuring-parallelism).

If a container reports `bad address` or `EAI_AGAIN` while Windows resolves the same public hostname, test an appropriate DNS server in a disposable cached container first, for example:

```powershell
docker run --rm --pull=never --dns 1.1.1.1 alpine:latest nslookup auth.docker.io
```

If the explicit resolver works, back up the existing Docker Engine JSON configuration, preserve its other keys, and add `"dns": ["1.1.1.1"]` using Docker Desktop Settings → Docker Engine. Use a resolver appropriate to your network. Restart Docker Desktop, then verify lookup from a new container without `--dns`. This setting applies to Docker containers/builds; the specific public resolver here is a tested local workaround, not a required application dependency. The Desktop engine configuration is documented at [Docker Engine settings](https://docs.docker.com/desktop/settings-and-maintenance/settings/#docker-engine).

## Working without overlapping edits

Read [CONTRIBUTING.md](CONTRIBUTING.md). Each member changes only their own folder. Member 1 merges shared-contract and Compose changes. Independent lockfiles, Dockerfiles and migrations prevent routine edits from touching the same files.

This is the repository root. Stage only the files for your change, and avoid copying another member's complete checkout over the shared repository. GitHub automation must live at the repository root; see the installation instructions in Member 1's folder.

## Specification

- [Original implementation plan](implementation.md)
- [Team responsibilities](TEAM_IMPLEMENTATION_PLAN.md)
- [Current implementation and remaining work](IMPLEMENTATION_STATUS.md)

The original plan's production gates, provider integrations and distributed durability guarantees are separate from the local demonstration.

## Architecture Diagram

This document describes the current local-development architecture of the streaming and recommendation platform. It shows the main service boundaries, storage ownership, and event flows; it is not a diagram of planned production infrastructure.

### Application Architecture

<!-- mermaid-checked: no \n, no em-dash/en-dash, no {} in labels, subgraphs are id["label"], arrows are -->|"label"|, all subgraphs closed by end, ids unique -->
~~~mermaid
flowchart TD
    subgraph UserLayer["Client"]
        Browser["Browser"]
    end
    subgraph EntryLayer["Entry and Identity"]
        Frontend["Streaming UI and proxy"]
        Gateway["Kong gateway"]
        Identity["Keycloak"]
    end
    subgraph DomainLayer["Application Domains"]
        Personalization["Profiles, watchlist, recommendations"]
        Catalog["Catalog write and read"]
        Billing["Subscription, payment, invoice"]
        Playback["Playback and watch history"]
    end
    subgraph DataLayer["Data by Domain"]
        ProfileData[("MongoDB profile and watchlist")]
        CatalogData[("PostgreSQL catalog")]
        BillingData[("MySQL billing")]
        RecommendationData[("Neo4j and Redis recommendations")]
        PlaybackData[("Redis sessions and Cassandra history")]
        MediaData[("Local HLS media")]
    end
    subgraph BrokerLayer["Messaging"]
        Kafka["Kafka events"]
        Rabbit["RabbitMQ billing commands"]
    end

    Browser -->|"uses"| Frontend
    Frontend -->|"sign in"| Identity
    Frontend -->|"API requests"| Gateway
    Gateway --> Personalization
    Gateway --> Catalog
    Gateway --> Billing
    Gateway --> Playback
    Personalization -->|"profile and list data"| ProfileData
    Personalization -->|"ranking signals"| RecommendationData
    Catalog -->|"title metadata"| CatalogData
    Billing -->|"billing records"| BillingData
    Playback -->|"session and history data"| PlaybackData
    Playback -->|"streams files"| MediaData
    Catalog -->|"title events"| Kafka
    Playback -->|"viewing events"| Kafka
    Kafka -->|"updates ranking"| Personalization
    Billing -->|"billing workflow"| Rabbit
~~~

#### Technology Stack Summary

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Web UI and local proxy | JavaScript on Node.js | Node 22.14.0 image | Serves the streaming UI and forwards documented API requests |
| API entry | Kong | 3.9.0 image | Routes public API paths to private services |
| Identity | Keycloak | 26.1.4 image | Local login and role-based access tokens |
| Profile and watchlist | TypeScript, Fastify, MongoDB | Node 22; Fastify 5.2.1; MongoDB 7.0.17 | Accounts, profiles, profile policy, and saved titles |
| Recommendations | Python, FastAPI, Neo4j, Redis | FastAPI 0.115.8; Neo4j 5.26.3; Redis 7.4.2 | Ranking, graph-based viewing signals, and short-lived fallback snapshots |
| Catalog | Java 21, Spring Boot, PostgreSQL | Spring Boot 3.4.3; PostgreSQL 16.8 | Admin-managed title metadata and browse/search projection |
| Billing | C#, ASP.NET Core, MySQL | .NET 8; MySQL 8.4.4 | Subscriptions, simulated payments, and invoices |
| Playback and history | Go, Redis, Cassandra | Go 1.23; Redis 7.4.2; Cassandra 5.0.3 | Session admission and state, playback progress, and viewing history |
| Event transport | Apache Kafka | 3.9.0 image | Catalog, profile, playback, history, and billing events |
| Billing command transport | RabbitMQ | 4.0.7 image | Asynchronous payment commands and results |
| Media delivery | Local HLS files through Playback | Local development | Signed manifest and segment delivery; no production CDN |

Versions above describe the local Compose image tags or direct application dependencies inspected for this diagram. They are not a production support or security certification.

#### Data Storage & External Services

Each service owns its data and accesses it through its own database: Profile and Watchlist use separate MongoDB databases; Catalog Write and Catalog Read use separate PostgreSQL databases; Subscription, Payment, and Invoice use separate MySQL databases; Playback uses Redis for session state; Watch History uses Cassandra; and Recommendations uses Neo4j with Redis for cached snapshots. Kafka carries asynchronous domain events and RabbitMQ carries billing workflow commands. Keycloak provides local identity. HLS media is currently read from a local media directory mounted into Playback. Admin catalog publishing stores metadata and an asset path, not the video upload itself.

#### Key Architectural Decisions

- Services are divided by domain and own their persistence; other services communicate through HTTP contracts or brokered events rather than directly accessing another service's database.
- Catalog Write publishes changes through an outbox; Catalog Read and Recommendations consume catalog events, while viewing-history events influence ranking.
- This checkout targets local development. The payment provider is simulated, media uses local files and signed URLs, and production CDN, DRM, HA, and workload identity are not implemented.

### Component Relationships

The overview above groups services by domain so the main platform boundaries are visible at a glance. These focused diagrams show the internal service and storage relationships. Arrows represent the current local implementation, not planned production integrations.

#### Catalog and Recommendations

<!-- mermaid-checked: no \n, no em-dash/en-dash, no {} in labels, subgraphs are id["label"], arrows are -->|"label"|, all subgraphs closed by end, ids unique -->
~~~mermaid
flowchart LR
    subgraph ccatServices["Catalog and Personalization"]
        ccatWrite["Catalog Write"]
        ccatRead["Catalog Read"]
        ccatProfile["Profile"]
        ccatRecoAPI["Recommendation API"]
        ccatEngine["Recommendation engine"]
    end
    subgraph ccatStores["Owned Stores"]
        ccatPostgresWrite[("PostgreSQL write")]
        ccatPostgresRead[("PostgreSQL read")]
        ccatMongo[("MongoDB profile")]
        ccatNeo4j[("Neo4j graph")]
        ccatRedis[("Redis cache")]
    end
    ccatKafka["Kafka"]

    ccatWrite -->|"metadata and outbox"| ccatPostgresWrite
    ccatWrite -->|"title events"| ccatKafka
    ccatKafka -->|"projection events"| ccatRead
    ccatRead -->|"reads projection"| ccatPostgresRead
    ccatProfile -->|"profile data"| ccatMongo
    ccatProfile -->|"lifecycle events"| ccatKafka
    ccatKafka -->|"catalog and watch events"| ccatEngine
    ccatEngine -->|"updates viewing graph"| ccatNeo4j
    ccatEngine -->|"publishes snapshot"| ccatRedis
    ccatRecoAPI -->|"reads ranking signals"| ccatNeo4j
    ccatRecoAPI -->|"fallback snapshot"| ccatRedis
    ccatRecoAPI -->|"filters eligible titles"| ccatRead
    ccatRecoAPI -->|"validates profile"| ccatProfile
~~~

#### Billing

<!-- mermaid-checked: no \n, no em-dash/en-dash, no {} in labels, subgraphs are id["label"], arrows are -->|"label"|, all subgraphs closed by end, ids unique -->
~~~mermaid
flowchart LR
    subgraph cbillServices["Billing Services"]
        cbillSubscription["Subscription"]
        cbillPayment["Payment"]
        cbillInvoice["Invoice"]
    end
    subgraph cbillStores["Owned Stores"]
        cbillMysqlSubscription[("MySQL subscription")]
        cbillMysqlPayment[("MySQL payment")]
        cbillMysqlInvoice[("MySQL invoice")]
    end
    cbillRabbit["RabbitMQ"]
    cbillKafka["Kafka"]

    cbillSubscription -->|"stores membership"| cbillMysqlSubscription
    cbillPayment -->|"stores payment state"| cbillMysqlPayment
    cbillInvoice -->|"stores invoice records"| cbillMysqlInvoice
    cbillSubscription -->|"payment command"| cbillRabbit
    cbillRabbit -->|"command"| cbillPayment
    cbillPayment -->|"payment result"| cbillRabbit
    cbillRabbit -->|"result"| cbillSubscription
    cbillPayment -->|"billing events"| cbillKafka
~~~

#### Playback and Watch History

<!-- mermaid-checked: no \n, no em-dash/en-dash, no {} in labels, subgraphs are id["label"], arrows are -->|"label"|, all subgraphs closed by end, ids unique -->
~~~mermaid
flowchart LR
    subgraph cplayServices["Playback Services"]
        cplayProfile["Profile"]
        cplayCatalog["Catalog Write"]
        cplaySubscription["Subscription"]
        cplayPlayback["Playback Session"]
        cplayHistory["Watch History"]
    end
    subgraph cplayStores["Owned Stores and Media"]
        cplayRedis[("Redis sessions")]
        cplayCassandra[("Cassandra history")]
        cplayMedia[("Local HLS files")]
    end
    cplayKafka["Kafka"]

    cplayPlayback -->|"validates profile"| cplayProfile
    cplayPlayback -->|"checks rights"| cplayCatalog
    cplayPlayback -->|"checks entitlement"| cplaySubscription
    cplayPlayback -->|"stores sessions"| cplayRedis
    cplayPlayback -->|"serves signed media"| cplayMedia
    cplayPlayback -->|"session events"| cplayKafka
    cplayKafka -->|"ended sessions"| cplayHistory
    cplayHistory -->|"stores history and progress"| cplayCassandra
    cplayHistory -->|"publishes viewing signals"| cplayKafka
~~~

#### Component Inventory

| Component | Layer | Type | Responsibility |
|---|---|---|---|
| Browser UI | Presentation | Web application | Profile selection, discovery, watchlist, playback controls, and account views |
| Node UI and API proxy | Presentation | Node.js development server | Serves static UI files and proxies documented requests to Kong |
| Kong gateway | Entry | API gateway | Routes public HTTP paths to service containers |
| Keycloak | Identity | Identity provider | Issues local account access tokens and admin role claims |
| Profile | Domain service | Fastify API | Account/profile lifecycle, profile policy tokens, and profile context |
| Watchlist | Domain service | Fastify API | Adds, lists, and removes profile-owned title references |
| Recommendation API | Domain service | FastAPI API | Ranks title IDs and returns currently eligible catalog titles |
| Recommendation engine | Domain service | Kafka consumer and job API | Ingests title, lifecycle, and viewing events into Neo4j |
| Catalog Write | Domain service | Spring Boot API | Validates admin catalog changes and writes title metadata plus outbox events |
| Catalog Read | Domain service | Spring Boot API and event consumer | Builds the read projection and serves browse, search, and eligibility checks |
| Subscription | Domain service | ASP.NET Core API and queue consumer | Manages plan membership and entitlement state |
| Payment | Domain service | ASP.NET Core API and queue consumer | Runs local simulated payment operations and emits results |
| Invoice | Domain service | ASP.NET Core API and queue consumer | Stores invoice records and produces local sandbox PDFs |
| Playback Session | Domain service | Go API and worker | Validates entitlement and rights, maintains sessions, and serves signed HLS media |
| Watch History | Domain service | Go API and Kafka consumer | Persists history/progress and publishes viewing signals |
| MongoDB profile | Data | Document database | Stores account and profile documents |
| MongoDB watchlist | Data | Document database | Stores saved-title entries |
| PostgreSQL write and read | Data | Relational databases | Stores authoritative catalog metadata/outbox and the separate read projection |
| MySQL billing stores | Data | Relational databases | Isolated subscription, payment, and invoice records |
| Neo4j and Redis cache | Data | Graph database and cache | Stores recommendation relationships and recent fallback snapshots |
| Redis sessions | Data | Key-value store | Tracks active playback state and concurrent stream slots |
| Cassandra history | Data | Wide-column database | Stores viewing events, continue-watching progress, and suppression state |
| Kafka and RabbitMQ | Messaging | Event broker and command queue | Distributes domain events and billing workflow messages |
| Local HLS files | Media | Mounted filesystem | Supplies manifests and segments to the local Playback service |
