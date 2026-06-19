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

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { name: string; email: string; password: string }) => authApi.register(b),
    onSuccess: (res) => {
      qc.clear();
      authState().setSession(res);
    },
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
