import { Y } from '@toddle-edu/ds-doc-editor';

type Handler = (...args: unknown[]) => void;

// The subset of y-protocols Awareness that Lexical's CollaborationPlugin touches
// (getStates/getLocalState/setLocalState/on/off). In a read-only snapshot there
// are no live peers, so every method is inert.
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

// A y-websocket-shaped provider that never opens a socket. It reproduces exactly
// what the live server does on connect — deliver the document's state as a single
// Yjs update — but from a static snapshot instead of the network. Applying that
// update *after* the CollaborationPlugin has registered its observer (i.e. inside
// connect(), on a microtask) is what drives the content into Lexical, matching the
// live render path precisely. No socket, no room, no risk to the live document.
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
    // Defer to a microtask so the plugin's Yjs observer is registered before we
    // deliver the snapshot; then announce a completed sync (doc already populated,
    // so the plugin's empty-doc bootstrap is a no-op).
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
