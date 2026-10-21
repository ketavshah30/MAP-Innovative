# API documentation — local HTTP v1

This Markdown file is the API documentation for all eleven application services. Public requests go through Kong at `http://localhost:8080`. The streaming UI is at `http://localhost:8090`; there is no documentation webpage. Use PowerShell, curl or Postman for API testing.

| Service | Owner | Private Docker address | Purpose |
|---|---|---|---|
| Profile | Member 2 | `http://profile:8011` | Accounts, profiles and profile tokens |
| Watchlist | Member 2 | `http://watchlist:8012` | Saved titles |
| Recommendation Engine | Member 2 | `http://reco-engine:8013` | Internal ranking jobs |
| Recommendation API | Member 2 | `http://reco-api:8014` | Personalised discovery |
| Catalog Write | Member 3 | `http://catalog-write:8021` | Admin title management |
| Catalog Read | Member 3 | `http://catalog-read:8022` | Eligible browse and search |
| Subscription | Member 4 | `http://subscription:8031` | Plans, memberships and entitlement |
| Payment | Member 4 | `http://payment:8032` | Simulated payments |
| Invoice | Member 4 | `http://invoice:8033` | Invoice records and PDFs |
| Playback Session | Member 5 | `http://playback-session:8041` | Admission, checkpoints and signed media |
| Watch History | Member 5 | `http://watch-history:8042` | History and continue watching |

The private ports above are not published on localhost. Use the gateway for public paths and an HTTP client inside the Compose network for private paths. Every implemented method/path is listed below, including private probes and framework endpoints.

Machine-readable **OpenAPI 3.1** documents are served at `/openapi/public.json` and `/openapi/<service-name>.json` on the frontend. All eleven service documents include private health and internal routes where implemented. The authored definitions live in `contracts/http.v1.mjs`; documents are assembled in memory, with no generated files to commit. Import these URLs into a compatible API client or save their JSON for offline use.

## Authentication and conventions

| Label | Required credentials |
|---|---|
| Public | None |
| Account | `Authorization: Bearer <access-token>` |
| Profile | Account token plus `X-Profile-Token: <PCT>` |
| Admin | Account token with `catalog-admin` in `realm_access.roles` |
| Workload | `X-Service-Key`, plus account/profile tokens where specified |
| Signed | Exact `expires` and `signature` query values returned by Playback |

Sign in as `alice`, `bob` or `admin`, using `DEV_PASSWORD` from ignored `.local/dev.env`. Only admin can write the catalog. The UI proxies the local Keycloak password grant to the fixed public client `streaming`, stores tokens only in page memory and automatically obtains/reissues the five-minute profile token when needed. Access-token expiry requires signing in again. Reloading the page clears identity; no browser storage is used.

For an external API client, obtain an access token using **POST** `http://localhost:8081/realms/streaming/protocol/openid-connect/token`, with form fields `grant_type=password`, `client_id=streaming`, `username` and `password`. Select a profile with **POST** `/profiles/{id}/select`, authenticated with that access token. Copy response `token` into `X-Profile-Token`. An access token and PCT must belong to the same account. Reselect after profile-policy changes. Never publish credentials or keys.

All JSON uses camelCase. Currency amounts use integer minor units. Times use UTC RFC3339. URL-encode path IDs (invoice/payment IDs can contain colons). Unless listed otherwise, successful requests return 200. Error bodies vary between Fastify, Spring, ASP.NET, FastAPI and Go; inspect both HTTP status and body. Relevant failures include 400/422 for validation, 401/403 for token/policy/role rejection, 404 for absent or inaccessible resources, 409 for state/idempotency conflicts and 503 for unavailable dependencies. Gateway/proxy errors may also return 502.

## Public service routes

### Profile — member 2, port 8011

| Method | Path | Auth | Behavior |
|---|---|---|---|
| GET | `/accounts/me` | Account | Bootstrap/read account; id, profileCount, version |
| DELETE | `/accounts/me` | Account | Disable account and delete its profiles; 202 |
| GET | `/profiles` | Account | List owned profiles |
| POST | `/profiles` | Account | Create profile with `{name,maturity}`; 201; maximum five |
| GET | `/profiles/{id}` | Account | Read owned profile |
| PATCH | `/profiles/{id}` | Account | Both name and maturity required; raising maturity requires MFA |
| DELETE | `/profiles/{id}` | Account | Delete owned profile; 204 |
| POST | `/profiles/{id}/select` | Account | Issue `{token,expiresIn:300}` |

