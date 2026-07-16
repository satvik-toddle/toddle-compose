import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import {
  InstancePresenceRecordType,
  UserRecordType,
  atom,
  createPresenceStateDerivation,
  createTLStore,
  createUserId,
  defaultBindingUtils,
  defaultShapeUtils,
  react,
  type TLInstancePresence,
  type TLRecord,
  type TLStoreWithStatus,
} from 'tldraw';
import { RTC_WS_URL } from '../../../lib/env';
import { attachTokenRecovery } from '../rtcReconnect';

// Yjs shared-type key for the whiteboard: one Y.Map of TLRecords keyed by record
// id (per-record LWW, same granularity as tldraw's own sync). Distinct from the
// sheet's 'rows' key, which rtc-server history uses to sniff doc kinds.
const RECORDS_KEY = 'tldraw';

// Presence identity for logged-out collaborators.
const ANON_NAME = 'Anonymous';
const ANON_COLOR = '#4f52d9';

// Origin marker so our own Yjs transactions are ignored by the remote observer.
const LOCAL_ORIGIN = 'tldraw-local';

type UseYjsTldrawStoreArgs = {
  docId: string;
  token: string;
  user: { id: string; name: string; color: string } | null;
  // Re-mints the RTC token; the fresh token reaches the provider via paramsRef.
  refetchToken?: () => Promise<unknown>;
};

