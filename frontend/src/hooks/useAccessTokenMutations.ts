import { useMutation, useQueryClient } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { accessTokensApi } from '../api/accessTokens';
import { messageOf } from '../lib/errors';
import { pushToast } from '../stores/uiStore';
import type { CreateAccessTokenBody } from '../types/api';

export function useCreateAccessToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAccessTokenBody) => accessTokensApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.accessTokens }),
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

export function useRevokeAccessToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => accessTokensApi.revoke(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.accessTokens }),
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}
