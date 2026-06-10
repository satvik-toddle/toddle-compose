import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// The sheet has no Lexical content, so (unlike DocView) it doesn't need the
// editor's bundled Y — it uses the app's own yjs + y-websocket directly. The
// sheet lives in its own RTC room (docId), so there's no shared-Y-instance
// concern with the editor. (The editor build no longer re-exports Y anyway.)
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { DataGrid } from '@toddle-edu/ds-data-grid';
import { api } from './api';
import { env } from './env';
import "@glideapps/glide-data-grid/dist/index.css";

type User = { id: string; email: string; name?: string; color?: string };
type ConnState = 'loading' | 'connecting' | 'connected' | 'disconnected' | 'error';

// Fixed column set for v1. A fuller spreadsheet would store the header config
// in Yjs too (so columns can be added collaboratively); here columns are static
// and only the row cells are shared/collaborative.
const COLUMNS = [
  { id: 'a', title: 'A', width: 200 },
  { id: 'b', title: 'B', width: 200 },
  { id: 'c', title: 'C', width: 200 },
  { id: 'd', title: 'D', width: 200 },
  { id: 'e', title: 'E', width: 200 },
];

// Yjs model:
//  • ydoc.getArray('rows') holds one Y.Map per row — a stable '__id' plus one
//    key per column id → the cell's raw value. Per-key CRDT, so edits to
//    different cells merge; same cell is last-writer-wins.
//  • ydoc.getMap('colTypes') maps a column id → its cell type. Stored in Yjs so
//    a column-type change is collaborative (RTC-safe) like any cell edit.
const ROWS_KEY = 'rows';
const ID_KEY = '__id';
const COL_TYPE_KEY = 'colTypes';

// Column types the toolbar can switch between. (date/dropdown need extra
// per-cell config — pickerProps / options — so they're left out of v1.)
const SUPPORTED_TYPES = [
  { id: 'text', label: 'Text' },
  { id: 'number', label: 'Number' },
  { id: 'checkbox', label: 'Checkbox' },
] as const;
type CellTypeId = (typeof SUPPORTED_TYPES)[number]['id'];

// Build a grid cell object from the raw stored value + the column's type. The
// raw value is kept as-is in Yjs; we coerce only for display so switching a
// column's type never corrupts the underlying data.
function buildCell(raw: any, type: string, editable: boolean) {
  if (type === 'number') {
    const n =
      typeof raw === 'number'
        ? raw
        : raw !== '' && raw != null && !Number.isNaN(Number(raw))
          ? Number(raw)
          : '';
    return { cellType: 'number', value: n, isEditable: editable };
  }
  if (type === 'checkbox') {
    const on = raw === 'checked' || raw === true || raw === 'true' || raw === 1 || raw === '1';
    return { cellType: 'checkbox', value: on ? 'checked' : 'unchecked', isEditable: editable };
  }
  return { cellType: 'text', value: raw == null ? '' : String(raw), isEditable: editable };
}

