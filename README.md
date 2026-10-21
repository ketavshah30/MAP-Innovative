# Content streaming platform — five-member workspace

> **Staged upload:** This repository currently contains shared project files and the folders for Members 1, 4 and 5. Members 2 and 3 will add their folders separately. The complete Compose stack and full workspace checks are unavailable until those folders are present.

Eleven backend service build targets are divided among five owners. This checkout targets **local Docker development with a payment sandbox**. Read [implementation status](IMPLEMENTATION_STATUS.md) before using it outside a developer machine.

| Owner | Folder | Work |
|---|---|---|
| Member 1 | [member-1-platform](member-1-platform/README.md) | Compose, contracts, integration checks, identity and shared infrastructure |
| Member 2 | `member-2-personalization` (pending upload) | Node/TypeScript Profile + Watchlist; Python Recommendation Engine + API |
| Member 3 | `member-3-catalog` (pending upload) | Java Catalog Write + Read |
| Member 4 | [member-4-billing](member-4-billing/README.md) | C# Subscription + Payment + Invoice |
| Member 5 | `member-5-playback` (pending upload) | Go Playback Session + Watch History |

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

This folder is currently inside a larger Git repository. From this folder, stage only the intended paths, for example `git add member-3-catalog`. Do not run `git add ..` or copy another member's complete checkout over your own. GitHub automation must live at the actual repository root; see the installation instructions in Member 1's folder.

## Specification

- [Original implementation plan](implementation.md)
- [Team responsibilities](TEAM_IMPLEMENTATION_PLAN.md)
- [Current implementation and remaining work](IMPLEMENTATION_STATUS.md)

The original plan's production gates, provider integrations and distributed durability guarantees are separate from the local demonstration.
