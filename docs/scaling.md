# Scaling notes

Operational constraints and knobs for running toddle-compose beyond a single
small deployment. Current comfortable envelope: **low hundreds of concurrent
collaborators** spread across documents on one rtc-server instance, and
**~20–50 simultaneous editors per document**.

## rtc-server: single-writer-per-doc (the hard constraint)

The authoritative `Y.Doc` for every warm document lives in rtc-server process
memory, and the update log's `seq` is computed as `max(seq)+1` per doc (see the
comment in `doc-repository.service.ts`). Two replicas serving the same doc
would race on `seq` and diverge in memory.

**Do not horizontally scale the rtc-server behind a round-robin LB.** The
supported path is doc-to-instance affinity: route by consistent hash of the
`docId` in the WS path (`/yjs/:docId`) so each document always lands on the
same instance. Each instance then owns a disjoint shard of documents and the
single-writer invariant holds per doc. (Nginx: `hash $uri consistent;` on the
upstream; Envoy/HAProxy have equivalents. The internal HTTP API must be routed
with the same hash for `DELETE /internal/docs/:docId` and compaction triggers,
or broadcast to all instances.)

What's already in place to stretch a single instance:

- **Extraction off the main thread** — headless-Lexical extraction (the
  CPU-heaviest step of every flush) runs in a worker-thread pool
  (`RTC_EXTRACT_WORKERS`, default 2).
- **Append coalescing** — Yjs updates are merged per (doc, author) for
  `RTC_APPEND_COALESCE_MS` (default 1000ms) before hitting the DB, so typing
  costs ~1 row/sec/author instead of one row per keystroke. Crash exposure is
  bounded by the window.
- **Awareness coalescing** — cursor/presence frames beyond 15/sec/connection
  are collapsed to the latest one (trailing 100ms), bounding the N² broadcast
  chatter in crowded docs.
- **Backpressure** — `maxPayload` (4 MiB default) and a per-connection message
  rate limit (burst 500, 100/sec) cap what any one client can inflict.
- **Token expiry jitter** — RTC tokens carry ±10% TTL jitter so sockets opened
  together (deploy, page reload wave) don't all re-handshake at once.

If the target is thousands of concurrent users with hundreds per doc, affinity
sharding eventually runs out too; the next step is a y-redis-style split
(stateless WS tier + pub/sub + separate persistence workers) — a rearchitecture,
not a knob.

## backend: stateless, scales out — with three caveats

1. **Object storage must be S3 when running >1 instance.** The `local` driver
   writes to the instance's own disk; uploads served by another instance 404.
2. **Rate limiting is per-instance.** `ThrottlerModule` uses in-memory storage,
   so N instances multiply the effective auth rate limits by N. Move to a
   Redis-backed throttler storage before scaling out if brute-force limits
   matter to you.
3. **Connection pool sizing.** Prisma defaults to `num_cpus * 2 + 1`
   connections per instance. Set `connection_limit` in `DATABASE_URL`
   deliberately (instances × pool size must stay under Postgres
   `max_connections`, minus the rtc-server's pool) or front with pgbouncer.

Password hashing uses native `bcrypt` (libuv thread pool), so login bursts cost
threads, not event-loop stalls; the pool is 4 threads by default — raise
`UV_THREADPOOL_SIZE` if logins are a hotspot.

## Postgres

- The RTC update log (`rtc_document_updates`) is the write-heavy table. Append
  coalescing plus tiered compaction keep it bounded, but watch its growth and
  vacuum behavior under sustained load; partitioning by `doc_id` hash is the
  escape hatch.
- The two databases (`toddle_compose`, `toddle_compose_rtc`) can move to
  separate Postgres instances independently; the rtc one wants fast disk more
  than memory.
