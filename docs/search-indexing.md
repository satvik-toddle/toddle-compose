# Search Indexing Pipeline

Design for keeping document content searchable at scale **without putting any search load on
the rtc (collaboration) server**, and without losing index updates across crashes, retries,
concurrent edits, or out-of-order delivery.

Status: **target state shipped** — durable `stale_documents` queue + same-tx enqueue + a
detached indexer worker process now populate the backend search projection. The old per-flush
inline extraction/push is removed. Deferred (accepted, see §9): physical drop of the vestigial
rtc `content_text` column, hash-partitioned multi-worker, the external-engine ports (§8), and
the full metric set (§10 — the queue is observable via `stale_documents`, structured metrics
TBD).

As-built pointers:
- Queue + enqueue (G1): `packages/rtc-database` `StaleDocument`; `DocRepository.persistRtcDoc` /
  `writeSnapshotCheckpoint` wrap the snapshot write + `enqueueStale` in one `$transaction`.
- Worker: `rtc-server/src/indexer/` (`indexer.service.ts` loop, `main.ts` headless bootstrap);
  run with `pnpm --filter rtc-server indexer` (prod) / `dev:indexer` (watch), wired into
  `scripts/dev-services.mjs`.
- Guards: G2 `DocRepository.deleteStaleUpTo` (`seq <= claimed`); G3 backend
  `InternalController` bulk `POST /api/internal/documents/content` (`UPDATE … WHERE
  content_seq IS NULL OR content_seq < seq`) + `documents.content_seq`.

---

## 1. Goals

- Search is **exhaustive** (no caps/windows) and **indexed** (sub-linear, not table scans).
- Search puts **zero load on the rtc server** — no HTTP hops, no queries against the rtc DB
  on the read path.
- Index updates are **eventually consistent with a bounded, known lag** and **converge after
  any crash or outage** (rtc, worker, or backend).
- Every scaling step (more workers, rtc sharding, Kafka, external search engine) is an
  **adapter swap or a config change**, not a redesign.
- Services never touch each other's databases; all cross-service writes go through
  authenticated internal APIs.

Non-goals (for now): relevance ranking, typo tolerance, sub-second index freshness. Those
arrive with an external search engine (§8).

---

## 2. Where the data lives

