import { http } from '../lib/http';
import type { DocumentDto } from '../types/api';
import type { Visibility } from '../types/roles';

export const documentsApi = {
  // All documents in a workspace (client groups by folderId for the tree/list).
  list: (workspaceId: string) =>
    http.get<DocumentDto[]>(`/documents?workspaceId=${encodeURIComponent(workspaceId)}`),
  get: (id: string) => http.get<DocumentDto>(`/documents/${id}`),
  create: (b: { workspaceId: string; folderId?: string | null; title?: string; icon?: string }) =>
    http.post<DocumentDto>('/documents', {
      workspaceId: b.workspaceId,
      ...(b.folderId ? { folderId: b.folderId } : {}),
      ...(b.title ? { title: b.title } : {}),
      ...(b.icon ? { icon: b.icon } : {}),
    }),
  rename: (id: string, title: string) => http.patch<DocumentDto>(`/documents/${id}`, { title }),
  // Non-collaborative HTML body (server-saved, shared across users; no RTC).
  getBody: (id: string) => http.get<{ body: string }>(`/documents/${id}/body`),
  saveBody: (id: string, body: string) =>
    http.put<{ ok: true }>(`/documents/${id}/body`, { body }),
  move: (id: string, b: { folderId?: string | null; parentId?: string | null }) =>
    http.patch<DocumentDto>(`/documents/${id}/move`, b),
  setVisibility: (id: string, visibility: Visibility) =>
    http.patch<DocumentDto>(`/documents/${id}/visibility`, { visibility }),
  remove: (id: string) => http.del<{ ok: true }>(`/documents/${id}`),
};
