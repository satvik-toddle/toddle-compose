import { http } from '../lib/http';
import type { OkResponse, RealmInfo, RealmMember } from '../types/api';
import type { RealmRole } from '../types/roles';

export const realmApi = {
  get: () => http.get<RealmInfo>('/realm'),
  updateSettings: (b: { allowedEmailDomains: string[] }) =>
    http.patch<RealmInfo>('/realm', b),
  listUsers: () => http.get<RealmMember[]>('/realm/users'),
  addUser: (b: { email: string; role: Exclude<RealmRole, 'OWNER'> }) =>
    http.post<RealmMember>('/realm/users', b),
  setRole: (userId: string, role: Exclude<RealmRole, 'OWNER'>) =>
    http.patch<RealmMember>(`/realm/users/${userId}`, { role }),
  removeUser: (userId: string) => http.del<OkResponse>(`/realm/users/${userId}`),
};
