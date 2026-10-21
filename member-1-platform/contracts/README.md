# Contract v1

Complete implemented HTTP route definitions are authored in [http.v1.mjs](http.v1.mjs). The local frontend serves optional machine-readable OpenAPI 3.1 at `http://localhost:8090/openapi/public.json` and `/openapi/<service-name>.json`. Human-readable API documentation is the Markdown file below; there is no explorer webpage. See [the API reference](../API_REFERENCE.md) for every public/private path, request rules and testing steps. These contracts describe the current local increment, not every planned production endpoint.

All JSON names use camelCase. Money uses integer minor units. Times are UTC RFC3339. Public profile-scoped requests contain `Authorization: Bearer <access-token>` and `X-Profile-Token: <PCT>`.

Access tokens: RS256, configured issuer, audience `streaming`, account identifier in `sub`, admin role in `realm_access.roles`. PCT: RS256, issuer `profile`, audience `streaming`, `sub` matching the access token, `profileId`, integer `maturity`, `policyVersion`, and `region`. Region is a fixed deployment policy in this local stack, never accepted from a request body/header.

Internal HTTP calls additionally require `X-Service-Key`; the local key is a development-only substitute for named mesh identities. Kong has no route to `/internal`. Tokens and keys must never be logged. Internal profile context validates current account/profile state before profile-scoped work.

| Endpoint | Caller | Result |
|---|---|---|
| `GET profile:8011/internal/context` | Profile-scoped services | `{accountId,profileId,maturity,region,policyVersion}` |
| `POST catalog-write:8021/internal/authorize` body `{titleId}` | Playback | `{titleId,assetPath,durationSeconds,allowedUntil,maxQuality,version}` |
| `POST catalog-read:8022/internal/titles` body `{ids:[...]}` | Watchlist, Reco API | `{items:[eligible title objects]}`; max 100 |
| `GET subscription:8031/internal/entitlement` | Playback | `{active,maxStreams,maxQuality,validUntil,version}` |

These local HTTP implementations are a deliberate development transport. The original plan's generated gRPC services remain a separate completion item; do not call the HTTP transport production-equivalent.

Kafka topics: `catalog.title.v1`, `profile.lifecycle.v1`, `playback.session.lifecycle.v1`, `playback.session.ended.v1`, `watch.history.recorded.v1`, `billing.subscription.v1`, `billing.payment.v1`, `trending.snapshot.v1`. Topic keys are aggregate/profile/account identifiers as defined in implementation.md. Consumers accept new optional fields, deduplicate immutable event IDs and reject older aggregate versions.

RabbitMQ queues: `payment.charge`, `payment.refund`, `subscription.payment-result`. Billing commands carry `id`, `sagaId`, `accountId`, `subscriptionId`, `amount`, `currency` and stable `paymentId`. Local billing event outboxes preserve original IDs on retry.

Profile deletion data: `{accountId,profileIds,deleted:true}`. Consumers retain suppression markers. Complete deletion acknowledgments, backup erasure and Keycloak account disabling remain production gates.

Catalog title data: `{id,name,genres,maturity,regions,licenseStart,licenseEnd,published,deleted,assetPath,durationSeconds,maxQuality,version}`. `regions` is a list of ISO country codes; license bounds use `[start,end)`.

Session-ended data: `{sessionId,accountId,profileId,titleId,positionSeconds,durationSeconds,endedAt}`. Its stable event ID is `end:<sessionId>`.

Pagination uses `limit` (default 20, maximum 100); this increment uses bounded offset pagination where stated. Cursor pagination remains tracked in the status document.
