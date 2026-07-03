import { http } from '../lib/http';
import type { AccessToken, CreateAccessTokenBody, CreateAccessTokenResult } from '../types/api';

export const accessTokensApi = {
  // Lists the caller's own tokens across every scope; callers filter by workspace.
  list: () => http.get<AccessToken[]>('/access-tokens'),
  create: (b: CreateAccessTokenBody) => http.post<CreateAccessTokenResult>('/access-tokens', b),
  revoke: (id: string) => http.del<AccessToken>(`/access-tokens/${id}`),
};
