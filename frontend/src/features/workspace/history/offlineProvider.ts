import { Y } from '@toddle-edu/ds-doc-editor';

type Handler = (...args: unknown[]) => void;

// The subset of y-protocols Awareness that Lexical's CollaborationPlugin touches; inert in a read-only snapshot (no live peers).
class NoopAwareness {
  clientID: number;
  states = new Map<number, Record<string, unknown>>();
  meta = new Map();
  constructor(doc: InstanceType<typeof Y.Doc>) {
    this.clientID = doc.clientID;
  }
  getStates() {
    return this.states;
  }
  getLocalState(): Record<string, unknown> | null {
    return null;
  }
  setLocalState(_state: Record<string, unknown> | null) {}
  setLocalStateField(_field: string, _value: unknown) {}
  on() {}
  off() {}
  destroy() {
    this.states.clear();
  }
}

// A y-websocket-shaped provider that never opens a socket: it delivers the doc's state as one Yjs update from a static snapshot, applied inside connect() on a microtask (after the plugin's observer registers) to drive content into Lexical exactly as the live path does.
export class OfflineProvider {
  awareness: NoopAwareness;
  private handlers = new Map<string, Set<Handler>>();
  private doc: InstanceType<typeof Y.Doc>;
  private update: Uint8Array | null;

  constructor(doc: InstanceType<typeof Y.Doc>, update: Uint8Array | null) {
    this.doc = doc;
    this.update = update;
    this.awareness = new NoopAwareness(doc);
  }

  on(type: string, cb: Handler) {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(cb);
  }

  off(type: string, cb: Handler) {
    this.handlers.get(type)?.delete(cb);
  }

  private emit(type: string, args: unknown[]) {
    this.handlers.get(type)?.forEach((cb) => cb(...args));
  }

  connect() {
    // Defer to a microtask so the plugin's Yjs observer registers before we deliver the snapshot, then announce a completed sync (doc already populated, so bootstrap is a no-op).
    queueMicrotask(() => {
      this.emit('status', [{ status: 'connected' }]);
      if (this.update) Y.applyUpdate(this.doc, this.update, this);
      this.emit('sync', [true]);
    });
  }

  disconnect() {
    this.emit('status', [{ status: 'disconnected' }]);
  }

  destroy() {
    this.awareness.destroy();
    this.handlers.clear();
  }
}
