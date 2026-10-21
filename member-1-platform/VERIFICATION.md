# Verification — 2026-10-02

## Streaming UI and Markdown API documentation — 2026-10-11

This is the current record; the October 10 console/explorer and Docker limitations below are historical.

- Replaced the main developer console with a responsive streaming UI: cinematic hero/original artwork, title cards, search/genre filters, My list, recommendations, History/continue watching, account/profile and membership dialogs, invoices, admin demo publishing and playback controls. Native HLS is browser-dependent; checkpoints run every 25 seconds only while native video plays. External-player/manual progress and session resume controls remain available.
- API documentation is **API_REFERENCE.md**, with all eleven service addresses, public/private paths, authentication, request examples, health/framework endpoints and manual testing instructions. Removed the `/docs` page and its navigation/explorer. Optional raw OpenAPI JSON remains for API clients.
- **9 Node tests passed**, including every implemented path/address appearing in Markdown, source-declared route coverage, static/artwork serving, removed `/docs`, private-route/Origin/Host restrictions, auth/header/PDF forwarding and readiness/outage handling. **5 existing Python tests passed**. JavaScript syntax, workspace checks and Compose config validation passed.
- Real headless Chrome loaded the page without JavaScript exceptions. A browser journey with isolated API fixtures passed sign-in/profile selection, catalog/genre filters, save/remove watchlist, membership, playback checkpoint/minimise/resume/stop and continue watching. Desktop (1440px) and mobile (390px) screenshots were inspected; mobile had no horizontal overflow. Corrected search wrapping and recommendation-note placement. Test fixtures did not create live backend records. Browser processes closed after checks; screenshots/scripts remain in ignored `.local/`.
- Docker Client/Server 29.6.1 now respond. All application Docker images built, all service containers started, and Mongo/Kafka initialization completed. RabbitMQ initially failed on a root-owned mode-400 `.erlang.cookie`; corrected that existing runtime file to rabbitmq ownership (UID 100/GID 101), preserving its value and data. Infrastructure probes subsequently became healthy.
- Docker Desktop startup repeatedly failed on stale Inference/Secrets Engine runtime sockets. Preserved runtime-only folders as `%LOCALAPPDATA%/Docker/run-backup-20261011-101740`, `run-backup-20261011-101931` and `%LOCALAPPDATA%/docker-secrets-engine-backup-20261011-101931`. No Docker data reset, volume removal or image deletion was performed. A reset recorded by Docker removed the prior DNS override; restored `dns: ["1.1.1.1"]` after demonstrating default resolver failure and explicit resolver success. Current pre-change engine config backup is `.local/docker-daemon-before-dns-20261011-101615.json`; a fresh default container then resolved the npm registry. This is a workstation-wide local DNS workaround, not a project requirement.
- Real Keycloak discovery, password grant, frontend login and authenticated profile listing passed; tokens/passwords stayed in memory and were not printed. The local login proxy allows 45 seconds (browser 60 seconds) for identity verification; business requests retain their shorter bounds. The live alice profile list was empty. No synthetic titles or subscriptions were created in the live UI check.
- **The live end-to-end journey has not passed.** Subscription/Payment/Invoice repeatedly fail on a whitespace-only migration statement. Catalog relay fails because direct store-field access sees a null JDBC field on a Spring proxy; catalog ready probes returned 401 during the error path. See **INTEGRATION_BLOCKERS.md** for evidence and owner fix requests. Full smoke was not run because these known business failures prevent the journey.

Changes remain in Member 1/root integration files on a Member 1 working branch. Other members' code/manifests/migrations were read for diagnosis only. No commit, push or production qualification is claimed. The authorized Compose frontend remains available at http://localhost:8090.

## Frontend/API documentation verification — 2026-10-10

Added a Member 1 local developer frontend and API explorer, authored HTTP v1 definitions, complete route reference and Compose wiring on a Member 1 working branch. No other member's code, dependency manifests or migrations were changed.

