import { http } from '../lib/http';
import type {
  DocPreviewDto,
  DocSearchPage,
  DocumentDetailDto,
  DocumentDto,
  DocumentPermission,
  DocumentShareLink,
  DocumentType,
  DocHistoryResponse,
  DocSnapshot,
  PublicUser,
  ShareLinkScope,
} from '../types/api';
import type { WorkspaceRole } from '../types/roles';

export const documentsApi = {
  // All documents in a workspace (client groups by folderId for the tree/list).
  // Offset-paged (updatedAt desc); the server caps take at 100.
  list: (workspaceId: string, skip = 0, take = 100) =>
    http.get<DocumentDto[]>(
      `/documents?workspaceId=${encodeURIComponent(workspaceId)}&skip=${skip}&take=${take}`,
    ),
  get: (id: string) => http.get<DocumentDetailDto>(`/documents/${id}`),
  // Title + content search, keyset-paginated. workspaceId scopes to one workspace, else global.
  // cursor comes from a prior page's nextCursor (omitted for the first page).
  search: (q: string, workspaceId?: string, take = 25, cursor?: string | null) =>
    http.get<DocSearchPage>(
      `/documents/search?q=${encodeURIComponent(q)}&take=${take}` +
        (workspaceId ? `&workspaceId=${encodeURIComponent(workspaceId)}` : '') +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''),
    ),
  // Head-of-log content for the split-modal read-only preview.
  preview: (id: string) => http.get<DocPreviewDto>(`/documents/${id}/preview`),
  listStarred: (workspaceId: string) =>
    http.get<DocumentDto[]>(`/documents/starred?workspaceId=${encodeURIComponent(workspaceId)}`), // The current user's starred pages in a workspace — flat, any depth.
  listAllSharedWithMe: () => http.get<DocumentDto[]>('/documents/shared-with-me'), // Global: shared pages across all workspaces (each row carries its workspace).
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
  remove: (id: string) => http.del<{ ok: true }>(`/documents/${id}`),
  star: (id: string) => http.post<DocumentDto>(`/documents/${id}/star`),
  unstar: (id: string) => http.del<{ ok: true }>(`/documents/${id}/star`),

  // Per-author edit-session timeline for the version-history panel.
  history: (id: string) => http.get<DocHistoryResponse>(`/documents/${id}/history`),
  // Read-only snapshot of the document at a given update seq; diffAgainst also returns the server-computed merged diff (0 = empty doc).
  historyAt: (id: string, seq: number, diffAgainst?: number) =>
    http.get<DocSnapshot>(
      `/documents/${id}/history/${seq}${diffAgainst != null ? `?diff=${diffAgainst}` : ''}`,
    ),

  // Doc-scoped user-directory search for the Share picker; gated on doc-manage (not realm
  // membership) so a doc-ADMIN grantee who never joined a workspace can still find people.
  // Blank q is omitted → the first `take` users (initial dropdown list).
  searchGrantableUsers: (id: string, q: string, take = 20) =>
    http.get<PublicUser[]>(
      `/documents/${id}/grantable-users?take=${take}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
    ),

  // Per-page permission grants (manage from the doc's 3-dots → Permissions).
  listPermissions: (id: string) => http.get<DocumentPermission[]>(`/documents/${id}/permissions`),
  addPermission: (id: string, b: { email: string; role: WorkspaceRole }) =>
    http.post<DocumentPermission>(`/documents/${id}/permissions`, b),
  updatePermission: (id: string, userId: string, role: WorkspaceRole) =>
    http.patch<DocumentPermission>(`/documents/${id}/permissions/${userId}`, { role }),
  removePermission: (id: string, userId: string) =>
    http.del<{ ok: true }>(`/documents/${id}/permissions/${userId}`),

  // Share link (managers only). PUT upserts the link's role + scope.
  getShareLink: (id: string) => http.get<DocumentShareLink>(`/documents/${id}/share-link`),
  putShareLink: (id: string, b: { role: WorkspaceRole; scope: ShareLinkScope }) =>
    http.put<DocumentShareLink>(`/documents/${id}/share-link`, b),
  regenerateShareLink: (id: string) =>
    http.post<DocumentShareLink>(`/documents/${id}/share-link/regenerate`),
  deleteShareLink: (id: string) => http.del<{ ok: true }>(`/documents/${id}/share-link`),

  // Force everyone currently in the doc to re-check access now (kick live RTC + invalidate tokens).
  refreshAccess: (id: string) =>
    http.post<{ ok: true; closed: number }>(`/documents/${id}/refresh-access`),
};