let rowSeq = 0;
function newRowId(): string {
  rowSeq += 1;
  return `r-${Date.now().toString(36)}-${rowSeq}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// Stable cross-client key for a cell.
const cellKey = (rowId: string, colId: string) => `${rowId}:${colId}`;

// #rrggbb → rgba() so we can draw a translucent fill behind a remote cursor
// (glide strips the alpha for the dashed border, keeping it for the fill).
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

type RemoteState = {
  clientId: number;
  user: { id?: string; name?: string; color?: string };
  cell: { rowId?: string; colId?: string; ts?: number } | null;
};

// Document history (read-only). The backend groups the Yjs update log into
// per-author editing sessions and resolves each author to a user.
type HistUser = { id: string; name: string | null; email: string | null; color: string | null };
type HistSession = {
  firstSeq: number;
  lastSeq: number;
  startedAt: number;
  endedAt: number;
  updateCount: number;
  totalBytes: number;
  origin: string | null;
  user: HistUser | null;
  changedCells: { rowId: string; colId: string }[];
};
type GridHighlight = { color: string; range: { x: number; y: number; width: number; height: number } };
type HistView = {
  seq: number;
  user: HistUser | null;
  when: number;
  data: { rowId: string; columns: ReturnType<typeof buildCell>[] }[];
  // Cells changed during this session, as glide highlight regions.
  highlights: GridHighlight[];
};
type HistState = {
  open: boolean;
  loading: boolean;
  error: string | null;
  sessions: HistSession[];
  view: HistView | null;
};

const histLabel = (u: HistUser | null) => u?.name || u?.email || 'Unknown user';
function fmtTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return String(ms);
  }
}

type Ctx = { ydoc: any; yrows: any; ycolTypes: any; provider: any };

export function SheetView({ docId, me, onBack }: { docId: string; me: User; onBack: () => void }) {
  const [meta, setMeta] = useState<any>(null);
  const [state, setState] = useState<ConnState>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('viewer');
  // Raw shared state (value-as-stored); the grid `data` is derived from this.
  const [rawRows, setRawRows] = useState<{ rowId: string; values: Record<string, any> }[]>([]);
  const [colTypes, setColTypes] = useState<Record<string, string>>({});
  // Other collaborators' presence + selected cell, via Yjs awareness.
  const [remote, setRemote] = useState<RemoteState[]>([]);
  // Our own selected cell (drives the type toolbar + the remote-cursor broadcast).
  const [sel, setSel] = useState<{ rowId: string; colId: string } | null>(null);
  // Read-only edit history (sessions list + optional snapshot being viewed).
  const [hist, setHist] = useState<HistState>({
    open: false, loading: false, error: null, sessions: [], view: null,
  });

  const ctxRef = useRef<Ctx | null>(null);
  const gridRef = useRef<any>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  // Last selected cell key — only to dedupe the grid's repeated selection-change
  // fires (so we don't re-broadcast awareness on every render).
  const lastSelKeyRef = useRef<string | null>(null);
  const [size, setSize] = useState<{ h: number; w: number }>({ h: 500, w: 0 });

  const readOnly = role !== 'editor';

  // Keep the grid sized to its container (glide-data-grid needs explicit px).
  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setSize({ h: el.clientHeight, w: el.clientWidth }));
    ro.observe(el);
    setSize({ h: el.clientHeight, w: el.clientWidth });
    return () => ro.disconnect();
  }, []);

  // Load metadata + RTC token, then open the collaborative Yjs room.
  useEffect(() => {
    let cancelled = false;
    // Tear down whatever the async block managed to create — robust against
    // React StrictMode's mount→unmount→mount (the cleanup runs before the async
    // resumes, so we can't rely on ctxRef alone).
    let local: { ydoc: any; provider: any } | null = null;
    const teardown = () => {
      if (local) {
        local.provider.destroy();
        local.ydoc.destroy();
        local = null;
      }
      lastSelKeyRef.current = null;
      ctxRef.current = null;
    };

    setState('loading');
    setErr(null);
    setRawRows([]);
    setColTypes({});
    setSel(null);
    setRemote([]);
    (async () => {
      try {
        const m = await api(`/documents/${docId}`);
        if (cancelled) return;
        setMeta(m);
        setTitle(m.title ?? '');
        const t = await api(`/documents/${docId}/rtc-token`, { method: 'POST' });
        if (cancelled) return;
        const editable = t.role === 'editor';
        setRole(editable ? 'editor' : 'viewer');
        setState('connecting');

        const ydoc = new Y.Doc();
        const yrows = ydoc.getArray(ROWS_KEY);
        const ycolTypes = ydoc.getMap(COL_TYPE_KEY);
        const provider = new WebsocketProvider(env.rtcWsUrl, `yjs/${docId}`, ydoc, {
          connect: false,
          params: { token: t.token ?? '' },
        });
        local = { ydoc, provider };
        // Unmounted while we were awaiting? Drop the freshly-built provider.
        if (cancelled) { teardown(); return; }

        // Project the shared doc into plain React state; the grid `data` (with
        // per-column types) is derived in a useMemo.
        const rebuild = () => {
          if (cancelled) return;
          const types: Record<string, string> = {};
          COLUMNS.forEach((c) => { types[c.id] = (ycolTypes.get(c.id) as string) || 'text'; });
          setColTypes(types);
          setRawRows(
            yrows.toArray().map((ymap: any) => {
              const values: Record<string, any> = {};
              COLUMNS.forEach((c) => { values[c.id] = ymap.get(c.id); });
              return { rowId: ymap.get(ID_KEY), values };
            }),
          );
        };
        yrows.observeDeep(rebuild);
        ycolTypes.observe(rebuild);

        provider.on('status', (e: { status: string }) => {
          if (cancelled) return;
          if (e.status === 'connected') { setState('connected'); setErr(null); }
          else if (e.status === 'connecting') setState('connecting');
          else if (e.status === 'disconnected') setState('disconnected');
        });
        provider.on('connection-error', () => { if (!cancelled) setState('error'); });
        // Publish our identity for awareness (used for remote-cursor color/name).
        provider.awareness?.setLocalStateField('user', {
          id: me.id,
          name: me.name ?? me.email,
          color: me.color ?? '#666',
        });
        // Track other clients' presence + selected cell.
        const onAwareness = () => {
          const aw = provider.awareness;
          const out: RemoteState[] = [];
          aw.getStates().forEach((st: any, clientId: number) => {
            if (clientId === aw.clientID || !st?.user) return;
            out.push({ clientId, user: st.user, cell: st.cell ?? null });
          });
          if (!cancelled) setRemote(out);
        };
        provider.awareness?.on('change', onAwareness);
        provider.connect();
        onAwareness();

        ctxRef.current = { ydoc, yrows, ycolTypes, provider };
        rebuild();
      } catch (e: any) {
        if (!cancelled) {
          setErr(e?.data ? JSON.stringify(e.data) : String(e));
          setState('error');
        }
      }
    })();
    return () => {
      cancelled = true;
      teardown();
    };
  }, [docId]);

  // Grid edits → Yjs. The grid hands us coordinates + the new value; we locate
  // the row's Y.Map by its stable id and set the column key. One transaction per
  // edit batch keeps undo/remote application atomic.
  const onCellEdit = useCallback(
    (edits: any[]) => {
      const ctx = ctxRef.current;
      if (!ctx || readOnly || !Array.isArray(edits)) return;
      ctx.ydoc.transact(() => {
        for (const ed of edits) {
          const rowId = ed?.cellCoods?.rowId;
          const col =
            COLUMNS.find((c) => c.id === ed?.cellCoods?.colId) ?? COLUMNS[ed?.cellCoods?.col];
          if (!rowId || !col) continue;
          // No locking: last writer wins per cell (Y.Map is LWW per key).
          const ymap = ctx.yrows.toArray().find((m: any) => m.get(ID_KEY) === rowId);
          if (ymap) ymap.set(col.id, ed?.newValue?.value ?? '');
        }
      }, 'local');
    },
    [readOnly],
  );

  const addRow = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || readOnly) return;
    ctx.ydoc.transact(() => {
      const m = new Y.Map();
      m.set(ID_KEY, newRowId());
      ctx.yrows.push([m]);
    }, 'local');
  }, [readOnly]);

  // Insert a row directly AFTER a given row (the grid's hover "+" hands us the
  // hovered rowId). Y.Array.insert at the resolved index is CRDT-safe.
  const insertRowAfter = useCallback((arg: any) => {
    const ctx = ctxRef.current;
    if (!ctx || readOnly) return;
    const rowId = arg?.rowId;
    ctx.ydoc.transact(() => {
      const idx = ctx.yrows.toArray().findIndex((m: any) => m.get(ID_KEY) === rowId);
      const m = new Y.Map();
      m.set(ID_KEY, newRowId());
      if (idx < 0) ctx.yrows.push([m]);
      else ctx.yrows.insert(idx + 1, [m]);
    }, 'local');
  }, [readOnly]);

  // Change the selected cell's COLUMN type. Stored in the shared colTypes map,
  // so every client re-renders that column with the new type (RTC-safe).
  const setColumnType = useCallback((type: CellTypeId) => {
    const ctx = ctxRef.current;
    if (!ctx || readOnly || !sel) return;
    ctx.ydoc.transact(() => { ctx.ycolTypes.set(sel.colId, type); }, 'local');
  }, [readOnly, sel]);

  // On selecting a cell: broadcast it via awareness so peers see our cursor.
  // No locking — anyone can select or edit any cell.
  const onCellSelectionChange = useCallback((cells: any[]) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const first = Array.isArray(cells) && cells.length ? cells[0] : null;
    const newKey =
      first && first.rowId != null && first.colId != null ? cellKey(first.rowId, first.colId) : null;
    // CRITICAL: the grid re-fires this on every re-render (its effect depends on
    // the data/columns identity). Bail when the selection hasn't actually moved,
    // otherwise we re-setState + re-broadcast on every render — a feedback loop
    // that amplifies awareness traffic with each extra collaborator.
    if (newKey === lastSelKeyRef.current) return;
    lastSelKeyRef.current = newKey;
    if (first && newKey) {
      setSel({ rowId: first.rowId, colId: first.colId });
      ctx.provider.awareness?.setLocalStateField('cell', { rowId: first.rowId, colId: first.colId });
    } else {
      setSel(null);
      ctx.provider.awareness?.setLocalStateField('cell', null);
    }
  }, []);

  // No locking: every cell is editable (unless the whole sheet is read-only).
  // Concurrent edits to the same cell resolve last-writer-wins via Yjs.
  const data = useMemo(
    () =>
      rawRows.map((r) => ({
        rowId: r.rowId,
        columns: COLUMNS.map((c) =>
          buildCell(r.values[c.id], colTypes[c.id] || 'text', !readOnly),
        ),
      })),
    [rawRows, colTypes, readOnly],
  );

  // Map peers' selected cells to glide highlight regions (their cursor) in the
  // current row order. Each peer gets a translucent fill in their color.
  const remoteHighlights = useMemo(() => {
    if (!remote.length || !rawRows.length) return [];
    const rowIdx = new Map<string, number>(rawRows.map((r, i) => [r.rowId, i]));
    const out: { color: string; range: { x: number; y: number; width: number; height: number } }[] = [];
    for (const s of remote) {
      if (!s.cell) continue;
      const col = COLUMNS.findIndex((c) => c.id === s.cell!.colId);
      const row = s.cell!.rowId != null ? rowIdx.get(s.cell!.rowId) : undefined;
      if (col < 0 || row === undefined) continue;
      out.push({ color: hexToRgba(s.user?.color || '#666', 0.28), range: { x: col, y: row, width: 1, height: 1 } });
    }
    return out;
  }, [remote, rawRows]);

  // Open the history panel and (re)load the session list.
  const openHistory = useCallback(async () => {
    setHist((h) => ({ ...h, open: true, loading: true, error: null }));
    try {
      const res = await api(`/documents/${docId}/history`);
      setHist((h) => ({ ...h, loading: false, sessions: res?.sessions ?? [] }));
    } catch (e: any) {
      setHist((h) => ({ ...h, loading: false, error: e?.data ? JSON.stringify(e.data) : String(e) }));
    }
  }, [docId]);

  const closeHistory = useCallback(() => {
    setHist((h) => ({ ...h, open: false, view: null }));
  }, []);

  // Fetch the grid state AFTER the given session's last update and show it
  // read-only. The snapshot is built with the same buildCell logic as the live
  // grid, but every cell is non-editable.
  const viewSnapshot = useCallback(
    async (s: HistSession) => {
      setHist((h) => ({ ...h, loading: true, error: null }));
      try {
        const res = await api(`/documents/${docId}/history/${s.lastSeq}`);
        const sheet = res?.sheet ?? { rows: [], colTypes: {} };
        const rows = (sheet.rows ?? []) as { rowId: string; values: Record<string, any> }[];
        const data = rows.map((r) => ({
          rowId: r.rowId,
          columns: COLUMNS.map((c) =>
            buildCell(r.values?.[c.id], (sheet.colTypes?.[c.id] as string) || 'text', false),
          ),
        }));
        // Shade the cells this session changed (added/updated), in the snapshot's
        // row order, using the author's color.
        const rowIdx = new Map<string, number>(rows.map((r, i) => [r.rowId, i]));
        const fill = hexToRgba(s.user?.color || '#2e7d32', 0.32);
        const highlights: GridHighlight[] = [];
        for (const cc of s.changedCells ?? []) {
          const x = COLUMNS.findIndex((c) => c.id === cc.colId);
          const y = rowIdx.get(cc.rowId);
          if (x < 0 || y === undefined) continue;
          highlights.push({ color: fill, range: { x, y, width: 1, height: 1 } });
        }
        setHist((h) => ({
          ...h,
          loading: false,
          view: { seq: res?.seq ?? s.lastSeq, user: s.user, when: s.endedAt, data, highlights },
        }));
      } catch (e: any) {
        setHist((h) => ({ ...h, loading: false, error: e?.data ? JSON.stringify(e.data) : String(e) }));
      }
    },
    [docId],
  );

  async function saveTitle() {
    if (!meta || readOnly || title === meta.title) return;
    try {
      setMeta(await api(`/documents/${docId}`, { method: 'PATCH', body: { title } }));
    } catch (e: any) {
      setErr(e?.data ? JSON.stringify(e.data) : String(e));
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="row" style={{ justifyContent: 'space-between', borderBottom: '1px solid #e9e9e7', paddingBottom: 8, marginBottom: 8 }}>
        <div className="row">
          <button onClick={onBack}>← Back</button>
          <input className="title-input" value={title} disabled={readOnly} placeholder="Untitled"
            onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle}
            style={{ fontSize: 16, fontWeight: 600, minWidth: 280 }} />
        </div>
        <div className="row" style={{ gap: 8 }}>
          {remote.length > 0 && (
            <span className="row" style={{ gap: 4 }} title={`${remote.length} other${remote.length > 1 ? 's' : ''} here`}>
              {remote.slice(0, 5).map((r) => (
                <span key={r.clientId} title={r.user?.name}
                  style={{ width: 18, height: 18, borderRadius: '50%', background: r.user?.color || '#666',
                    color: '#fff', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  {(r.user?.name || '?').trim().charAt(0).toUpperCase()}
                </span>
              ))}
            </span>
          )}
          {!readOnly && <button onClick={addRow}>+ Add row</button>}
          <button onClick={() => (hist.open ? closeHistory() : openHistory())}
            style={{ fontWeight: hist.open ? 700 : 400 }}>
            🕘 History
          </button>
          <span className="tag" title={`Connection: ${state}`}>{state}</span>
        </div>
      </div>
      {!readOnly && (
        <div className="row" style={{ gap: 6, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {sel ? `Column ${sel.colId.toUpperCase()} type:` : 'Select a cell to set its column type'}
          </span>
          {SUPPORTED_TYPES.map((t) => {
            const active = !!sel && (colTypes[sel.colId] || 'text') === t.id;
            return (
              <button key={t.id} disabled={!sel} onClick={() => setColumnType(t.id)}
                style={{ fontWeight: active ? 700 : 400, opacity: sel ? 1 : 0.5 }}>
                {t.label}
              </button>
            );
          })}
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 8 }}>
            Hover a row’s left edge for “+” to insert a row below it.
          </span>
        </div>
      )}
      {err && <div className="banner">{err}</div>}
      {meta && readOnly && !hist.view && <div className="banner">View-only — your edits won’t be saved.</div>}
      {hist.view && (
        <div className="banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>
            🕘 Viewing a past version — edited by <strong>{histLabel(hist.view.user)}</strong> · {fmtTime(hist.view.when)} (read-only)
          </span>
          <button onClick={() => setHist((h) => ({ ...h, view: null }))}>Back to live</button>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 360, display: 'flex', gap: 0 }}>
        <div ref={hostRef} style={{ flex: 1, minHeight: 360 }}>
          {state === 'error' && !meta ? (
            <div style={{ padding: 24 }} className="muted">Failed to open sheet.</div>
          ) : hist.view ? (
            <DataGrid
              headers={COLUMNS}
              data={hist.view.data}
              rowHeight={40}
              dataGridHeight={size.h || 500}
              dataGridWidth="100%"
              isViewMode={true}
              remoteHighlights={hist.view.highlights}
            />
          ) : (
            <DataGrid
              ref={gridRef}
              headers={COLUMNS}
              data={data}
              rowHeight={40}
              dataGridHeight={size.h || 500}
              dataGridWidth="100%"
              isViewMode={readOnly}
              onCellEdit={onCellEdit}
              onCellSelectionChange={onCellSelectionChange}
              onRowHandlerClick={readOnly ? undefined : insertRowAfter}
              remoteHighlights={remoteHighlights}
              onAppendRowAtEnd={readOnly ? undefined : addRow}
            />
          )}
        </div>
        {hist.open && (
          <div style={{ width: 300, flexShrink: 0, borderLeft: '1px solid #e9e9e7', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="row" style={{ justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid #e9e9e7' }}>
              <strong style={{ fontSize: 13 }}>Edit history</strong>
              <button onClick={closeHistory} title="Close">✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
              {hist.loading && <div className="muted" style={{ padding: 8 }}>Loading…</div>}
              {hist.error && <div className="banner">{hist.error}</div>}
              {!hist.loading && !hist.error && hist.sessions.length === 0 && (
                <div className="muted" style={{ padding: 8, fontSize: 13 }}>No edits yet.</div>
              )}
              {hist.sessions.map((s) => {
                const active = hist.view?.seq === s.lastSeq;
                const color = s.user?.color || '#666';
                return (
                  <button
                    key={`${s.firstSeq}-${s.lastSeq}`}
                    onClick={() => viewSnapshot(s)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                      textAlign: 'left', padding: '8px', marginBottom: 4, borderRadius: 6,
                      border: active ? '1px solid #4571e6' : '1px solid transparent',
                      background: active ? '#eef2ff' : 'transparent', cursor: 'pointer',
                    }}
                  >
                    <span style={{
                      width: 22, height: 22, borderRadius: '50%', background: color, color: '#fff',
                      fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center',
                      justifyContent: 'center', flexShrink: 0,
                    }}>
                      {histLabel(s.user).trim().charAt(0).toUpperCase()}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {histLabel(s.user)}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {fmtTime(s.endedAt)}
                        {' · '}
                        {(s.changedCells?.length ?? 0) > 0
                          ? `${s.changedCells.length} cell${s.changedCells.length === 1 ? '' : 's'} changed`
                          : `${s.updateCount} update${s.updateCount === 1 ? '' : 's'}`}
                        {s.origin === 'archive' ? ' · archived' : ''}
                      </div>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
