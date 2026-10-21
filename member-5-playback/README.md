# Member 5 — playback and history

Go application with independent `playback-session` and `watch-history` deployment roles selected by `SERVICE_NAME`. Playback owns Redis session state; History owns Cassandra. Both use Kafka with stable event identities.

```powershell
cd member-5-playback
go test ./...
go vet ./...
go build ./cmd/server
docker build -t streaming-playback .
```

## Implemented local behavior

- Profile-context, entitlement and authoritative content checks before admission.
- Stable admission ID from account and `Idempotency-Key`.
- Atomic Redis account slot reservation with same-slot key names.
- Session list/start/heartbeat/stop/URL refresh.
- Monotonic heartbeat sequences and bounded playback positions.
- Synchronous Kafka lifecycle publication before successful acknowledgments.
- Retryable finalization with a retained payload and stable end ID/time.
- Signed local HLS URLs, including rewritten simple manifest segment links.
- Cassandra history/progress writes with absolute retention deadlines.
- History replay, derived `WatchRecorded` events and clear/deletion suppression.
- Monthly history queries, continue-watching, title hide and history clear.

## Local media

Provide prepackaged, single-rendition HLS in `.local/media/demo/master.m3u8` and its `.ts` segment files. The initial server supports simple relative segment/playlist URI lines. Encrypted manifests, URI attributes, DRM, DASH and multi-quality rendition policy are not implemented. Signed files are served through the local API gateway; this is not a production CDN integration.

If FFmpeg is installed, run Member 1's `tools/make-demo-media.ps1` to generate a ten-second synthetic color/test-tone asset. No third-party content is downloaded.

## Durability boundary and next work

The local Redis AOF + Kafka adapter supports restart/retry development, but is not the production transactional journal described by ADR-03. Complete journal reconstruction, fencing during rebalances, finalization transactions, account revocation consumption and Redis Cluster/partition fault tests before HA deployment. History currently republishes the same derived ID before committing offsets; downstream dedupe handles repeat delivery, but the planned Kafka output/offset transaction remains work.

Complete Cassandra deterministic equal-time ordering, full retention/export/rebuild tooling, real CDN/origin protection, quality/asset membership enforcement and cross-host failure qualification. Do not claim the original acknowledged-loss SLOs from local tests.

Members 2, 3 and 4 own your dependencies. Only edit this member folder and propose interface changes through Member 1.
