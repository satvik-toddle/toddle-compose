import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { RTC_WS_URL } from '../../../lib/env';

// Yjs shared-type keys: one Y.Map per collection, keyed by node/edge id
// (per-record LWW, same granularity as the tldraw binding). Distinct from the
// sheet's 'rows' key, which rtc-server history uses to sniff doc kinds.
const NODES_KEY = 'flow-nodes';
const EDGES_KEY = 'flow-edges';

// Origin marker so our own Yjs transactions are ignored by the remote observer.
const LOCAL_ORIGIN = 'flow-local';

// A collaborator's live pointer, published over Yjs awareness in flow coordinates.
export type FlowCursor = { clientId: number; name: string; color: string; x: number; y: number };

type UseYjsReactFlowArgs = {
  docId: string;
  token: string;
  user: { id: string; name: string; color: string } | null;
};

// Ephemeral/runtime fields stay local: selection and drag state are per-client,
// `measured` is re-derived from the DOM on every mount.
function persistableNode(node: Node): Node {
  const { selected: _s, dragging: _d, measured: _m, ...rest } = node;
  return rest as Node;
}

function persistableEdge(edge: Edge): Edge {
  const { selected: _s, ...rest } = edge;
  return rest as Edge;
}

// Merge a remote record into local state, keeping this client's selection flag.
function mergeRecord<T extends { id: string; selected?: boolean }>(prev: T[], record: T): T[] {
  const existing = prev.find((r) => r.id === record.id);
  if (!existing) return [...prev, record];
  return prev.map((r) => (r.id === record.id ? { ...record, selected: r.selected } : r));
}

