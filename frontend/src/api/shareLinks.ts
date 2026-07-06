import { http } from '../lib/http';
import type { ShareLinkResolve } from '../types/api';

// Public share-link endpoints for /link/:token. The http wrapper only attaches a
// bearer token when one exists and never redirects on 401, so logged-out calls
// work for ANYONE-scope links and REALM-scope 401s surface as ApiError.
export const shareLinksApi = {
  resolve: (token: string) => http.get<ShareLinkResolve>(`/share-links/${token}`),
  rtcToken: (token: string) =>
    http.post<{ token: string; docId: string; role: 'editor' | 'viewer' }>(
      `/share-links/${token}/rtc-token`,
    ),
};
