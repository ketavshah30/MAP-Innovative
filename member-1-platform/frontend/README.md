# Streaming frontend

Open **http://localhost:8090** after starting the Compose stack. The main page is a responsive streaming UI with a cinematic hero, catalog cards, search/genre filters, My list, recommendations and History/continue watching.

**API documentation is [API_REFERENCE.md](../API_REFERENCE.md)**. It lists every implemented public/private route for all eleven services, authentication, request bodies and PowerShell examples. There is no documentation webpage or API explorer.

## Use the UI

1. Open Sign in. Choose alice, bob or admin and use DEV_PASSWORD from ignored `.local/dev.env`.
2. Create/select a profile. Discover loads its eligible catalog and recommendations. Search calls the catalog API; genre filters apply to the loaded collection (up to 100 titles).
3. For an empty local catalog, sign in as admin and use Account → Publish demo title. Refresh Discover after its projection catches up.
4. Account → View plans → Choose a plan creates a simulated subscription. Refresh membership until ACTIVE. Invoices can be downloaded as PDFs.
5. Add a title to My list, or click Watch to admit a playback session. Native HLS is used when the browser supports it; otherwise open the signed link in an HLS player and use Save progress manually. Generate demo media files separately with `tools/make-demo-media.ps1`.
6. Native video saves progress every 25 seconds while playing. Manual/external playback requires a checkpoint within 90 seconds. Minimise pauses native video but retains the active session; the Player button can reopen controls. End session before changing profiles/accounts. Refresh History after its event arrives.
7. Account → Connection details has optional service probes and the latest redacted API response. These probes do not prove cross-service correctness.

Original decorative landscape artwork represents catalog titles; the current catalog model has no poster-image fields. No fake titles or results are inserted into the live UI. Billing is simulated. No automatic demo publishing or subscription creation happens on page load.

## Start

```powershell
docker compose --env-file .local/dev.env -f member-1-platform/compose.yaml up -d --no-deps frontend
```

This starts only the frontend; gateway/Keycloak/application services must already be running for account and collection actions. If you edit `server.mjs`, restart this container. Static HTML/CSS/JS/artwork are read from the mounted files.

Host alternative, with Node 22+:

```powershell
node member-1-platform/frontend/server.mjs
```

Host binds 127.0.0.1; the published Compose port binds loopback. API_GATEWAY/IDENTITY_URL default to localhost:8080/8081 on the host and Compose DNS names in Docker. Private service probes work from the Compose frontend, not standard host mode.

The server forwards only documented public method/path pairs and credential/version/idempotency headers. Internal routes and workload keys never reach the browser. Mutations require the frontend Origin. Login uses the fixed local Keycloak client, with explicitly supplied credentials; no credentials are read from disk. Tokens stay in page memory. Reload requires signing in again; active sessions can be resumed from Player → Active sessions after profile selection.

Optional raw OpenAPI JSON remains at `/openapi/public.json` and `/openapi/<service-name>.json` for API clients. Human-readable documentation is the Markdown file.

## Verification

```powershell
node --test member-1-platform/tests/frontend.test.mjs
python member-1-platform/tests/smoke.py
```

Node tests use mock upstreams. Smoke requires the real stack and modifies synthetic local data, including cancelling alice's existing ACTIVE/PENDING subscriptions. Local tests do not establish production readiness.
