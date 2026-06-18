import { http } from '../lib/http';
import type {
  DiscoverableWorkspace,
  OkResponse,
  Workspace,
  WorkspaceMember,
} from '../types/api';
import type { Visibility, WorkspaceRole } from '../types/roles';

export const workspacesApi = {
  list: () => http.get<Workspace[]>('/workspaces'),
  discoverable: () => http.get<DiscoverableWorkspace[]>('/workspaces/discoverable'),
  get: (id: string) => http.get<Workspace>(`/workspaces/${id}`),
  create: (b: { name: string; visibility?: Visibility; defaultRole?: WorkspaceRole }) =>
    http.post<Workspace>('/workspaces', b),
  update: (
    id: string,
    b: { name?: string; visibility?: Visibility; defaultRole?: WorkspaceRole },
  ) => http.patch<Workspace>(`/workspaces/${id}`, b),
  remove: (id: string) => http.del<OkResponse>(`/workspaces/${id}`),

  listMembers: (id: string) => http.get<WorkspaceMember[]>(`/workspaces/${id}/users`),
  addMember: (id: string, b: { email: string; role: WorkspaceRole }) =>
    http.post<WorkspaceMember>(`/workspaces/${id}/users`, b),
  setMemberRole: (id: string, userId: string, role: WorkspaceRole) =>
    http.patch<WorkspaceMember>(`/workspaces/${id}/users/${userId}`, { role }),
  removeMember: (id: string, userId: string) =>
    http.del<OkResponse>(`/workspaces/${id}/users/${userId}`),
};
