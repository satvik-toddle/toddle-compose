import { http } from '../lib/http';
import type {
  DocumentDto,
  DocumentPermission,
  DocumentShareLink,
  DocumentType,
  ShareLinkScope,
  ShareMode,
} from '../types/api';
import type { Visibility, WorkspaceRole } from '../types/roles';

export const documentsApi = {
  // All documents in a workspace (client groups by folderId for the tree/list).
  list: (workspaceId: string) =>
    http.get<DocumentDto[]>(`/documents?workspaceId=${encodeURIComponent(workspaceId)}`),
  get: (id: string) => http.get<DocumentDto>(`/documents/${id}`),
  listStarred: (workspaceId: string) =>
    http.get<DocumentDto[]>(`/documents/starred?workspaceId=${encodeURIComponent(workspaceId)}`), // The current user's starred pages in a workspace — flat, any depth.
  listSharedWithMe: (workspaceId: string) =>
    http.get<DocumentDto[]>(`/documents/shared?workspaceId=${encodeURIComponent(workspaceId)}`), // Pages shared with the current user via per-page grants — excludes owned docs, newest grant first.
  create: (b: {
    workspaceId: string;
    parentId?: string | null;
    folderId?: string | null;
    title?: string;
    icon?: string;
    type?: DocumentType;
  }) =>
    http.post<DocumentDto>('/documents', {
      workspaceId: b.workspaceId,
      // A page nests under another page (parentId) — the backend ignores folderId
      // when parentId is set, so only send one.
      ...(b.parentId ? { parentId: b.parentId } : b.folderId ? { folderId: b.folderId } : {}),
      ...(b.title ? { title: b.title } : {}),
      ...(b.icon ? { icon: b.icon } : {}),
      // Omit for DOC — the backend defaults to it; only SHEET needs sending.
      ...(b.type ? { type: b.type } : {}),
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

  // Per-page permission grants (manage from the doc's 3-dots → Permissions).
  listPermissions: (id: string) => http.get<DocumentPermission[]>(`/documents/${id}/permissions`),
  addPermission: (id: string, b: { email: string; role: WorkspaceRole }) =>
    http.post<DocumentPermission>(`/documents/${id}/permissions`, b),
  updatePermission: (id: string, userId: string, role: WorkspaceRole) =>
    http.patch<DocumentPermission>(`/documents/${id}/permissions/${userId}`, { role }),
  removePermission: (id: string, userId: string) =>
    http.del<{ ok: true }>(`/documents/${id}/permissions/${userId}`),

  // Share link + access mode (managers only). PUT upserts and flips shareMode to LINK.
  getShareLink: (id: string) => http.get<DocumentShareLink>(`/documents/${id}/share-link`),
  putShareLink: (id: string, b: { role: WorkspaceRole; scope: ShareLinkScope }) =>
    http.put<DocumentShareLink>(`/documents/${id}/share-link`, b),
  regenerateShareLink: (id: string) =>
    http.post<DocumentShareLink>(`/documents/${id}/share-link/regenerate`),
  deleteShareLink: (id: string) => http.del<{ ok: true }>(`/documents/${id}/share-link`), // resets shareMode to DEFAULT
  setShareMode: (id: string, mode: ShareMode) =>
    http.patch<DocumentDto>(`/documents/${id}/share-mode`, { mode }),
};