// Binds a tldraw store to Yjs over the app's rtc-server websocket: document-scope
// records sync through a Y.Map; cursors/selections ride Yjs awareness as tldraw
// presence records. Returns a TLStoreWithStatus so <Tldraw> shows its own loading
// state until the first server sync. Undo/redo stays tldraw's local history —
// not Yjs-scoped, so it can't precisely exclude collaborators' concurrent ops.
export function useYjsTldrawStore({ docId, token, user, refetchToken }: UseYjsTldrawStoreArgs) {
  // y-websocket re-reads params.token on every reconnect; mutating this ref keeps a
  // long-lived session authed with a fresh token without tearing down the live doc.
  const paramsRef = useRef<{ token: string }>({ token });
  paramsRef.current.token = token;
  const refetchTokenRef = useRef(refetchToken);
  refetchTokenRef.current = refetchToken;
  // Set by the session effect; lets name/color changes update presence in place
  // instead of tearing down the live store/provider.
  const setPresenceUserRef = useRef<((u: { name: string; color: string }) => void) | null>(null);

  const [storeWithStatus, setStoreWithStatus] = useState<TLStoreWithStatus>({ status: 'loading' });

  useEffect(() => {
    const store = createTLStore({
      shapeUtils: defaultShapeUtils,
      bindingUtils: defaultBindingUtils,
    });
    const ydoc = new Y.Doc();
    const yRecords = ydoc.getMap<TLRecord>(RECORDS_KEY);
    const provider = new WebsocketProvider(RTC_WS_URL, docId, ydoc, {
      params: paramsRef.current,
      connect: true,
    });
    const unsubs: (() => void)[] = [];
    const isDocScope = (r: TLRecord) => store.scopedTypes.document.has(r.typeName);

    // tldraw -> Yjs (document scope only; session/presence records stay local).
    unsubs.push(
      store.listen(
        ({ changes }) => {
          ydoc.transact(() => {
            for (const record of Object.values(changes.added)) yRecords.set(record.id, record);
            for (const [, record] of Object.values(changes.updated)) {
              yRecords.set(record.id, record);
            }
            for (const record of Object.values(changes.removed)) yRecords.delete(record.id);
          }, LOCAL_ORIGIN);
        },
        { source: 'user', scope: 'document' },
      ),
    );

    // Yjs -> tldraw.
    const onYRecords = (events: Y.YMapEvent<TLRecord>, txn: Y.Transaction) => {
      if (txn.origin === LOCAL_ORIGIN) return;
      const toPut: TLRecord[] = [];
      const toRemove: TLRecord['id'][] = [];
      for (const [id, change] of events.keys) {
        if (change.action === 'delete') toRemove.push(id as TLRecord['id']);
        else {
          const record = yRecords.get(id);
          if (record) toPut.push(record);
        }
      }
      store.mergeRemoteChanges(() => {
        if (toRemove.length) store.remove(toRemove);
        if (toPut.length) store.put(toPut);
      });
    };
    yRecords.observe(onYRecords);
    unsubs.push(() => yRecords.unobserve(onYRecords));

    // Presence over awareness: derive tldraw's presence record from the store and
    // publish it; mirror other clients' presence records into the store.
    const awareness = provider.awareness;
    const presenceId = InstancePresenceRecordType.createId(String(awareness.clientID));
    const presenceUser = atom(
      'presence user',
      UserRecordType.create({
        id: createUserId(String(awareness.clientID)),
        name: user?.name ?? ANON_NAME,
        color: user?.color ?? ANON_COLOR,
      }),
    );
    setPresenceUserRef.current = ({ name, color }) =>
      presenceUser.update((u) => ({ ...u, name, color }));
    const presenceSignal = createPresenceStateDerivation(presenceUser, {
      instanceId: presenceId,
    })(store);
    unsubs.push(
      react('push tldraw presence to awareness', () => {
        awareness.setLocalStateField('presence', presenceSignal.get());
      }),
    );
    const onAwareness = ({
      added,
      updated,
      removed,
    }: {
      added: number[];
      updated: number[];
      removed: number[];
    }) => {
      const toPut: TLInstancePresence[] = [];
      for (const clientId of [...added, ...updated]) {
        if (clientId === awareness.clientID) continue;
        const presence = awareness.getStates().get(clientId)?.presence as
          | TLInstancePresence
          | undefined;
        if (presence) toPut.push(presence);
      }
      const toRemove = removed.map((clientId) =>
        InstancePresenceRecordType.createId(String(clientId)),
      );
      store.mergeRemoteChanges(() => {
        if (toRemove.length) store.remove(toRemove);
        if (toPut.length) store.put(toPut);
      });
    };
    awareness.on('change', onAwareness);
    unsubs.push(() => awareness.off('change', onAwareness));

    let hasSynced = false;

    // First server sync only: adopt the server's document records (dropping the
    // fresh store's default page so boards don't grow a duplicate), or leave the
    // local defaults in place for a brand-new board — they sync on first edit.
    // Reconnects re-emit 'sync' but Yjs delivers diffs through the observer; re-
    // running the adoption there would race the frame-throttled listener above.
    const onSync = (isSynced: boolean) => {
      if (!isSynced) return;
      if (!hasSynced) {
        hasSynced = true;
        if (yRecords.size > 0) {
          const remoteIds = new Set(yRecords.keys());
          store.mergeRemoteChanges(() => {
            store.remove(
              store
                .allRecords()
                .filter((r) => isDocScope(r) && !remoteIds.has(r.id))
                .map((r) => r.id),
            );
            store.put([...yRecords.values()]);
          });
        }
      }
      setStoreWithStatus({ store, status: 'synced-remote', connectionStatus: 'online' });
    };
    provider.on('sync', onSync);
    if (provider.synced) onSync(true);

    const onStatus = ({ status }: { status: string }) => {
      if (!hasSynced) return; // <Tldraw> keeps its loading UI until the first sync
      setStoreWithStatus({
        store,
        status: 'synced-remote',
        connectionStatus: status === 'connected' ? 'online' : 'offline',
      });
    };
    provider.on('status', onStatus);

    // Shared re-mint protocol; if the socket never syncs at all, surface an error
    // instead of loading forever.
    unsubs.push(
      attachTokenRecovery(
        provider,
        () => refetchTokenRef.current?.(),
        (failures) => {
          if (!hasSynced && failures >= 5) {
            provider.disconnect();
            setStoreWithStatus({
              status: 'error',
              error: new Error("Couldn't connect to the whiteboard server"),
            });
          }
        },
      ),
    );

    return () => {
      unsubs.forEach((fn) => fn());
      provider.off('sync', onSync);
      provider.off('status', onStatus);
      setPresenceUserRef.current = null;
      setStoreWithStatus({ status: 'loading' });
      provider.destroy();
      ydoc.destroy();
      store.dispose();
    };
  }, [docId, user?.id]);

  // Presence metadata rides the live session; never tears it down.
  useEffect(() => {
    setPresenceUserRef.current?.({
      name: user?.name ?? ANON_NAME,
      color: user?.color ?? ANON_COLOR,
    });
  }, [user?.name, user?.color]);

  return storeWithStatus;
}
