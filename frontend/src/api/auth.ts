import { http } from '../lib/http';
import type {
  AuthResponse,
  EnterWorkspaceResponse,
  LeaveWorkspaceResponse,
  OkResponse,
  User,
} from '../types/api';

export const authApi = {
  register: (b: { name: string; email: string; password: string }) =>
    http.post<AuthResponse>('/auth/register', b, { auth: false }),
  login: (b: { email: string; password: string }) =>
    http.post<AuthResponse>('/auth/login', b, { auth: false }),
  logout: (refreshToken: string) =>
    http.post<OkResponse>('/auth/logout', { refreshToken }, { auth: false }),
  me: () => http.get<{ user: User }>('/auth/me'),
  enter: (workspaceId: string) =>
    http.post<EnterWorkspaceResponse>('/auth/workspace/enter', { workspaceId }),
  leave: () => http.post<LeaveWorkspaceResponse>('/auth/workspace/leave'),
};
