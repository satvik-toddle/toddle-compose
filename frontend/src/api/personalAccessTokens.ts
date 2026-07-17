import { http } from '../lib/http';
import type {
  PersonalAccessToken,
  CreatePersonalAccessTokenBody,
  CreatePersonalAccessTokenResult,
} from '../types/api';

export const personalAccessTokensApi = {
  // Lists the caller's own tokens across every scope; callers filter by workspace.
  list: () => http.get<PersonalAccessToken[]>('/personal-access-tokens'),
  create: (b: CreatePersonalAccessTokenBody) =>
    http.post<CreatePersonalAccessTokenResult>('/personal-access-tokens', b),
  revoke: (id: string) => http.del<PersonalAccessToken>(`/personal-access-tokens/${id}`),
};
