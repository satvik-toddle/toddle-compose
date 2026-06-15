import { create } from 'zustand';
import type { WorkspaceRole } from '../types/roles';
import type { IconName } from '../components/iconMap';

export type ToastKind = 'info' | 'success' | 'error';
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

// Discriminated union of every modal the app can show. ModalRoot renders the
// matching component; mutations read the payload.
export type ModalState =
  | { type: 'createWorkspace' }
  | { type: 'renameWorkspace'; workspaceId: string; name: string; icon: IconName }
  | { type: 'addRealmMember' }
  | { type: 'addWorkspaceMember'; workspaceId: string; workspaceName: string }
  | { type: 'confirmDeleteWorkspace'; workspaceId: string; name: string; memberCount?: number }
  | {
      type: 'confirmRemoveMember';
      scope: 'workspace' | 'realm';
      workspaceId?: string;
      workspaceName?: string;
      userId: string;
      name: string;
      email: string;
      role?: WorkspaceRole;
    }
  | { type: 'renamePage'; kind: 'doc' | 'folder'; workspaceId: string; id: string; name: string }
  | { type: 'confirmDeletePage'; kind: 'doc' | 'folder'; workspaceId: string; id: string; name: string };

interface UiState {
  modal: ModalState | null;
  toasts: Toast[];
  openModal: (m: ModalState) => void;
  closeModal: () => void;
  pushToast: (t: { kind?: ToastKind; message: string }) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;

export const useUiStore = create<UiState>((set) => ({
  modal: null,
  toasts: [],
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
  pushToast: ({ kind = 'info', message }) =>
    set((s) => ({ toasts: [...s.toasts, { id: ++toastSeq, kind, message }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// Imperative helper for non-React callers (e.g. the access-lost guard).
export const pushToast = (t: { kind?: ToastKind; message: string }) =>
  useUiStore.getState().pushToast(t);
