import { http } from '../lib/http';
import type {
  MyOrgJoinRequest,
  OkResponse,
  OrgJoinRequest,
  PublicUser,
  RealmInfo,
  RealmMember,
} from '../types/api';
import type { JoinRequestState, RealmRole } from '../types/roles';

export const realmApi = {
  get: () => http.get<RealmInfo>('/realm'),
  updateSettings: (b: { allowedEmailDomains?: string[]; joinRequestsEnabled?: boolean }) =>
    http.patch<RealmInfo>('/realm', b),
  listUsers: () => http.get<RealmMember[]>('/realm/users'),
  // Member-directory search for pickers: name/email substring, any realm member, ≤20 rows.
  // Blank q is omitted → the first `take` members (initial dropdown list).
  searchUsers: (q: string, take = 20) =>
    http.get<PublicUser[]>(
      `/realm/users/search?take=${take}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
    ),
  addUser: (b: { email: string; role: Exclude<RealmRole, 'OWNER'> }) =>
    http.post<RealmMember>('/realm/users', b),
  setRole: (userId: string, role: Exclude<RealmRole, 'OWNER'>) =>
    http.patch<RealmMember>(`/realm/users/${userId}`, { role }),
  removeUser: (userId: string) => http.del<OkResponse>(`/realm/users/${userId}`),
  // Org-join requests (request to join the realm; approval grants MEMBER).
  orgRequests: (state: JoinRequestState = 'PENDING') =>
    http.get<OrgJoinRequest[]>(`/realm/join-requests?state=${state}`),
  myOrgRequest: () => http.get<MyOrgJoinRequest | null>('/realm/join-requests/mine'),
  requestJoinOrg: () => http.post<MyOrgJoinRequest>('/realm/join-requests'),
  approveOrgRequest: (id: string) =>
    http.post<RealmMember>(`/realm/join-requests/${id}/approve`),
  rejectOrgRequest: (id: string) =>
    http.post<OrgJoinRequest>(`/realm/join-requests/${id}/reject`),
};