Profile names must be nonblank, maximum 80 characters; maturity is an integer 0–18. Other fields are rejected. Account deletion is a state-changing operation, and privacy acknowledgments remain unfinished.

### Watchlist — member 2, port 8012

| Method | Path | Auth | Behavior |
|---|---|---|---|
| GET | `/watchlist` | Profile | List entries; limit 1–100 (default 20), offset 0–10000 |
| PUT | `/watchlist/titles/{id}` | Profile | Add eligible title, repeated calls deduplicated; 204 |
| DELETE | `/watchlist/titles/{id}` | Profile | Remove entry idempotently; 204 |
| HEAD | `/watchlist/titles/{id}` | Profile | Membership; 200 present, 404 absent |

### Recommendation API — member 2, port 8014

| Method | Path | Auth | Behavior |
|---|---|---|---|
| GET | `/recommendations/home` | Profile | Personalized recommendations |
| GET | `/recommendations/similar` | Profile | Requires query titleId |
| GET | `/recommendations/trending` | Profile | Trending recommendations |

All support limit 1–100, default 20. Response: `{items,source,degraded,generatedAt}`. Inspect source/degraded; empty fallback results are possible. Other recommendation kinds return 400.

### Catalog Write — member 3, port 8021

| Method | Path | Auth | Behavior |
|---|---|---|---|
| POST | `/admin/catalog/titles` | Admin | Create unpublished title; 201 and ETag |
| GET | `/admin/catalog/titles/{id}` | Admin | Authoritative title and ETag |
| PUT | `/admin/catalog/titles/{id}` | Admin | Full replacement; If-Match required |
| POST | `/admin/catalog/titles/{id}/publish` | Admin | Publish; If-Match required |
| POST | `/admin/catalog/titles/{id}/unpublish` | Admin | Unpublish; If-Match required |
| DELETE | `/admin/catalog/titles/{id}` | Admin | Archive; If-Match required; returns title |

After creation, use `If-Match: "<current-version>"`. Missing version returns 428; stale version returns 412. Only publish/unpublish actions are supported. Read projection and recommendation ingestion are asynchronous.

Create/replace example (all fields required, no extra fields):

```json
{
  "name": "Local demo",
  "genres": ["drama"],
  "maturity": 12,
  "regions": ["IN"],
  "licenseStart": "2020-01-01T00:00:00Z",
  "licenseEnd": "2099-01-01T00:00:00Z",
  "assetPath": "demo/master.m3u8",
  "durationSeconds": 10,
  "maxQuality": "HD"
}
```

Name maximum 200 characters; genres maximum 20 nonblank values; maturity 0–18; region codes uppercase two letters; end strictly after start; duration 1–86400 seconds; quality SD/HD/UHD. The API supplies id/version/published/deleted. Media files must exist separately to play this title.

### Catalog Read — member 3, port 8022

| Method | Path | Auth | Behavior |
|---|---|---|---|
| GET | `/catalog/titles` | Profile | Browse eligible published titles |
| GET | `/catalog/search` | Profile | Same browse/search behavior |
| GET | `/catalog/titles/{id}` | Profile | Eligible detail; otherwise 404 |

Browse/search: q maximum 200 characters (name substring); limit 1–100/default 20; offset 0–10000/default 0. Eligibility checks publication/deletion, current maturity, deployment region IN and `[licenseStart,licenseEnd)`.

### Subscription — member 4, port 8031

| Method | Path | Auth | Behavior |
|---|---|---|---|
| GET | `/plans` | Public | basic/premium sandbox plans |
| POST | `/subscriptions` | Account | `{planId,simulateTimeout?,decline?}` with Idempotency-Key; 202 |
| GET | `/subscriptions` | Account | List account subscription records |
| GET | `/subscriptions/current` | Account | ACTIVE/PENDING record or null |
| POST | `/subscriptions/{id}/cancel` | Account | Cancel immediately |

Idempotency-Key is required (1–128 characters). Retry the same body and key; changing the body returns 409. One live subscription per account. Poll list/current for asynchronous billing progress; failed subscriptions appear in the list, not current. Basic is INR 19900 minor units, one stream/HD; premium INR 49900, four streams/UHD. Local validity is 30 days. No real payments occur. The Accepted Location names a resource, but **GET `/subscriptions/{id}` is not implemented**.

