# RTC Server — Routes

The rtc-server runs **two listeners**:

- **WebSocket** on `RTC_PORT` (default `4001`) — the live Yjs collaboration endpoint clients connect to.
- **Internal HTTP API** on `RTC_INTERNAL_PORT` (default `4002`) — admin/history endpoints the backend
  (and tooling) call server-to-server.

It talks ONLY to the separate, write-heavy **RTC database** (`RTC_DATABASE_URL`) — never the main
backend DB.

Conventions:
- The WS endpoint authenticates with an **RS256 RTC token** (minted by the backend's
  `POST /api/documents/:id/rtc-token`). The token is verified against the backend's JWKS
  (`JWKS_URL`, default `http://localhost:4000/.well-known/rtc-jwks.json`) with issuer
  (`RTC_TOKEN_ISS`) and audience (`RTC_TOKEN_AUD`) checks. The permission decision is made by the
  backend and frozen into the token — the rtc-server only enforces it.
- The internal HTTP API is guarded by a shared secret header **`x-internal-token`**
  (`INTERNAL_TOKEN`); `GET /health` is the only unguarded route. There is no `/api` prefix.
- Request/response bodies are JSON.

---

## WebSocket (collaboration)

### `ws://<host>:4001/yjs/:docId?token=<rtcToken>`
The Yjs sync + awareness endpoint. One connection per open document.

- **`:docId`** — the document id. It must equal the `docId` claim inside the token, otherwise the
  upgrade is rejected `403 docId mismatch`.
- **`token`** (query param, required) — the RS256 RTC token from the backend. Missing/invalid URL →
  `400 bad URL`; invalid/expired token → `401`; a `denied` role → `401 access denied`.