| Data | Store | Notes |
|---|---|---|
| Real doc content (source of truth) | rtc DB — `rtc_documents.yjs_state` + `rtc_document_updates` log | CRDT bytes; written by collab flushes; never read by search |
| Searchable plain text | **backend DB — `documents.content_text`** | Denormalized projection, one row per doc |
| String index | backend DB — `pg_trgm` **GIN** indexes on `documents.content_text` and `documents.title` | Makes `ILIKE '%q%'` sub-linear; applied via `packages/database/prisma/sql/001_search_content_trgm.sql` (Prisma can't express trgm GIN) |
| Dirty set (target state) | rtc DB — `stale_documents` queue table | Outbox: which docs' index is behind, and at which seq |

Search reads run **only** against the backend DB:

```
accessFilter AND (title ILIKE %q% OR content_text ILIKE %q%)
ORDER BY (updatedAt DESC, id DESC)  -- keyset pagination
```

One query. No rtc involvement. Scales with read replicas.

---

## 3. Prior state (superseded — kept for context)

The first shipped version extracted plain text on each snapshot flush (registry-free Yjs tree
walk, `searchable-text.ts`) and fire-and-forgot it to `PUT /api/internal/documents/:id/content`.
That endpoint still exists (now with an optional seq guard) but the collab server no longer
calls it — the flush just enqueues, and the worker owns extraction + the push. The gaps that
motivated the switch, all now closed by §4:

1. **Crash staleness** — the push lived and died with the flush; a crash/failed push left the
   index stale with nothing to reconcile. → same-tx enqueue (G1) + worker retry.
2. **Write amplification** — one HTTP call + row update per flush per active doc. → PK
   coalescing + batched bulk push.
3. **rtc paid extraction CPU** on every flush. → extraction moved to the detached worker.

---

## 4. Target state — durable queue + detached indexer

```
 user edits
     │ (yjs updates, appended durably to rtc_document_updates)
     ▼
 rtc flush (every 2–10s per active doc)
     │  same transaction:
     │    UPDATE rtc_documents SET yjs_state=…, snapshot_at_seq=$seq
     │    INSERT INTO stale_documents (doc_id, seq) VALUES ($id, $seq)
     │      ON CONFLICT (doc_id) DO UPDATE SET seq = EXCLUDED.seq      ← coalescing
     ▼
 stale_documents (rtc DB)              ← durable dirty set, PK doc_id
     │
     │  indexer worker (separate process), loop every ~2s:
     │    1. SELECT doc_id, seq FROM stale_documents LIMIT 500          ← no locks
     │    2. read yjs_state for those ids (rtc DB, replica-friendly)
     │    3. extract plain text (pure-Yjs walk, bounded concurrency)    ← CPU lives HERE
     │    4. bulk push [{id, text, seq} × 500] → backend internal API
     │    5. DELETE FROM stale_documents WHERE doc_id=$id AND seq <= $claimedSeq   ← guarded
     ▼
 backend internal API (bulk, X-Internal-Token, raised body limit)
     │    UPDATE documents SET content_text=$t, content_seq=$s
     │      WHERE id=$id AND (content_seq IS NULL OR content_seq < $s)  ← seq guard
     ▼
 documents.content_text + GIN trgm index  →  served to search reads
```

rtc's total search-related cost becomes **one upserted queue row inside a transaction it was
already running**. Extraction, batching, and index writes all live in the worker.

### 4.1 Queue schema (rtc DB)

```sql
CREATE TABLE stale_documents (
  doc_id   text PRIMARY KEY,          -- PK = coalescing: 50 edits → 1 row
  seq      integer NOT NULL,          -- the flush seq this dirtiness represents
  dirty_at bigint  NOT NULL           -- epoch ms; drives the staleness-age metric
);
```

### 4.2 Backend schema addition

```sql
ALTER TABLE documents ADD COLUMN content_seq integer;  -- guard for out-of-order pushes
```

### 4.3 Worker loop (normative pseudocode)

```
loop forever:
  rows = SELECT doc_id, seq FROM stale_documents LIMIT BATCH        # lock-free
  if rows empty: sleep(SWEEP_MS); continue

  states = SELECT id, yjs_state FROM rtc_documents WHERE id IN (rows.ids)
  texts  = extractSearchText(states)        # pure Yjs; concurrency-capped (e.g. 8)
  POST /api/internal/documents/content  [{id, text, seq} …]         # one bulk call

  for each row: DELETE FROM stale_documents
                WHERE doc_id = row.id AND seq <= row.seq            # guarded delete
  # no sleep when a full batch was drained — keep draining the backlog
```

---

## 5. Correctness — the three guards and why each exists

These are the load-bearing invariants. Removing any one reintroduces a silent bug.

### G1 — Enqueue in the **same transaction** as the flush write
If the queue row were written outside the tx (or on keystroke instead of flush), the worker
could extract a `yjs_state` that doesn't yet contain the edit, then clear the row → permanent
staleness. Same-tx enqueue is the transactional-outbox guarantee: *if the snapshot is
durable, so is the fact that the index is behind.*

### G2 — **Guarded delete** by seq (`DELETE … WHERE seq <= claimedSeq`)
Kills the lost-update race (this is the reason a plain `dirty boolean` — and unguarded
"delete the row when done" — are wrong):

```
T0    worker claims (docX, seq 10), extracts text@10
T0.5  user edits X → flush upserts row → seq = 12
T1    worker pushes text@10, deletes row unconditionally
      → seq-12 dirtiness destroyed; index stuck at 10 forever   ← the bug
```

With the guard, the delete at T1 matches nothing (12 > 10), the row survives, and the next
sweep pushes text@12.

### G3 — **Seq-guarded upsert** on the backend (`WHERE content_seq < $seq`)
With batching, retries, and multiple workers, a *delayed* seq-10 push can arrive **after** a
seq-12 push. Without the guard it overwrites newer text with older. With it, stale writes are
no-ops. This also makes every push idempotent, which is what allows: lock-free claims,
duplicate work between workers, crash-retry, and (later) Kafka's at-least-once delivery.

### Additional rules

- **No row locks held during extraction.** A `FOR UPDATE` on a queue row blocks the flush's
  `ON CONFLICT` upsert for that doc, stalling rtc's persist chain. Claims are lock-free;
  G2+G3 make duplicated work harmless. Multiple workers partition by `hash(doc_id) % N`
  instead of locking.
- **Loop-with-delay, not `setInterval`.** A new sweep starts only after the previous one
  finishes; backlog degrades freshness linearly instead of stacking concurrent sweeps.
- **Deletes are benign races.** Backend write is `updateMany`-style (0 rows for a deleted
  doc); an rtc row deleted mid-sweep just drops the work; guarded queue-delete cleans up.
- **Extraction never throws** (`extractSearchText` returns `""` on bad state) — no poison-row
  loops; empty extractions are logged for visibility.

### Crash matrix

| Crash point | Outcome |
|---|---|
| rtc dies before flush | Edits are durable in the update log; on next open+flush/disconnect the queue row is written. (Optional hardening: flush-on-cold-load when `head > snapshot_at_seq`, or worker-side tail replay — see §9.) |
| Worker dies mid-batch | Queue rows untouched (delete never ran) → re-processed next start. G3 makes re-push safe. |
| Backend down during push | Bulk call fails → rows stay queued → retried next sweep. |
| Worker pushes, dies before delete | Row re-processed; push is idempotent (G3). |

---

## 6. Performance & scaling model

Let **D** = distinct docs dirtied per sweep interval (NOT edits/sec — the PK upsert coalesces
all edits to a doc into one row).

- **rtc:** +1 tiny upsert per flush tx. No extraction, no HTTP. ~zero.
- **Queue:** O(D) rows; sweep is `LIMIT batch` off a PK — trivial.
- **Worker:** O(D × doc_size) extraction CPU per interval — the deliberate cost center;
  scales horizontally by hash partition. Reads can target an rtc **read replica**.
- **Backend:** O(D) row updates per interval via **one bulk statement per batch**
  (staging `COPY` + `INSERT … ON CONFLICT` merge), plus GIN maintenance
  (`fastupdate = on`, tuned autovacuum).
- **Search reads:** one indexed query; scale with read replicas. Measured on ~10k docs:
  selective term ≈ 0.6 ms (GIN bitmap scan), worst-case broad term ≈ 87 ms.

Throughput sanity check (why batching is mandatory): 100k-row backlog drained one-by-one at
~20 ms/doc ≈ **33 min**; batched at 500/batch ≈ **3–7 min**, degrading gracefully while the
backlog drains.

Capacity guidance:

| Sustained distinct dirty docs/sec | Setup |
|---|---|
| ≤ ~5k | This design, single worker, defaults |
| ~5k–tens of k | N hash-partitioned workers; rtc read replica; search column moved to its own partitioned table; GIN tuning |
| ≥ ~100k sustained | Postgres exits the index-write path: queue feeds an external search engine (§8) |

**Freshness SLA:** flush (≤10 s) + sweep (~2–5 s) + push ≈ **≤ ~15 s** worst case. Document
this; "I typed it and can't search it yet" inside that window is by design.

---

## 7. Isolation & security boundaries

- The worker is a **separate process**: its CPU/memory never touches rtc's WebSocket loop or
  backend request handlers.
- Remaining coupling is **through the databases**, by design and bounded:
  worker *reads* rtc DB (replica-able), *writes* backend only via the internal API.
- **No cross-service DB credentials.** rtc/worker never hold the backend `DATABASE_URL`; the
  only write capability exposed is "set one doc's search text, seq-guarded", authenticated by
  `INTERNAL_TOKEN` (`X-Internal-Token`, constant-time compare).
- Internal routes (`/api/internal/*`, rtc `/internal/*`) must be network-private in prod; the
  shared secret is defense-in-depth, not the perimeter.
- Blast radius of a leaked internal token: search-index poisoning (annoying, recoverable by
  re-index) — not data read access.

---

## 8. Ports — how future scaling stays an adapter swap

Unit of work: `DocChanged { docId, workspaceId, seq }` — **keyed by docId, versioned by seq,
consumed idempotently**. Those three properties are what make every transport/sink swappable.

| Port | Adapter now | Adapter later |
|---|---|---|
| `ChangeQueue` (enqueue / drain / ack) | `stale_documents` table | Kafka topic, log-compacted, keyed by docId |
| `SearchIndexWriter` (bulk upsert) | backend bulk API → Postgres GIN | OpenSearch/Meilisearch bulk ingest |
| `SearchIndexReader` (search/paginate) | Postgres trgm query | search-engine query (adds ranking, typo tolerance) |

- rtc knows only `ChangeQueue.enqueue`. The search controller knows only
  `SearchIndexReader`. The worker is the only component that knows both ends.
- Workers are stateless; scale = add instances (`hash(doc_id) % N` partitioning — the same
  seam rtc doc-sharding uses later via a `DocRouter.instanceFor(docId)`).
- Kafka is warranted only when: multiple consumers of the change stream, replay/rebuild
  requirements, or throughput beyond a Postgres queue — typically the same moment an external
  search engine arrives. Not before: a compacted-log's dedup is what the PK upsert already
  gives us for free.

---

## 9. Known residual gaps (explicit, accepted for now)

1. **Never-reopened crash residue.** A doc whose rtc process crashed *before flush* and that
   is never opened again keeps a stale index (content itself is safe in the update log).
   Hardening options, cheapest first: flush-on-cold-load when `head > snapshot_at_seq`;
   worker-side dirtiness on `head_seq` with tail-blob replay (also makes the index fresher
   than flush cadence).
2. **Hot-table churn.** Backend `content_text` updates bloat `documents` + its GIN index over
   time → move the search columns to a dedicated (partitioned) table behind
   `SearchIndexWriter/Reader` when it shows up in vacuum stats.
3. **Short queries** (1–2 chars) can't use trigram — served by bounded scans; acceptable.
4. **Recency-ordered results only** — relevance ranking arrives with the search engine.

---

## 10. Observability (ship WITH the worker, not after)

The failure mode of this pipeline is *silent, growing staleness*. Minimum signals:

- `stale_documents` row count (gauge) and **oldest `dirty_at` age** (gauge + alert, e.g. > 5 min)
- pushes/sec, batch size, extraction duration (histograms)
- push failure counter (alert on sustained failures)
- empty-extraction counter (corrupt/undecodable docs)

## 11. Rollout — DONE (this is how it was shipped)

1. ✅ Backend: `content_seq` column (+ `sql/002_content_seq.sql`); bulk internal endpoint with
   raised body limit (8mb); single-doc endpoint kept with an optional seq guard.
2. ✅ rtc: `stale_documents` created; enqueue in the flush tx; inline extraction/push removed;
   boot backfill + the `reindex-content` script deleted (single extraction path). rtc
   `content_text` left in place as vestigial — physical drop deferred (needs
   `--accept-data-loss`; nothing reads/writes it).
3. ✅ Worker deployed as its own process; a fresh queue drains naturally (backlog = backfill).
   In the incremental cutover here, already-indexed docs kept their projection and only
   re-enqueue on the next edit.
4. ✅ Verified locally: G1 live (edit → flush enqueue → worker drain → search hit); G2 guarded
   delete (a bumped seq survives a stale-seq delete); G3 (older seq push is a no-op); backend
   killed mid-run → queue rows persist → converge on restart. Structured metrics (§10) still
   TBD; the queue itself is inspectable (`SELECT count(*), min(dirty_at) FROM stale_documents`).
