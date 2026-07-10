import { http } from '../lib/http';
import type {
  AuthConfig,
  AuthResponse,
  EnterWorkspaceResponse,
  LeaveWorkspaceResponse,
  OkResponse,
  ResetEmailSent,
  ResetPasswordResponse,
  User,
  VerificationPending,
  VerifyEmailResponse,
} from '../types/api';

export const authApi = {
  config: () => http.get<AuthConfig>('/auth/config', { auth: false }),
  register: (b: { name: string; email: string; password: string }) =>
    http.post<VerificationPending>('/auth/register', b, { auth: false }),
  login: (b: { email: string; password: string }) =>
    http.post<AuthResponse>('/auth/login', b, { auth: false }),
  verifyEmail: (token: string) =>
    http.post<VerifyEmailResponse>('/auth/verify-email', { token }, { auth: false }),
  resendVerification: (email: string) =>
    http.post<VerificationPending>('/auth/resend-verification', { email }, { auth: false }),
  forgotPassword: (email: string) =>
    http.post<ResetEmailSent>('/auth/forgot-password', { email }, { auth: false }),
  resetPassword: (b: { token: string; password: string }) =>
    http.post<ResetPasswordResponse>('/auth/reset-password', b, { auth: false }),
  logout: (refreshToken: string) =>
    http.post<OkResponse>('/auth/logout', { refreshToken }, { auth: false }),
  me: () => http.get<{ user: User }>('/auth/me'),
  enter: (workspaceId: string) =>
    http.post<EnterWorkspaceResponse>('/auth/workspace/enter', { workspaceId }),
  leave: () => http.post<LeaveWorkspaceResponse>('/auth/workspace/leave'),
};
