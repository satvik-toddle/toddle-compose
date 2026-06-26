import { useOutletContext } from 'react-router-dom';
import type { WorkspaceRole, RealmRole } from '../../types/roles';

export interface WorkspaceCtx {
  workspaceId: string;
  name: string;
  role: WorkspaceRole; // effective role (incl. overlay)
  isAdmin: boolean;
  overlay: boolean;
  realmRole: RealmRole | null;
}

export function useWorkspaceCtx() {
  return useOutletContext<WorkspaceCtx>();
}
