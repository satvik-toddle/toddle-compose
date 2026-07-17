import { useMutation, useQueryClient } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { personalAccessTokensApi } from '../api/personalAccessTokens';
import { messageOf } from '../lib/errors';
import { pushToast } from '../stores/uiStore';
import type { CreatePersonalAccessTokenBody } from '../types/api';

export function useCreatePersonalAccessToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePersonalAccessTokenBody) => personalAccessTokensApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.personalAccessTokens }),
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

export function useRevokePersonalAccessToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => personalAccessTokensApi.revoke(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.personalAccessTokens }),
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}
