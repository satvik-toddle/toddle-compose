import { http } from '../lib/http';
import type { FolderDto } from '../types/api';

export const foldersApi = {
  // Flat list of all folders in a workspace (client assembles the tree).
  list: (workspaceId: string) =>
    http.get<FolderDto[]>(`/folders?workspaceId=${encodeURIComponent(workspaceId)}`),
  create: (b: { workspaceId: string; parentId?: string | null; name: string; icon?: string }) =>
    http.post<FolderDto>('/folders', {
      workspaceId: b.workspaceId,
      name: b.name,
      ...(b.parentId ? { parentId: b.parentId } : {}),
      ...(b.icon ? { icon: b.icon } : {}),
    }),
  rename: (id: string, b: { name?: string; icon?: string }) =>
    http.patch<FolderDto>(`/folders/${id}`, b),
  move: (id: string, parentId: string | null) =>
    http.patch<FolderDto>(`/folders/${id}/move`, { parentId }),
  remove: (id: string) => http.del<{ ok: true }>(`/folders/${id}`),
};