- **Roles** (from the token's `role` claim):
  - `editor` — full read/write (Yjs sync messages + awareness).
  - `viewer` — connected and synced, but document-mutating sync frames (sync-step-2 / update) are
    **silently dropped** server-side; awareness (presence/cursors) still flows.
- Protocol: standard [`y-websocket`](https://github.com/yjs/y-websocket) sync + awareness, GC enabled.
  Identity claims (`name`, `email`, `color`) carried in the token drive presence/cursors.

Client sketch:
```ts
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

// 1) get a token from the backend
const { token, docId, role } = await authedFetch(`/api/documents/${id}/rtc-token`, { method: "POST" }, tokens)
  .then((r) => r.json());

// 2) open the collab connection
const doc = new Y.Doc();
const provider = new WebsocketProvider("ws://localhost:4001", `yjs/${docId}`, doc, {
  params: { token },
});
```

---

## Internal HTTP API

Base URL (local): `http://localhost:4002`. All `/internal/*` routes require the
`x-internal-token: <INTERNAL_TOKEN>` header (`401 invalid internal token` otherwise).

### GET `/health`
Public (no token). Liveness probe.
`200`:
```json
{ "ok": true }
```

### POST `/internal/docs/init` — ensure an RTC doc row exists
Idempotently provisions the persistence row for a document (called when a doc is first opened).
```json
{ "docId": "ckdo…" }
```
`201`:
```json
{ "ok": true, "docId": "ckdo…" }
```
Errors: `400 docId required`.

### GET `/internal/docs/:docId/versions` — list persisted updates
The append-only update log for a doc. Query params (all optional):
- `from` — first seq (default `1`, min `1`).
- `to` — last seq (default = current head).
- `limit` — max rows (default `1000`, clamped to `5000`).
- `clientSub` — filter to a single author (the user `sub` from their token).

`200`:
```json
{
  "docId": "ckdo…",
  "head": 142,
  "count": 2,
  "clientSub": null,
  "updates": [
    { "seq": 1, "byte_len": 38, "origin": "live", "client_sub": "ckus…", "created_at": 1749546000000 },
    { "seq": 2, "byte_len": 12, "origin": "live", "client_sub": "ckus…", "created_at": 1749546005000 }
  ]
}
```

### GET `/internal/docs/:docId/versions/:seq` — preview doc state at a seq
Reconstructs the document by applying updates up to `:seq` and extracts its content. `:seq` must be a
non-negative integer (`400` otherwise); `0` yields the empty document. Optional `include` query param
selects which slice to compute (skips the rest): `all` (default), `render` (materialized
`lexicalJson` — DOC snapshot/diff render, the mode the backend sends for DOCs), `text` (sheet/text
only — SHEET render), or the legacy `state` (yjs bytes only; kept for older backends); any other
value is `400`. With `include=render`, optional `diffAgainst=<seq>` (`400` if not a non-negative
integer; `0` = empty-doc baseline) also returns `diffJson` — a merged diff editorState
(baseline → seq) with `diff-mark` nodes; `diffJson` is `null` for a render without `diffAgainst` and
absent semantics only on older servers. `yjsStateB64` is the full Yjs state (base64), present for
`all`/`state` and empty for `render`/`text`; `lexicalJson` is populated for `render` (upload-registry
URLs baked into node `src`) and `all` (raw); `plainText`/`rawTexts` only for `all`.
`200`:
```json
{
  "docId": "ckdo…",
  "seq": 50,
  "headSeq": 142,
  "appliedUpdates": 50,
  "yjsStateBytes": 2048,
  "yjsStateB64": "AQ…",
  "lexicalJson": "{…}",
  "plainText": "Q3 roadmap…",
  "rawTexts": { "root": "Q3 roadmap…" },
  "elapsedMs": 7
}
```

### GET `/internal/docs/:docId/sessions` — group updates into editing sessions
Buckets the update log into per-author editing sessions (split on idle gaps). Query params (optional):
- `clientSub` — filter to one author.
- `gapMs` — idle gap that starts a new session (default `RTC_SESSION_GAP_MS`, 30 000 ms).
- `includeNoop` — `true`/`1` to keep sessions that produced no visible content change.

`200`:
```json
{
  "docId": "ckdo…",
  "head": 142,
  "gapMs": 30000,
  "clientSub": null,
  "totalSessions": 5,
  "filteredCount": 4,
  "sessions": [ { "firstSeq": 1, "lastSeq": 18, "origin": "live", "noop": false, "...": "…" } ]
}
```

### POST `/internal/docs/:docId/compact-demo` — force checkpoint + compaction (demo/admin)
Forces a checkpoint then runs compaction for one doc. Query param `tier` is **required** and must be
`1` or `2` (`400` otherwise). The doc must be "warm" (open in the editor) — `409` if not.
`201`:
```json
{ "docId": "ckdo…", "tier": "1", "stats": { "...": "…" } }
```

> Checkpointing and compaction also run on background schedulers
> (`RTC_CHECKPOINT_INTERVAL_MS`, `RTC_COMPACT_INTERVAL_MS`, with `RTC_TIER1_AGE_MS` /
> `RTC_TIER2_AGE_MS` retention). This endpoint just triggers them on demand.

---

## Env reference (ports & token verification)

| Var | Default | Purpose |
| --- | --- | --- |
| `RTC_PORT` | `4001` | WebSocket (collab) port |
| `RTC_INTERNAL_PORT` | `4002` | Internal HTTP API port |
| `RTC_DATABASE_URL` | — | RTC (write-heavy) database |
| `INTERNAL_TOKEN` | `dev-internal-secret-change-me` | shared secret for `x-internal-token` |
| `JWKS_URL` | `http://localhost:4000/.well-known/rtc-jwks.json` | backend public keys for RTC-token verify |
| `RTC_TOKEN_ISS` | `toddlecompose-backend` | expected token issuer |
| `RTC_TOKEN_AUD` | `rtc-server` | expected token audience |
| `RTC_SESSION_GAP_MS` | `30000` | default session split gap |
| `RTC_CHECKPOINT_INTERVAL_MS` | `300000` | checkpoint scheduler interval |
| `RTC_COMPACT_INTERVAL_MS` | `21600000` (6 h) | compaction scheduler interval |
| `RTC_TIER1_AGE_MS` / `RTC_TIER2_AGE_MS` | 12 h / 30 d | compaction retention tiers |

curl smoke test:
```bash
curl -s localhost:4002/health
curl -s localhost:4002/internal/docs/ckdo.../versions \
  -H "x-internal-token: $INTERNAL_TOKEN" | jq
```