- **8 new Node tests passed**: eleven OpenAPI service documents and references/path parameters; route coverage against declared Fastify/FastAPI/Spring/ASP.NET/Go routes; static/document HTTP serving; auth/ETag/binary proxy forwarding; internal-route/method/origin/Host restrictions; local login; per-service readiness failures; upstream outage and payload size handling.
- **5 existing platform Python tests passed**. Workspace validation, Node syntax checks and Compose config validation passed. Mock-upstream tests do not establish real service/database integration.
- Contracts document **85 HTTP operations**, including **44 public operations across 33 public paths** and private health, workload and framework routes. Internal endpoints remain inaccessible through the frontend/gateway.
- The host Node server started successfully. The real `/` page returned HTTP 200. Tests fetched `/docs`, assets, and all public/per-service OpenAPI documents successfully. The temporary host preview was stopped after verification; start it using `node member-1-platform/frontend/server.mjs`.
- Browser automation could not start because the Windows sandbox helper failed before browser inspection. Visual/interactive browser verification was not completed.
- Docker listed only a standalone Kong container on port 8000; the `streaming-local` Compose project had no containers. The configured gateway localhost:8080 and Keycloak localhost:8081 were unreachable. Consequently the real-stack smoke test and manual login-to-playback journey were **not run**.
- The frontend Node Docker image was absent. An attempted pull of `node:22.14.0-alpine` failed with Docker Hub registry `context deadline exceeded`; container startup was not verified. Host Node startup requires no dependency download. Compose configuration was validated, and its frontend service can be started after registry access works.

The earlier service-build results below are historical and were not rerun for this change. No production qualification, real provider integration or end-to-end success is claimed. No commit or push was made.

## Earlier service-build verification

The following checks were executed on this Windows workstation. They verify source/build behavior, not production readiness.

| Area | Executed check | Result |
|---|---|---|
| Platform | Ownership/contract unit tests | 5 passed |
| Workspace | Five owners, eleven service declarations, unique ports, JSON/XML/Python parsing | Passed |
| Compose | `docker compose --env-file .local/dev.env -f member-1-platform/compose.yaml config --quiet` | Passed |
| Profile/Watchlist | `npm run build` and `npm test` | TypeScript compiled; 3 tests passed |
| Recommendations | Python API/ranking tests in isolated environment | 6 passed |
| Python packages | `pip check` | No broken requirements |
| Catalog | Maven `verify` | Packaged successfully; 2 tests passed |
| Billing | `dotnet test` and Release `dotnet publish` | 5 tests passed; publish succeeded |
| Playback/History | `go test ./...` and `go vet ./...` | Compiled; 3 tests passed; vet passed |
| Secrets/artifacts | `git check-ignore` on local credentials and build/dependency directories | Ignored as intended |

**Total: 24 passing tests.** Policy tests and API tests with mocked dependencies do not establish real database/broker integration correctness.

## Not executed

- Docker image builds and container startup.
- Full synthetic end-to-end smoke test against real local stores/brokers.
- Real MongoDB transaction races, RabbitMQ delivery failure, Kafka/Cassandra replay or Neo4j integration tests.
- HA, load, security, backup/restore and DR qualification from the original plan.

The Docker CLI is installed, but its Linux engine did not become available after attempted startup. `docker info` reported that `dockerDesktopLinuxEngine` could not be found. The Docker service was stopped. No destructive Docker reset or data-volume removal was performed.

## Next integration check

Start Docker Desktop successfully with its Linux engine, then from the project folder:

```powershell
docker compose --env-file .local/dev.env -f member-1-platform/compose.yaml up --build -d
python member-1-platform/tests/smoke.py
```

The smoke test creates synthetic profiles/titles/subscriptions, tests duplicate requests and cross-account rejection, checks asynchronous payment/history/invoice convergence, and cleans up its active profile/title/subscription records. It retains sandbox financial history by design. Run against this local stack only.

## Toolchain and hosting notes

- Go and .NET SDKs were downloaded from official release endpoints, checksum-verified, and extracted into ignored `.local/tools/` for checks. No system PATH changes were made.
- Python recommendation dependencies were installed into ignored `.local/python-env/`.
- Node dependencies are member-local; Maven used the available Maven installation.
- All changes are local. No commit, push, repository creation, pull request or branch-protection change was made.
- CI/CODEOWNERS files are installation templates under `member-1-platform/github/`. They are not active GitHub policy until installed at the actual Git root with real owner handles.
