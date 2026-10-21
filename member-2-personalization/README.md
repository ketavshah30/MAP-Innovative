# Member 2 — profiles, watchlists and recommendations

This folder contains four deployable service targets. `src/main.ts profile` and `src/main.ts watchlist` use Fastify/TypeScript and separate MongoDB databases. `recommendation.main` selects `reco-engine` or `reco-api` through `SERVICE_NAME`.

```powershell
cd member-2-personalization
npm ci
npm run build
npm test
python -m pip install -r requirements.txt
python -m unittest discover -s tests -p "test_*.py"
```

Build containers with `Dockerfile.node` or `Dockerfile.python`; Member 1's Compose config supplies ports, credentials and dependencies. Node dependencies are locked in `package-lock.json`; Python direct dependencies are pinned in `requirements.txt`.

## Implemented local behavior

- Account bootstrap and account disablement.
- Profile create/read/update/delete/list with Mongo transactions and a concurrent five-profile counter.
- RS256 PCT issuance, subject matching, profile-policy version checks and immediate denial for deleted profiles/accounts.
- Transactional profile lifecycle outbox and Kafka relay.
- Watchlist list/add/remove/membership with unique profile/title entries and Catalog validation.
- Neo4j event ingestion, dedupe markers, catalog version guards, deletion markers and history signals.
- Deterministic content-similarity/popularity ranking.
- Home, similar and trending endpoints; Catalog re-filters eligibility before every response.
- Redis fallback only when a recent engine snapshot exists; otherwise an empty degraded result.
- Internal persisted recompute jobs and job status.

Profile selection is `POST /profiles/{id}/select`. Updates currently require the complete `{name,maturity}` body. Raising maturity requires an `amr` claim containing `mfa`. Initial adult-profile selection uses the account credential in this local demo; device/PIN protection is not yet complete.

## Dependencies and next work

You consume `/internal/titles` from Catalog and `watch.history.recorded.v1` from History. Other services call Profile's internal context endpoint to validate current profile/account state. Internal calls must forward access/PCT tokens and the local service key.

Complete the remaining privacy acknowledgments, parent reauthentication/PIN flow, mature selection policy, durable scheduled recompute leases, graph rebuild, read-only database role and ranking freshness gates before claiming the original plan complete. See `../IMPLEMENTATION_STATUS.md`.

Do not change files outside this member folder. Request integration or contract changes from Member 1.
