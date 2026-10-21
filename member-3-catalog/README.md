# Member 3 — catalog

Java 21/Spring Boot application with two independently deployable roles: `SERVICE_NAME=catalog-write` and `SERVICE_NAME=catalog-read`. Each has a separate PostgreSQL database and port. The Maven artifact contains member-local technical helpers; no code is imported from another member folder.

```powershell
cd member-3-catalog
mvn -B verify
docker build -t streaming-catalog .
```

Compose supplies the role and connection settings. Flyway applies `src/main/resources/db/migration` automatically.

## Implemented local behavior

- RS256 access-token validation against the configured issuer/audience/JWKS.
- Catalog administrator role checks.
- Validated title creation and ETag-protected replace/publish/unpublish/archive operations.
- `[start,end)` licensing, region, maturity, publication and deletion checks.
- PostgreSQL transactional title/outbox writes and a retrying Kafka relay.
- Versioned Kafka read projection with stale-event suppression.
- Bounded browse/search/detail endpoints and metadata batches.
- Internal authoritative playback authorization.

Create/replace fields: `name`, `genres`, `maturity`, `regions`, `licenseStart`, `licenseEnd`, `assetPath`, `durationSeconds`, `maxQuality`. Assets use `<asset>/master.m3u8`. The API owns IDs, versions and publication/deletion flags.

Admin routes are `/admin/catalog/titles`, `/{id}`, `/{id}/publish` and `/{id}/unpublish`; use DELETE on `/{id}` to archive. Mutations after creation require `If-Match: "<version>"`.

## Dependencies and next work

Profile validates current profile context. Watchlist/Recommendation consume the read API; Playback consumes write-side authorization. The local implementation uses HTTP internal contracts and a polling outbox relay. Generated gRPC, Debezium CDC, seasons/episodes/reference CRUD, Redis caching, immutable audits, MFA enforcement and projection rebuild remain tracked work.

Keep migrations append-only once merged. Do not edit Member 1's contracts or Compose directly; request those changes through Member 1.
