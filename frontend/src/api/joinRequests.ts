import { http } from '../lib/http';
import type { JoinRequest, WorkspaceMember } from '../types/api';
import type { JoinRequestState, WorkspaceRole } from '../types/roles';

export const joinApi = {
  // Self-join a PUBLIC workspace (instant, as the workspace's defaultRole).
  joinPublic: (workspaceId: string) =>
    http.post<WorkspaceMember>(`/workspaces/${workspaceId}/join`),
  // Request access to a PRIVATE workspace.
  request: (workspaceId: string, requestedRole?: WorkspaceRole) =>
    http.post<JoinRequest>(
      `/workspaces/${workspaceId}/requests`,
      requestedRole ? { requestedRole } : {},
    ),
  // Realm-wide pending requests (owner/maintainer + workspace admins).
  realmRequests: (state: JoinRequestState = 'PENDING') =>
    http.get<JoinRequest[]>(`/workspaces/join-requests?state=${state}`),
  // Requests scoped to one workspace (workspace admin).
  wsRequests: (workspaceId: string, state: JoinRequestState = 'PENDING') =>
    http.get<JoinRequest[]>(`/workspaces/${workspaceId}/requests?state=${state}`),
  approve: (workspaceId: string, requestId: string, role?: WorkspaceRole) =>
    http.post<WorkspaceMember>(
      `/workspaces/${workspaceId}/requests/${requestId}/approve`,
      role ? { role } : {},
    ),
  reject: (workspaceId: string, requestId: string) =>
    http.post<JoinRequest>(`/workspaces/${workspaceId}/requests/${requestId}/reject`),
};
