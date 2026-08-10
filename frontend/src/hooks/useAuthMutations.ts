import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../api/auth';
import { authState } from '../stores/authStore';
import { enterWorkspaceScope, leaveWorkspaceScope } from '../lib/session';

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { email: string; password: string }) => authApi.login(b),
    onSuccess: (res) => {
      qc.clear();
      authState().setSession(res);
    },
  });
}

// Sign-up no longer creates a session — it triggers a verification email. The
// caller routes to the "check your email" screen with the returned address.
export function useRegister() {
  return useMutation({
    mutationFn: (b: { name: string; email: string; password: string }) => authApi.register(b),
  });
}

export function useVerifyEmail() {
  return useMutation({
    mutationFn: (token: string) => authApi.verifyEmail(token),
  });
}

export function useResendVerification() {
  return useMutation({
    mutationFn: (email: string) => authApi.resendVerification(email),
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (email: string) => authApi.forgotPassword(email),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (b: { token: string; password: string }) => authApi.resetPassword(b),
  });
}

export function useEnterWorkspace() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (workspaceId: string) => enterWorkspaceScope(qc, workspaceId),
    onSuccess: (res) => navigate(`/w/${res.workspaceId}`),
  });
}

export function useLeaveWorkspace() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => leaveWorkspaceScope(qc),
    onSuccess: () => navigate('/launcher'),
  });
}