### Payment — member 4, port 8032

| Method | Path | Auth | Behavior |
|---|---|---|---|
| GET | `/payments` | Account | List simulated payment records |
| POST | `/payments/setup-sessions` | Account | Sandbox placeholder; no cards collected |

There are no implemented payment-detail, saved-method, support-refund or provider-webhook endpoints in this increment.

### Invoice — member 4, port 8033

| Method | Path | Auth | Behavior |
|---|---|---|---|
| GET | `/invoices` | Account | List invoices/credits |
| GET | `/invoices/{id}` | Account | Owned immutable record |
| GET | `/invoices/{id}/pdf` | Account | application/pdf sandbox document |

Invoices are produced asynchronously. Financial history remains after cancellation. These are not legally qualified invoices.

### Playback Session — member 5, port 8041

| Method | Path | Auth | Behavior |
|---|---|---|---|
| POST | `/sessions` | Profile | `{titleId}` and Idempotency-Key; 201; `{session,url}` |
| GET | `/sessions` | Profile | List active sessions for selected profile |
| POST | `/sessions/{id}/heartbeat` | Profile | `{sequence,positionSeconds}`; renew and checkpoint |
| POST | `/sessions/{id}/stop` | Profile | Finalize and emit history event |
| POST | `/sessions/{id}/refresh` | Profile | Recheck entitlement/rights and refresh signed URL |
| GET | `/media/{asset}/{file}` | Signed | Manifest/segment via exact signed URL |

Admission requires an ACTIVE subscription, eligible title and free stream slot. Key length is 1–128. Sequence is a positive integer, strictly increasing; stale heartbeats return 409. Position is an integer 0–durationSeconds. Session expiry is 90 seconds without heartbeat; URL expiry is at most 300 seconds, bounded by rights/entitlement. The UI saves checkpoints every 25 seconds while native video is playing; external-player/manual sessions require the Save progress control. Native HLS support depends on the browser; no HLS decoder is bundled. Generate demo files using `tools/make-demo-media.ps1` if FFmpeg is available. Only simple relative HLS manifests are supported.

### Watch History — member 5, port 8042

| Method | Path | Auth | Behavior |
|---|---|---|---|
| GET | `/history` | Profile | month=YYYY-MM (default current UTC month), limit 1–100/default 20 |
| GET | `/history/continue` | Profile | Unfinished progress; maximum 100 |
| DELETE | `/history` | Profile | Clear profile history/progress; 204 |
| DELETE | `/history/titles/{id}` | Profile | Hide title history/remove progress; 204 |

History consumes final session events asynchronously. After stop, refresh until the event appears. Completed titles are absent from continue watching.

## Private HTTP routes

These routes are **not exposed by Kong or the frontend proxy**. The listed hosts are Docker DNS names, not localhost-published ports. Run an HTTP client inside the `streaming-local` Compose network, or use the dependency-free Node client in the frontend container. Do not add public routes for workload endpoints.

| Service address | Method/path | Credentials | Input/output |
|---|---|---|---|
| profile:8011 | GET `/internal/context` | Workload + Profile | Validated accountId/profileId/maturity/region/policyVersion |
| profile:8011 | GET `/internal/account` | Workload + Account | accountId |
| catalog-write:8021 | POST `/internal/authorize` | Workload + Profile | `{titleId}` → rights/asset/duration/version |
| catalog-read:8022 | POST `/internal/titles` | Workload + Profile | `{ids:[...]}` maximum 100 → eligible items |
| subscription:8031 | GET `/internal/entitlement` | Workload + Account | active/maxStreams/maxQuality/validUntil/version |
| reco-engine:8013 | POST `/internal/jobs` | Workload | `{region:"IN"}` → 201 job id/status |
| reco-engine:8013 | GET `/internal/jobs/{job_id}` | Workload | Retained job/status/result |

Recommendation Engine has no public business routes. Its service OpenAPI JSON is `/openapi/reco-engine.json`, including jobs and probes.

All eleven services implement **GET `/health/live`** and **GET `/health/ready`** without tokens at their private addresses. The frontend checks ready from within Docker; its startup alone does not indicate all services are ready. Each probe checks only the dependency selected by its service implementation, not every datastore or broker involved in a journey.

