import { create } from 'zustand';

export type UploadStatus = 'uploading' | 'done' | 'error';

// One in-flight or finished upload, surfaced in the bottom-right progress panel.
export interface UploadItem {
  id: string;
  name: string;
  size: number; // bytes (0 if unknown)
  type: string; // mime type
  progress: number; // 0-100
  status: UploadStatus;
  error?: string;
}

interface UploadState {
  items: UploadItem[];
  collapsed: boolean;
  start: (f: { name: string; size: number; type: string }) => string;
  setProgress: (id: string, progress: number) => void;
  complete: (id: string) => void;
  fail: (id: string, error: string) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
  dismissAll: () => void;
  setCollapsed: (v: boolean) => void;
}

let seq = 0;

const patch = (id: string, p: Partial<UploadItem>) => (s: UploadState) => ({
  items: s.items.map((it) => (it.id === id ? { ...it, ...p } : it)),
});

export const useUploadStore = create<UploadState>((set) => ({
  items: [],
  collapsed: false,
  start: (f) => {
    const id = `up_${++seq}`;
    set((s) => ({
      // A new upload re-expands the panel so the user sees it start.
      collapsed: false,
      items: [...s.items, { id, ...f, progress: 0, status: 'uploading' }],
    }));
    return id;
  },
  setProgress: (id, progress) => set(patch(id, { progress })),
  complete: (id) => set(patch(id, { progress: 100, status: 'done' })),
  fail: (id, error) => set(patch(id, { status: 'error', error })),
  remove: (id) => set((s) => ({ items: s.items.filter((it) => it.id !== id) })),
  // Keep only still-uploading rows (used by the panel's "clear" once everything settles).
  clearFinished: () => set((s) => ({ items: s.items.filter((it) => it.status === 'uploading') })),
  dismissAll: () => set({ items: [] }),
  setCollapsed: (v) => set({ collapsed: v }),
}));

// Imperative accessor for non-React callers (the editor's uploadToServer hook).
export const uploadStore = () => useUploadStore.getState();
