import { http } from '../lib/http';
import type { DocumentDto } from '../types/api';
import type { Visibility } from '../types/roles';

export const documentsApi = {
  // All documents in a workspace (client groups by folderId for the tree/list).
  list: (workspaceId: string) =>
    http.get<DocumentDto[]>(`/documents?workspaceId=${encodeURIComponent(workspaceId)}`),
  get: (id: string) => http.get<DocumentDto>(`/documents/${id}`),
  // The current user's starred pages in a workspace — flat, any depth.
  listStarred: (workspaceId: string) =>
    http.get<DocumentDto[]>(`/documents/starred?workspaceId=${encodeURIComponent(workspaceId)}`),
  create: (b: {
    workspaceId: string;
    parentId?: string | null;
    folderId?: string | null;
    title?: string;
    icon?: string;
  }) =>
    http.post<DocumentDto>('/documents', {
      workspaceId: b.workspaceId,
      // A page nests under another page (parentId) — the backend ignores folderId
      // when parentId is set, so only send one.
      ...(b.parentId ? { parentId: b.parentId } : b.folderId ? { folderId: b.folderId } : {}),
      ...(b.title ? { title: b.title } : {}),
      ...(b.icon ? { icon: b.icon } : {}),
    }),
  rename: (id: string, title: string) => http.patch<DocumentDto>(`/documents/${id}`, { title }),
  // Short-lived RTC token for real-time collaboration (editor|viewer role).
  rtcToken: (id: string) =>
    http.post<{ token: string; docId: string; role: 'editor' | 'viewer' }>(
      `/documents/${id}/rtc-token`,
    ),
  move: (id: string, b: { folderId?: string | null; parentId?: string | null }) =>
    http.patch<DocumentDto>(`/documents/${id}/move`, b),
  setVisibility: (id: string, visibility: Visibility) =>
    http.patch<DocumentDto>(`/documents/${id}/visibility`, { visibility }),
  remove: (id: string) => http.del<{ ok: true }>(`/documents/${id}`),
  star: (id: string) => http.post<DocumentDto>(`/documents/${id}/star`),
  unstar: (id: string) => http.del<{ ok: true }>(`/documents/${id}/star`),
};
