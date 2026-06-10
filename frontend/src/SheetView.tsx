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
  // Our own selected cell (drives the type toolbar + our lock claim).
  const [sel, setSel] = useState<{ rowId: string; colId: string } | null>(null);
  // Authoritative cell locks from the rtc-server: cellKey -> owner userId.
  const [locks, setLocks] = useState<Record<string, string>>({});
  // Brief notice when you click a cell someone else is editing.
  const [lockedMsg, setLockedMsg] = useState<string | null>(null);

  const ctxRef = useRef<Ctx | null>(null);
  const gridRef = useRef<any>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const lastActivity = useRef<number>(0);
  const lockWsRef = useRef<WebSocket | null>(null);
  const heldKeyRef = useRef<string | null>(null);
  const locksRef = useRef<Record<string, string>>({});
  // The grid tells us when a cell editor is open (any cell type). True = the
  // user is actively in a cell → never AFK-release the lock under them.
  const isEditingRef = useRef<boolean>(false);
  const [size, setSize] = useState<{ h: number; w: number }>({ h: 500, w: 0 });

  const readOnly = role !== 'editor';
  const myId = me.id;
  const sendLock = useCallback((op: string, cell: string) => {
    const ws = lockWsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op, cell }));
  }, []);

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
    let local: { ydoc: any; provider: any; lockWs: WebSocket } | null = null;
    const teardown = () => {
      if (local) {
        try { local.lockWs.close(); } catch { /* ignore */ }
        local.provider.destroy();
        local.ydoc.destroy();
        local = null;
      }
      lockWsRef.current = null;
      heldKeyRef.current = null;
      ctxRef.current = null;
    };

    setState('loading');
    setErr(null);
    setRawRows([]);
    setColTypes({});
    setSel(null);
    setRemote([]);
    setLocks({});
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
        // Authoritative lock channel — a separate WS path on the rtc-server.
        // The server grants/denies cell locks; we render the snapshot it pushes.
        const lockWs = new WebSocket(
          `${env.rtcWsUrl}/locks/${docId}?token=${encodeURIComponent(t.token ?? '')}`,
        );
        lockWs.onmessage = (ev) => {
          try {
            const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
            if (msg?.type === 'snapshot' && !cancelled) {
              locksRef.current = msg.locks || {};
              setLocks(msg.locks || {});
            }
          } catch { /* ignore */ }
        };
        lockWsRef.current = lockWs;
        local = { ydoc, provider, lockWs };
        // Unmounted while we were awaiting? Drop the freshly-built provider.
        if (cancelled) { teardown(); return; }

        // Project the shared doc into plain React state; the grid `data` (with
        // per-column types + lock-driven editability) is derived in a useMemo.
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
          // Defense in depth: drop writes to a cell ANOTHER user holds. (A free
          // cell is allowed — the grant may still be in flight; the server lock
          // already prevents a real conflict.) Read the live ref, not state.
          const owner = locksRef.current[cellKey(rowId, col.id)];
          if (owner && owner !== myId) continue;
          const ymap = ctx.yrows.toArray().find((m: any) => m.get(ID_KEY) === rowId);
          if (ymap) ymap.set(col.id, ed?.newValue?.value ?? '');
        }
      }, 'local');
    },
    [readOnly, myId],
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

  // On selecting a cell: release the cell we were on and ask the server to lock
  // the new one. Also broadcast it via awareness for the remote cursor. Editing
  // stays gated on the server actually granting the lock (see `data`).
  const onCellSelectionChange = useCallback((cells: any[]) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const first = Array.isArray(cells) && cells.length ? cells[0] : null;
    const newKey =
      first && first.rowId != null && first.colId != null ? cellKey(first.rowId, first.colId) : null;
    // CRITICAL: the grid re-fires this on every re-render (its effect depends on
    // the data/columns identity). Bail when the selection hasn't actually moved,
    // otherwise we re-setState + re-broadcast on every render — a feedback loop
    // that amplifies awareness+lock traffic with each extra collaborator.
    if (newKey === heldKeyRef.current) return;
    lastActivity.current = Date.now();
    if (heldKeyRef.current) sendLock('release', heldKeyRef.current);
    // Don't enter a cell another user is editing: clear the selection so we
    // never show a second cursor inside someone else's locked cell.
    if (newKey && locksRef.current[newKey] && locksRef.current[newKey] !== myId) {
      heldKeyRef.current = null;
      setSel(null);
      ctx.provider.awareness?.setLocalStateField('cell', null);
      gridRef.current?.selection?.clear?.();
      setLockedMsg('That cell is being edited by someone else.');
      window.setTimeout(() => setLockedMsg(null), 1800);
      return;
    }
    setLockedMsg(null);
    heldKeyRef.current = newKey;
    if (first && newKey) {
      if (!readOnly) sendLock('acquire', newKey);
      setSel({ rowId: first.rowId, colId: first.colId });
      ctx.provider.awareness?.setLocalStateField('cell', { rowId: first.rowId, colId: first.colId });
    } else {
      setSel(null);
      ctx.provider.awareness?.setLocalStateField('cell', null);
    }
  }, [readOnly, sendLock, myId]);

  // The grid reports when a cell editor opens/closes (any type). We use it only
  // to keep the AFK timer from releasing a lock while the user is editing.
  const onCellEditStateChange = useCallback((editing: boolean) => {
    isEditingRef.current = !!editing;
    if (editing) lastActivity.current = Date.now();
  }, []);

  // Editing is allowed only on a cell whose server lock I hold — this is what
  // makes "click → wait for grant → edit" safe against two simultaneous clicks.
  const data = useMemo(
    () =>
      rawRows.map((r) => ({
        rowId: r.rowId,
        columns: COLUMNS.map((c) => {
          // Editable when the cell is FREE or held by me. A cell another user
          // holds is read-only (its editor won't open). We claim the lock when
          // the editor actually opens; the server arbitrates simultaneous opens
          // and the commit is gated on ownership (see onCellEdit).
          const owner = locks[cellKey(r.rowId, c.id)];
          const editable = !readOnly && (!owner || owner === myId);
          return buildCell(r.values[c.id], colTypes[c.id] || 'text', editable);
        }),
      })),
    [rawRows, colTypes, readOnly, locks, myId],
  );

  // Map peers' claimed cells to glide highlight regions (their cursor = their
  // lock) in the current row order. Each peer gets a fill + dashed border.
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

  // Any keydown/pointer in the grid host counts as activity — this catches
  // typing inside the cell editor, which doesn't fire selection events.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const mark = () => { lastActivity.current = Date.now(); };
    el.addEventListener('keydown', mark, true);
    el.addEventListener('pointerdown', mark, true);
    return () => {
      el.removeEventListener('keydown', mark, true);
      el.removeEventListener('pointerdown', mark, true);
    };
  }, []);

  // If a cell I'm on becomes owned by someone else (I lost a simultaneous-click
  // race, or it got taken), yield immediately: clear selection + cursor so two
  // users never appear in the same cell.
  useEffect(() => {
    const key = heldKeyRef.current;
    if (key && locks[key] && locks[key] !== myId) {
      heldKeyRef.current = null;
      gridRef.current?.selection?.clear?.();
      setSel(null);
      ctxRef.current?.provider?.awareness?.setLocalStateField('cell', null);
      setLockedMsg('That cell is being edited by someone else.');
      window.setTimeout(() => setLockedMsg(null), 1800);
    }
  }, [locks, myId]);

  // While we OWN a cell: heartbeat to keep the server lock; if 10s pass with no
  // activity (AFK), release it + focus out so others can take it.
  useEffect(() => {
    if (!sel || readOnly) return;
    const iv = setInterval(() => {
      const key = heldKeyRef.current;
      const owned = !!key && locksRef.current[key] === myId;
      if (!owned) return;
      // While a cell editor is open (ANY type — reported by the grid, not via
      // DOM sniffing) the user is in the cell → keep the lock alive. AFK only
      // applies to a cell that's merely selected and idle for 10s.
      if (isEditingRef.current) lastActivity.current = Date.now();
      if (Date.now() - lastActivity.current >= 10000) {
        sendLock('release', key);
        heldKeyRef.current = null;
        gridRef.current?.selection?.clear?.();
        setSel(null);
        ctxRef.current?.provider?.awareness?.setLocalStateField('cell', null);
      } else {
        sendLock('heartbeat', key);
      }
    }, 3000);
    return () => clearInterval(iv);
  }, [sel, readOnly, sendLock, myId]);

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
      {meta && readOnly && <div className="banner">View-only — your edits won’t be saved.</div>}
      {lockedMsg && <div className="banner">🔒 {lockedMsg}</div>}
      <div ref={hostRef} style={{ flex: 1, minHeight: 360 }}>
        {state === 'error' && !meta ? (
          <div style={{ padding: 24 }} className="muted">Failed to open sheet.</div>
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
            onCellEditStateChange={onCellEditStateChange}
            onRowHandlerClick={readOnly ? undefined : insertRowAfter}
            remoteHighlights={remoteHighlights}
            onAppendRowAtEnd={readOnly ? undefined : addRow}
          />
        )}
      </div>
    </div>
  );
}