Recommendation Engine/API also expose FastAPI's default **GET `/openapi.json`** privately without tokens. Framework interactive docs are disabled. Catalog Read/Write expose Spring **GET `/actuator/health`**, **GET `/actuator/health/liveness`**, **GET `/actuator/health/readiness`** without tokens. **GET `/actuator`** and **GET `/actuator/info`** require an account access token. Infrastructure endpoints (Keycloak, Kong administration and databases) are outside the eleven application-service contracts; Kong administration is disabled in this Compose configuration.

## PowerShell request examples

Run from the project folder after the stack is ready. Credentials and tokens stay in variables; do not paste their values into committed files.

```powershell
$api = 'http://localhost:8080'
Invoke-RestMethod "$api/plans"
$devValues = @{}
Get-Content .local/dev.env | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') { $devValues[$matches[1]] = $matches[2] }
}
$identity = Invoke-RestMethod -Method Post `
    -Uri 'http://localhost:8081/realms/streaming/protocol/openid-connect/token' `
    -ContentType 'application/x-www-form-urlencoded' `
    -Body @{grant_type='password'; client_id='streaming'; username='alice'; password=$devValues['DEV_PASSWORD']}
$accountHeaders = @{Authorization="Bearer $($identity.access_token)"}
$profiles = Invoke-RestMethod "$api/profiles" -Headers $accountHeaders
# If no profile exists, create one explicitly:
# Invoke-RestMethod "$api/profiles" -Method Post -Headers $accountHeaders -ContentType 'application/json' -Body '{"name":"Viewer","maturity":18}'
$profileId = $profiles.items[0].id
$selected = Invoke-RestMethod "$api/profiles/$profileId/select" -Method Post -Headers $accountHeaders
$profileHeaders = @{Authorization=$accountHeaders.Authorization; 'X-Profile-Token'=$selected.token}
Invoke-RestMethod "$api/catalog/titles?limit=20" -Headers $profileHeaders
Invoke-RestMethod "$api/watchlist" -Headers $profileHeaders
Invoke-RestMethod "$api/subscriptions/current" -Headers $accountHeaders
Invoke-RestMethod "$api/history/continue" -Headers $profileHeaders
```

For writes requiring `Idempotency-Key`, create a UUID once and reuse it with the same body when retrying. For catalog updates, fetch the admin detail and reuse its current `ETag` as `If-Match`. A new body requires a new idempotency key. Examples of request bodies:

```json
{"planId":"premium"}
```

POST `/subscriptions` with Account auth and `Idempotency-Key`; expect 202 and poll `/subscriptions/current` until ACTIVE. Payment remains simulated.

```json
{"titleId":"replace-with-an-eligible-title-id"}
```

POST `/sessions` with Profile auth and `Idempotency-Key`; expect 201 with `session` and `url`. Then POST `/sessions/{id}/heartbeat` with `{"sequence":1,"positionSeconds":4}` and Profile auth. Increase sequence on subsequent checkpoints. POST `/sessions/{id}/stop` to finish.

## Manual verification journey

1. Start the stack using the root README. Open http://localhost:8090, open **Account → Connection details → Check connections**. Resolve unavailable dependencies using Compose logs.
2. Sign in as admin, create/select a maturity-18 profile, then open Account and **Publish demo title**. Wait a few seconds and **Refresh collection** in Discover. Publishing does not create media files.
3. Open Account, view plans and choose one. Refresh membership until ACTIVE and the sandbox invoice appears; download its PDF.
4. Add the title to Watchlist and reload it. Repeating add should still produce one entry.
5. Click Watch, save progress at 4 seconds, then End session. Refresh History until its event appears and inspect Continue watching. Use native HLS playback where supported and demo files exist.
6. Refresh recommendations; inspect source/degraded in Account → Connection details → Last request when testing ranking health.
7. Use PowerShell/curl/Postman with the paths and headers in this file for update/archive, simulated decline/timeout and negative cases. Keep the same idempotency key for retries and generate a new UUID for a new operation.
8. Run `python member-1-platform/tests/smoke.py` for the automated cross-service journey and selected authorization/conflict tests. It changes synthetic local data and cancels existing ACTIVE/PENDING alice subscriptions; use a local demo account only.

You can use admin for the entire manual journey, or publish first, sign out, and switch to alice/bob for ownership checks. End active sessions before switching profiles/accounts. No catalog seeding or billing mutation runs automatically on page load. The demo publish button leaves its synthetic title in the catalog; archive it with DELETE `/admin/catalog/titles/{id}` using the current ETag when finished. Financial records persist by design.