// Binds React Flow's controlled nodes/edges state to Yjs over the app's
// rtc-server websocket. React Flow has no first-party collab layer, so this is
// the whole binding: local changes are applied to React state and mirrored into
// two Y.Maps; remote map events are merged back into state; pointers ride Yjs
// awareness. No undo wiring — React Flow leaves history to the app.
export function useYjsReactFlow({ docId, token, user }: UseYjsReactFlowArgs) {
  // y-websocket re-reads params.token on every reconnect; mutating this ref keeps a
  // long-lived session authed with a fresh token without tearing down the live doc.
  const paramsRef = useRef<{ token: string }>({ token });
  paramsRef.current.token = token;

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [cursors, setCursors] = useState<FlowCursor[]>([]);
  const [synced, setSynced] = useState(false);

  const ydocRef = useRef<{
    ydoc: Y.Doc;
    yNodes: Y.Map<Node>;
    yEdges: Y.Map<Edge>;
    awareness: WebsocketProvider['awareness'];
  } | null>(null);

  useEffect(() => {
    const ydoc = new Y.Doc();
    const yNodes = ydoc.getMap<Node>(NODES_KEY);
    const yEdges = ydoc.getMap<Edge>(EDGES_KEY);
    const provider = new WebsocketProvider(RTC_WS_URL, docId, ydoc, {
      params: paramsRef.current,
      connect: true,
    });
    ydocRef.current = { ydoc, yNodes, yEdges, awareness: provider.awareness };

    // Yjs -> React state. event.keys is lazy and only valid during the observer
    // call, so changes are extracted here and the async setState sees plain data.
    const extract = <T,>(event: Y.YMapEvent<T>, map: Y.Map<T>) => {
      const removed: string[] = [];
      const put: T[] = [];
      for (const [id, change] of event.keys) {
        if (change.action === 'delete') removed.push(id);
        else {
          const record = map.get(id);
          if (record) put.push(record);
        }
      }
      return { removed, put };
    };
    const onYNodes = (event: Y.YMapEvent<Node>, txn: Y.Transaction) => {
      if (txn.origin === LOCAL_ORIGIN) return;
      const { removed, put } = extract(event, yNodes);
      setNodes((prev) => {
        let next = removed.length ? prev.filter((n) => !removed.includes(n.id)) : prev;
        for (const record of put) next = mergeRecord(next, record);
        return next;
      });
    };
    const onYEdges = (event: Y.YMapEvent<Edge>, txn: Y.Transaction) => {
      if (txn.origin === LOCAL_ORIGIN) return;
      const { removed, put } = extract(event, yEdges);
      setEdges((prev) => {
        let next = removed.length ? prev.filter((e) => !removed.includes(e.id)) : prev;
        for (const record of put) next = mergeRecord(next, record);
        return next;
      });
    };
    yNodes.observe(onYNodes);
    yEdges.observe(onYEdges);

    // Collaborator pointers from awareness (this client's own is excluded).
    const awareness = provider.awareness;
    const onAwareness = () => {
      const next: FlowCursor[] = [];
      for (const [clientId, state] of awareness.getStates()) {
        if (clientId === awareness.clientID) continue;
        const cursor = state.cursor as { x: number; y: number } | undefined;
        const who = state.user as { name?: string; color?: string } | undefined;
        if (cursor) {
          next.push({
            clientId,
            name: who?.name ?? 'Anonymous',
            color: who?.color ?? '#4f52d9',
            x: cursor.x,
            y: cursor.y,
          });
        }
      }
      setCursors(next);
    };
    awareness.on('change', onAwareness);
    if (user) {
      awareness.setLocalStateField('user', { name: user.name, color: user.color });
    }

    // First server sync: adopt the server's records wholesale.
    const onSync = (isSynced: boolean) => {
      if (!isSynced) return;
      setNodes([...yNodes.values()]);
      setEdges([...yEdges.values()]);
      setSynced(true);
    };
    provider.on('sync', onSync);
    if (provider.synced) onSync(true);

    return () => {
      yNodes.unobserve(onYNodes);
      yEdges.unobserve(onYEdges);
      awareness.off('change', onAwareness);
      provider.off('sync', onSync);
      ydocRef.current = null;
      setSynced(false);
      setNodes([]);
      setEdges([]);
      setCursors([]);
      provider.destroy();
      ydoc.destroy();
    };
  }, [docId, user?.id, user?.name, user?.color]);

  // React Flow -> Yjs. Selection/dimension changes are per-client and stay local.
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((prev) => {
      const next = applyNodeChanges(changes, prev);
      const ctx = ydocRef.current;
      if (ctx) {
        ctx.ydoc.transact(() => {
          for (const change of changes) {
            if (change.type === 'remove') ctx.yNodes.delete(change.id);
            else if (
              change.type === 'add' ||
              change.type === 'replace' ||
              change.type === 'position'
            ) {
              const id = change.type === 'add' ? change.item.id : change.id;
              const node = next.find((n) => n.id === id);
              if (node) ctx.yNodes.set(id, persistableNode(node));
            }
          }
        }, LOCAL_ORIGIN);
      }
      return next;
    });
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((prev) => {
      const next = applyEdgeChanges(changes, prev);
      const ctx = ydocRef.current;
      if (ctx) {
        ctx.ydoc.transact(() => {
          for (const change of changes) {
            if (change.type === 'remove') ctx.yEdges.delete(change.id);
            else if (change.type === 'add' || change.type === 'replace') {
              const id = change.type === 'add' ? change.item.id : change.id;
              const edge = next.find((e) => e.id === id);
              if (edge) ctx.yEdges.set(id, persistableEdge(edge));
            }
          }
        }, LOCAL_ORIGIN);
      }
      return next;
    });
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((prev) => {
      const next = addEdge(connection, prev);
      const added = next.find((e) => !prev.includes(e));
      const ctx = ydocRef.current;
      if (added && ctx) {
        ctx.ydoc.transact(() => ctx.yEdges.set(added.id, persistableEdge(added)), LOCAL_ORIGIN);
      }
      return next;
    });
  }, []);

  const addNode = useCallback((node: Node) => {
    setNodes((prev) => [...prev, node]);
    const ctx = ydocRef.current;
    if (ctx) {
      ctx.ydoc.transact(() => ctx.yNodes.set(node.id, persistableNode(node)), LOCAL_ORIGIN);
    }
  }, []);

  // Publish this client's pointer (flow coordinates); null hides it.
  const setCursor = useCallback((position: { x: number; y: number } | null) => {
    ydocRef.current?.awareness.setLocalStateField('cursor', position);
  }, []);

  return { nodes, edges, cursors, synced, onNodesChange, onEdgesChange, onConnect, addNode, setCursor };
}
